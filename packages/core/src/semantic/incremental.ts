import type { Span, TikzFigure } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import {
  applyStatementEffectSummary,
  restoreSemanticContext,
  retargetEditHandlesSourceFingerprint,
  snapshotSemanticContext,
  type SemanticContextSnapshot,
  type SemanticStatementEffectSummary
} from "./context.js";
import { collectGeometryInvalidation } from "./dependencies.js";
import {
  collectNodeAnchorTargets,
  computeBounds,
  createSemanticEvaluationRun,
  evaluateSemanticStatementByIndex,
  finalizeSemanticEvaluationRun,
  type EvaluateTikzResult
} from "./evaluate.js";
import { inferRequiredTikzLibraries } from "./required-tikz-libraries.js";
import type {
  EditHandle,
  EvaluateOptions,
  FeatureUsage,
  NodeAnchorTarget,
  SceneElement,
  SceneFigure
} from "./types.js";

export type IncrementalSemanticTrigger = "drag-element" | "drag-handle" | "other";
export type IncrementalSemanticReplayMode = "full" | "suffix" | "selective";

export type IncrementalSemanticHints = {
  changedSourceIds?: readonly string[];
  trigger?: IncrementalSemanticTrigger;
};

export type IncrementalSemanticFallbackReason =
  | "non-drag-trigger"
  | "missing-changed-source-ids"
  | "no-previous-cache"
  | "statement-structure-changed"
  | "opaque-dependency"
  | "unmapped-affected-source"
  | "checkpoint-missing"
  | "feature-checkpoint-missing"
  | "restore-failed"
  | "runtime-error";

export type IncrementalSemanticStats = {
  strategy: "full" | "incremental";
  replayMode?: IncrementalSemanticReplayMode;
  recomputeFromStatementIndex: number | null;
  recomputedStatementCount: number;
  reusedStatementCount: number;
  corridorEndStatementIndex?: number | null;
  affectedStatementCount?: number;
  fallbackReason?: IncrementalSemanticFallbackReason;
};

export type IncrementalSemanticEvaluateInput = {
  figure: TikzFigure;
  source: string;
  options?: EvaluateOptions;
  hints?: IncrementalSemanticHints;
};

export type IncrementalSemanticEvaluateResult = {
  semantic: EvaluateTikzResult;
  stats: IncrementalSemanticStats;
};

export type IncrementalSemanticSession = {
  evaluate: (input: IncrementalSemanticEvaluateInput) => IncrementalSemanticEvaluateResult;
  reset: () => void;
};

type SemanticStatementFragment = {
  statementId: string;
  sourceId: string;
  sourceSpan: Span;
  elements: SceneElement[];
  editHandles: EditHandle[];
  diagnostics: Diagnostic[];
  effectSummary: SemanticStatementEffectSummary;
};

type CachedSemanticRun = {
  statementIds: string[];
  statementFragments: SemanticStatementFragment[];
  editHandles: readonly EditHandle[];
  checkpointInterval: number;
  checkpointsBeforeStatement: Map<number, SemanticContextSnapshot>;
  featureUsageBeforeStatement: Map<number, FeatureUsage>;
  dependencies: EvaluateTikzResult["dependencies"];
  sourceStatementFirstIndexBySourceId: Map<string, number>;
  finalFeatureUsage: FeatureUsage;
};

type SelectiveReplayPlan = {
  restoreIndex: number;
  corridorEndIndex: number;
  affectedStatementCount: number;
};

const DEFAULT_CHECKPOINT_INTERVAL = 8;

export function createIncrementalSemanticSession(
  defaultOptions: EvaluateOptions = {}
): IncrementalSemanticSession {
  let cached: CachedSemanticRun | null = null;

  const evaluate = (
    input: IncrementalSemanticEvaluateInput
  ): IncrementalSemanticEvaluateResult => {
    const options: EvaluateOptions = {
      ...defaultOptions,
      ...(input.options ?? {})
    };
    const run = createSemanticEvaluationRun(input.figure, input.source, options);
    const statementCount = run.expandedFigureBody.length;
    const statementIds = run.expandedFigureBody.map((statement) => statement.id);
    const hints = input.hints ?? {};

    const fallback = decideFallbackReason(hints, cached, statementIds);
    if (fallback) {
      const full = evaluateFullyAndCache(run, statementIds, fallback);
      cached = full.cached;
      return full.output;
    }

    const previous = cached;
    if (!previous) {
      const full = evaluateFullyAndCache(run, statementIds, "no-previous-cache");
      cached = full.cached;
      return full.output;
    }

    const changedSourceIds = normalizeChangedSourceIds(hints.changedSourceIds ?? []);
    const invalidation = collectGeometryInvalidation(previous.dependencies, {
      changedSourceIds
    });
    if (invalidation.reachedOpaque) {
      const full = evaluateFullyAndCache(run, statementIds, "opaque-dependency");
      cached = full.cached;
      return full.output;
    }

    const affectedStatementIndices = invalidation.affectedSourceIds
      .map((sourceId) => previous.sourceStatementFirstIndexBySourceId.get(sourceId) ?? null)
      .filter((index): index is number => index != null && index >= 0 && index < statementCount);
    if (affectedStatementIndices.length === 0) {
      const full = evaluateFullyAndCache(run, statementIds, "unmapped-affected-source");
      cached = full.cached;
      return full.output;
    }

    const checkpointInterval = previous.checkpointInterval;
    const earliestAffectedIndex = Math.min(...affectedStatementIndices);
    const restoreIndex = findCheckpointIndexAtOrBefore(
      previous.checkpointsBeforeStatement,
      earliestAffectedIndex
    );
    if (restoreIndex == null) {
      const full = evaluateFullyAndCache(run, statementIds, "checkpoint-missing");
      cached = full.cached;
      return full.output;
    }

    const startCheckpoint = previous.checkpointsBeforeStatement.get(restoreIndex);
    if (!startCheckpoint) {
      const full = evaluateFullyAndCache(run, statementIds, "checkpoint-missing");
      cached = full.cached;
      return full.output;
    }
    const startFeatureUsage = previous.featureUsageBeforeStatement.get(restoreIndex);
    if (!startFeatureUsage) {
      const full = evaluateFullyAndCache(run, statementIds, "feature-checkpoint-missing");
      cached = full.cached;
      return full.output;
    }

    const selectivePlan = planSelectiveReplay(previous.statementFragments, restoreIndex, affectedStatementIndices);
    if (selectivePlan) {
      try {
        const selective = evaluateSelectively({
          run,
          previous,
          restoreIndex,
          corridorEndIndex: selectivePlan.corridorEndIndex,
          affectedStatementCount: selectivePlan.affectedStatementCount,
          checkpointInterval,
          startCheckpoint,
          startFeatureUsage
        });
        return selective;
      } catch (_error) {
        // Fall through to the suffix replay path.
      }
    }

    try {
      const suffix = evaluateIncrementalSuffix({
        run,
        previous,
        statementIds,
        restoreIndex,
        checkpointInterval,
        startCheckpoint,
        startFeatureUsage,
        affectedStatementCount: new Set(affectedStatementIndices).size
      });
      cached = suffix.cached;
      return suffix.output;
    } catch (_error) {
      const full = evaluateFullyAndCache(
        createSemanticEvaluationRun(input.figure, input.source, options),
        statementIds,
        "runtime-error"
      );
      cached = full.cached;
      return full.output;
    }
  };

  return {
    evaluate,
    reset: () => {
      cached = null;
    }
  };
}

function evaluateFullyAndCache(
  run: ReturnType<typeof createSemanticEvaluationRun>,
  statementIds: string[],
  fallbackReason: IncrementalSemanticFallbackReason
): {
  output: IncrementalSemanticEvaluateResult;
  cached: CachedSemanticRun;
} {
  const statementCount = run.expandedFigureBody.length;
  const checkpointInterval = DEFAULT_CHECKPOINT_INTERVAL;
  const statementFragments: SemanticStatementFragment[] = [];
  const checkpointsBeforeStatement = new Map<number, SemanticContextSnapshot>();
  const featureUsageBeforeStatement = new Map<number, FeatureUsage>();

  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    if (shouldCaptureCheckpoint(statementIndex, checkpointInterval)) {
      checkpointsBeforeStatement.set(
        statementIndex,
        snapshotSemanticContext(run.context, { editHandlesMode: "length" })
      );
      featureUsageBeforeStatement.set(statementIndex, cloneFeatureUsage(run.featureUsage));
    }
    const evaluated = evaluateSemanticStatementByIndex(run, statementIndex);
    statementFragments.push(createStatementFragment(evaluated));
  }
  checkpointsBeforeStatement.set(
    statementCount,
    snapshotSemanticContext(run.context, { editHandlesMode: "length" })
  );
  featureUsageBeforeStatement.set(statementCount, cloneFeatureUsage(run.featureUsage));

  const semantic = finalizeSemanticEvaluationRun(
    run,
    statementFragments.map((fragment) => fragment.elements)
  );
  const nextCached: CachedSemanticRun = {
    statementIds,
    statementFragments,
    editHandles: semantic.editHandles,
    checkpointInterval,
    checkpointsBeforeStatement,
    featureUsageBeforeStatement,
    dependencies: semantic.dependencies,
    sourceStatementFirstIndexBySourceId: mapSourceStatementFirstIndices(semantic.sourceStatementFirstIndexBySourceId),
    finalFeatureUsage: cloneFeatureUsage(semantic.featureUsage)
  };
  return {
    output: {
      semantic,
      stats: {
        strategy: "full",
        replayMode: "full",
        recomputeFromStatementIndex: null,
        recomputedStatementCount: statementCount,
        reusedStatementCount: 0,
        corridorEndStatementIndex: null,
        affectedStatementCount: statementCount,
        fallbackReason
      }
    },
    cached: nextCached
  };
}

function evaluateIncrementalSuffix(args: {
  run: ReturnType<typeof createSemanticEvaluationRun>;
  previous: CachedSemanticRun;
  statementIds: string[];
  restoreIndex: number;
  checkpointInterval: number;
  startCheckpoint: SemanticContextSnapshot;
  startFeatureUsage: FeatureUsage;
  affectedStatementCount: number;
}): {
  output: IncrementalSemanticEvaluateResult;
  cached: CachedSemanticRun;
} {
  const {
    run,
    previous,
    statementIds,
    restoreIndex,
    checkpointInterval,
    startCheckpoint,
    startFeatureUsage,
    affectedStatementCount
  } = args;
  const statementCount = run.expandedFigureBody.length;

  restoreSemanticContext(run.context, startCheckpoint, {
    editHandleSource: previous.editHandles
  });
  retargetEditHandlesSourceFingerprint(run.context.editHandles, run.context.sourceFingerprint);
  assignFeatureUsage(run.featureUsage, startFeatureUsage);
  run.diagnostics.length = run.baseDiagnosticsCount;
  for (let index = 0; index < restoreIndex; index += 1) {
    run.diagnostics.push(...previous.statementFragments[index].diagnostics);
  }

  const nextFragments = previous.statementFragments.slice(0, restoreIndex);
  const checkpointsBeforeStatement = cloneCheckpointsBefore(
    previous.checkpointsBeforeStatement,
    restoreIndex
  );
  const featureUsageBeforeStatement = cloneCheckpointsBefore(
    previous.featureUsageBeforeStatement,
    restoreIndex
  );

  for (let statementIndex = restoreIndex; statementIndex < statementCount; statementIndex += 1) {
    if (shouldCaptureCheckpoint(statementIndex, checkpointInterval)) {
      checkpointsBeforeStatement.set(
        statementIndex,
        snapshotSemanticContext(run.context, { editHandlesMode: "length" })
      );
      featureUsageBeforeStatement.set(statementIndex, cloneFeatureUsage(run.featureUsage));
    }
    const evaluated = evaluateSemanticStatementByIndex(run, statementIndex);
    nextFragments[statementIndex] = createStatementFragment(evaluated);
  }
  checkpointsBeforeStatement.set(
    statementCount,
    snapshotSemanticContext(run.context, { editHandlesMode: "length" })
  );
  featureUsageBeforeStatement.set(statementCount, cloneFeatureUsage(run.featureUsage));

  const semantic = finalizeSemanticEvaluationRun(
    run,
    nextFragments.map((fragment) => fragment.elements)
  );
  return {
    output: {
      semantic,
      stats: {
        strategy: "incremental",
        replayMode: "suffix",
        recomputeFromStatementIndex: restoreIndex,
        recomputedStatementCount: statementCount - restoreIndex,
        reusedStatementCount: restoreIndex,
        corridorEndStatementIndex: statementCount - 1,
        affectedStatementCount
      }
    },
    cached: {
      statementIds,
      statementFragments: nextFragments,
      editHandles: semantic.editHandles,
      checkpointInterval,
      checkpointsBeforeStatement,
      featureUsageBeforeStatement,
      dependencies: semantic.dependencies,
      sourceStatementFirstIndexBySourceId: mapSourceStatementFirstIndices(semantic.sourceStatementFirstIndexBySourceId),
      finalFeatureUsage: cloneFeatureUsage(semantic.featureUsage)
    }
  };
}

function evaluateSelectively(args: {
  run: ReturnType<typeof createSemanticEvaluationRun>;
  previous: CachedSemanticRun;
  restoreIndex: number;
  corridorEndIndex: number;
  affectedStatementCount: number;
  checkpointInterval: number;
  startCheckpoint: SemanticContextSnapshot;
  startFeatureUsage: FeatureUsage;
}): IncrementalSemanticEvaluateResult {
  const {
    run,
    previous,
    restoreIndex,
    corridorEndIndex,
    affectedStatementCount,
    checkpointInterval,
    startCheckpoint,
    startFeatureUsage
  } = args;
  const statementCount = run.expandedFigureBody.length;

  restoreSemanticContext(run.context, startCheckpoint, {
    editHandleSource: previous.editHandles
  });
  retargetEditHandlesSourceFingerprint(run.context.editHandles, run.context.sourceFingerprint);
  assignFeatureUsage(run.featureUsage, startFeatureUsage);
  run.diagnostics.length = run.baseDiagnosticsCount;

  const nextFragments = previous.statementFragments.slice();
  const checkpointsBeforeStatement = cloneCheckpointsBefore(
    previous.checkpointsBeforeStatement,
    restoreIndex
  );
  const featureUsageBeforeStatement = cloneCheckpointsBefore(
    previous.featureUsageBeforeStatement,
    restoreIndex
  );

  for (let statementIndex = restoreIndex; statementIndex <= corridorEndIndex; statementIndex += 1) {
    if (shouldCaptureCheckpoint(statementIndex, checkpointInterval)) {
      checkpointsBeforeStatement.set(
        statementIndex,
        snapshotSemanticContext(run.context, { editHandlesMode: "length" })
      );
      featureUsageBeforeStatement.set(statementIndex, cloneFeatureUsage(run.featureUsage));
    }
    const evaluated = evaluateSemanticStatementByIndex(run, statementIndex);
    nextFragments[statementIndex] = createStatementFragment(evaluated);
  }

  for (let statementIndex = corridorEndIndex + 1; statementIndex < statementCount; statementIndex += 1) {
    applyStatementEffectSummary(run.context, previous.statementFragments[statementIndex].effectSummary);
  }

  const semantic = assembleSelectiveSemanticResult({
    run,
    fragments: nextFragments,
    featureUsage: previous.finalFeatureUsage,
    dependencies: previous.dependencies,
    sourceStatementFirstIndexBySourceId: previous.sourceStatementFirstIndexBySourceId
  });

  return {
    semantic,
    stats: {
      strategy: "incremental",
      replayMode: "selective",
      recomputeFromStatementIndex: restoreIndex,
      recomputedStatementCount: corridorEndIndex - restoreIndex + 1,
      reusedStatementCount: statementCount - (corridorEndIndex - restoreIndex + 1),
      corridorEndStatementIndex: corridorEndIndex,
      affectedStatementCount
    }
  };
}

function assembleSelectiveSemanticResult(args: {
  run: ReturnType<typeof createSemanticEvaluationRun>;
  fragments: readonly SemanticStatementFragment[];
  featureUsage: FeatureUsage;
  dependencies: EvaluateTikzResult["dependencies"];
  sourceStatementFirstIndexBySourceId: ReadonlyMap<string, number>;
}): EvaluateTikzResult {
  const { run, fragments, featureUsage, dependencies, sourceStatementFirstIndexBySourceId } = args;
  const sourceFingerprint = run.context.sourceFingerprint;
  const elements: SceneElement[] = [];
  const editHandles: EditHandle[] = [];
  const diagnostics = run.diagnostics.slice(0, run.baseDiagnosticsCount);

  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index];
    const currentSourceSpan =
      run.sourceStatementSpanById.get(fragment.sourceId) ?? fragment.sourceSpan;
    const materialized = materializeFragmentForCurrentSource(
      fragment,
      currentSourceSpan,
      run.source,
      sourceFingerprint
    );
    elements.push(...materialized.elements);
    editHandles.push(...materialized.editHandles);
    diagnostics.push(...fragment.diagnostics);
  }

  const finalFeatureUsage = cloneFeatureUsage(featureUsage);
  const scene: SceneFigure = {
    kind: "SceneFigure",
    span: run.figure.span,
    requiredTikzLibraries: inferRequiredTikzLibraries({
      featureUsage: finalFeatureUsage,
      elements
    }),
    elements,
    bounds: computeBounds(elements)
  };

  return {
    scene,
    diagnostics,
    featureUsage: finalFeatureUsage,
    editHandles,
    nodeAnchorTargets: collectNodeAnchorTargets(run.context),
    dependencies,
    sourceStatementFirstIndexBySourceId: unmapSourceStatementFirstIndices(sourceStatementFirstIndexBySourceId)
  };
}

function createStatementFragment(
  evaluated: ReturnType<typeof evaluateSemanticStatementByIndex>
): SemanticStatementFragment {
  return {
    statementId: evaluated.statementId,
    sourceId: evaluated.sourceId,
    sourceSpan: { ...evaluated.sourceSpan },
    elements: structuredClone(evaluated.elements),
    editHandles: structuredClone(evaluated.editHandles),
    diagnostics: structuredClone(evaluated.diagnostics),
    effectSummary: structuredClone(evaluated.effectSummary)
  };
}

function planSelectiveReplay(
  fragments: readonly SemanticStatementFragment[],
  restoreIndex: number,
  affectedStatementIndices: readonly number[]
): SelectiveReplayPlan | null {
  const uniqueAffected = [...new Set(affectedStatementIndices)].sort((left, right) => left - right);
  if (uniqueAffected.length === 0) {
    return null;
  }
  const corridorEndIndex = uniqueAffected[uniqueAffected.length - 1] ?? restoreIndex;
  for (let statementIndex = corridorEndIndex + 1; statementIndex < fragments.length; statementIndex += 1) {
    const fragment = fragments[statementIndex];
    if (!fragment) {
      return null;
    }
    if (!isSuffixFragmentSelectiveSafe(fragment)) {
      return null;
    }
  }
  return {
    restoreIndex,
    corridorEndIndex,
    affectedStatementCount: uniqueAffected.length
  };
}

function isSuffixFragmentSelectiveSafe(
  fragment: SemanticStatementFragment
): boolean {
  const { effectSummary } = fragment;
  if (effectSummary.opaqueReasons.includes("macro-origin")) {
    return false;
  }
  return (
    effectSummary.suffixSkipKind === "safe" ||
    effectSummary.suffixSkipKind === "scope-safe" ||
    effectSummary.suffixSkipKind === "foreach-origin-safe"
  );
}

function decideFallbackReason(
  hints: IncrementalSemanticHints,
  cached: CachedSemanticRun | null,
  statementIds: readonly string[]
): IncrementalSemanticFallbackReason | null {
  const trigger = hints.trigger ?? "other";
  if (trigger !== "drag-element" && trigger !== "drag-handle") {
    return "non-drag-trigger";
  }
  if (!hints.changedSourceIds || hints.changedSourceIds.length === 0) {
    return "missing-changed-source-ids";
  }
  if (!cached) {
    return "no-previous-cache";
  }
  if (!sameStatementIds(cached.statementIds, statementIds)) {
    return "statement-structure-changed";
  }
  return null;
}

function sameStatementIds(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function shouldCaptureCheckpoint(
  statementIndex: number,
  checkpointInterval: number
): boolean {
  if (statementIndex === 0) {
    return true;
  }
  return statementIndex % checkpointInterval === 0;
}

function findCheckpointIndexAtOrBefore(
  checkpoints: ReadonlyMap<number, unknown>,
  statementIndex: number
): number | null {
  if (checkpoints.has(statementIndex)) {
    return statementIndex;
  }

  let best: number | null = null;
  for (const index of checkpoints.keys()) {
    if (index > statementIndex) {
      continue;
    }
    if (best == null || index > best) {
      best = index;
    }
  }
  return best;
}

function cloneCheckpointsBefore<T>(
  checkpoints: ReadonlyMap<number, T>,
  statementIndexExclusive: number
): Map<number, T> {
  const cloned = new Map<number, T>();
  for (const [checkpointIndex, value] of checkpoints) {
    if (checkpointIndex >= statementIndexExclusive) {
      continue;
    }
    cloned.set(checkpointIndex, value);
  }
  return cloned;
}

function cloneFeatureUsage(featureUsage: FeatureUsage): FeatureUsage {
  return { ...featureUsage };
}

function assignFeatureUsage(target: FeatureUsage, source: FeatureUsage): void {
  for (const key of Object.keys(target)) {
    target[key] = source[key] ?? target[key];
  }
}

function mapSourceStatementFirstIndices(
  source: Record<string, number>
): Map<string, number> {
  const mapped = new Map<string, number>();
  for (const [sourceId, index] of Object.entries(source)) {
    if (!Number.isInteger(index) || index < 0) {
      continue;
    }
    mapped.set(sourceId, index);
  }
  return mapped;
}

function unmapSourceStatementFirstIndices(
  source: ReadonlyMap<string, number>
): Record<string, number> {
  return Object.fromEntries([...source.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function normalizeChangedSourceIds(
  sourceIds: readonly string[]
): string[] {
  const unique = new Set<string>();
  for (const sourceId of sourceIds) {
    const normalized = sourceId.trim();
    if (normalized.length === 0) {
      continue;
    }
    unique.add(normalized);
  }
  return [...unique];
}

function retargetElementsSourceFingerprint(
  elements: readonly SceneElement[],
  sourceFingerprint: string
): SceneElement[] {
  return elements.map((element) => {
    if (element.sourceRef.sourceFingerprint === sourceFingerprint) {
      return element;
    }
    return {
      ...element,
      sourceRef: {
        ...element.sourceRef,
        sourceFingerprint
      }
    };
  });
}

function retargetHandlesSourceFingerprint(
  handles: readonly EditHandle[],
  sourceFingerprint: string
): EditHandle[] {
  return handles.map((handle) => {
    if (handle.sourceRef.sourceFingerprint === sourceFingerprint) {
      return handle;
    }
    return {
      ...handle,
      sourceRef: {
        ...handle.sourceRef,
        sourceFingerprint
      }
    };
  });
}

function materializeFragmentForCurrentSource(
  fragment: SemanticStatementFragment,
  currentSourceSpan: Span,
  source: string,
  sourceFingerprint: string
): Pick<SemanticStatementFragment, "elements" | "editHandles"> {
  if (fragment.effectSummary.suffixSkipKind === "foreach-origin-safe") {
    const elements = retargetElementsSourceFingerprint(
      rebaseForeachOriginElements(
        structuredClone(fragment.elements),
        fragment.sourceId,
        currentSourceSpan
      ),
      sourceFingerprint
    );
    const editHandles = retargetHandlesSourceFingerprint(
      structuredClone(fragment.editHandles),
      sourceFingerprint
    );
    return {
      elements,
      editHandles
    };
  }

  const delta = currentSourceSpan.from - fragment.sourceSpan.from;
  const elements = retargetElementsSourceFingerprint(
    shiftSpansDeep(structuredClone(fragment.elements), delta),
    sourceFingerprint
  );
  const editHandles = retargetHandlesSourceFingerprint(
    shiftSpansDeep(structuredClone(fragment.editHandles), delta),
    sourceFingerprint
  ).map((handle) => ({
    ...handle,
    sourceText: source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to)
  }));
  return {
    elements,
    editHandles
  };
}

function shiftSpansDeep<T>(value: T, delta: number): T {
  if (delta === 0) {
    return value;
  }
  shiftSpanObjectsInPlace(value, delta, new WeakSet<object>());
  return value;
}

function shiftSpanObjectsInPlace(
  value: unknown,
  delta: number,
  visited: WeakSet<object>
): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (visited.has(value)) {
    return;
  }
  visited.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      shiftSpanObjectsInPlace(entry, delta, visited);
    }
    return;
  }
  if (isSpanLike(value)) {
    value.from += delta;
    value.to += delta;
    return;
  }
  for (const entry of Object.values(value)) {
    shiftSpanObjectsInPlace(entry, delta, visited);
  }
}

function isSpanLike(value: object): value is Span {
  return (
    "from" in value &&
    "to" in value &&
    typeof (value as { from?: unknown }).from === "number" &&
    typeof (value as { to?: unknown }).to === "number" &&
    Object.keys(value).every((key) => key === "from" || key === "to")
  );
}

function rebaseForeachOriginElements(
  elements: SceneElement[],
  sourceId: string,
  currentSourceSpan: Span
): SceneElement[] {
  for (const element of elements) {
    if (element.sourceRef.sourceId === sourceId) {
      element.sourceRef = {
        ...element.sourceRef,
        sourceSpan: { ...currentSourceSpan }
      };
    }
    const foreachStack = element.origin?.foreachStack;
    if (!foreachStack) {
      continue;
    }
    for (let index = 0; index < foreachStack.length; index += 1) {
      const frame = foreachStack[index];
      if (frame?.loopId !== sourceId) {
        continue;
      }
      foreachStack[index] = {
        ...frame,
        loopSpan: { ...currentSourceSpan }
      };
    }
  }
  return elements;
}
