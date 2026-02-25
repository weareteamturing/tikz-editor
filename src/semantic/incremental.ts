import type { TikzFigure } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import {
  restoreSemanticContext,
  retargetEditHandlesSourceFingerprint,
  snapshotSemanticContext,
  type SemanticContextSnapshot
} from "./context.js";
import { collectGeometryInvalidation } from "./dependencies.js";
import {
  createSemanticEvaluationRun,
  evaluateSemanticStatementByIndex,
  finalizeSemanticEvaluationRun,
  type EvaluateTikzResult
} from "./evaluate.js";
import type { EvaluateOptions, FeatureUsage, SceneElement } from "./types.js";

export type IncrementalSemanticTrigger = "drag-element" | "drag-handle" | "other";

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
  recomputeFromStatementIndex: number | null;
  recomputedStatementCount: number;
  reusedStatementCount: number;
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

type HandleRange = {
  start: number;
  end: number;
};

type CachedSemanticRun = {
  statementIds: string[];
  elementsByStatement: SceneElement[][];
  handleRangesByStatement: HandleRange[];
  diagnosticsByStatement: Diagnostic[][];
  checkpointsBeforeStatement: SemanticContextSnapshot[];
  featureUsageBeforeStatement: FeatureUsage[];
  dependencies: EvaluateTikzResult["dependencies"];
};

const STATEMENT_INDEX_PATTERN = /^[^:]+:(\d+)(?::|$)/;

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
      .map(parseStatementIndexFromSourceId)
      .filter((index): index is number => index != null && index >= 0 && index < statementCount);
    if (affectedStatementIndices.length === 0) {
      const full = evaluateFullyAndCache(run, statementIds, "unmapped-affected-source");
      cached = full.cached;
      return full.output;
    }
    const startIndex = Math.min(...affectedStatementIndices);

    const startCheckpoint = previous.checkpointsBeforeStatement[startIndex];
    if (!startCheckpoint) {
      const full = evaluateFullyAndCache(run, statementIds, "checkpoint-missing");
      cached = full.cached;
      return full.output;
    }
    const startFeatureUsage = previous.featureUsageBeforeStatement[startIndex];
    if (!startFeatureUsage) {
      const full = evaluateFullyAndCache(run, statementIds, "feature-checkpoint-missing");
      cached = full.cached;
      return full.output;
    }

    try {
      restoreSemanticContext(run.context, startCheckpoint);
      retargetEditHandlesSourceFingerprint(run.context.editHandles, run.context.sourceFingerprint);
    } catch (_error) {
      const full = evaluateFullyAndCache(run, statementIds, "restore-failed");
      cached = full.cached;
      return full.output;
    }

    try {
      assignFeatureUsage(run.featureUsage, startFeatureUsage);
      run.diagnostics.length = run.baseDiagnosticsCount;
      const diagnosticsByStatement = previous.diagnosticsByStatement.slice(0, startIndex);
      for (const statementDiagnostics of diagnosticsByStatement) {
        run.diagnostics.push(...statementDiagnostics);
      }

      const elementsByStatement = previous.elementsByStatement.slice(0, startIndex);
      const handleRangesByStatement = previous.handleRangesByStatement.slice(0, startIndex);
      const checkpointsBeforeStatement = previous.checkpointsBeforeStatement.slice(0, startIndex);
      const featureUsageBeforeStatement = previous.featureUsageBeforeStatement.slice(0, startIndex);

      for (let statementIndex = startIndex; statementIndex < statementCount; statementIndex += 1) {
        checkpointsBeforeStatement[statementIndex] = snapshotSemanticContext(run.context);
        featureUsageBeforeStatement[statementIndex] = cloneFeatureUsage(run.featureUsage);
        const evaluated = evaluateSemanticStatementByIndex(run, statementIndex);
        elementsByStatement[statementIndex] = evaluated.elements;
        handleRangesByStatement[statementIndex] = {
          start: evaluated.handleStart,
          end: evaluated.handleEnd
        };
        diagnosticsByStatement[statementIndex] = run.diagnostics.slice(
          evaluated.diagnosticsStart,
          evaluated.diagnosticsEnd
        );
      }
      checkpointsBeforeStatement[statementCount] = snapshotSemanticContext(run.context);
      featureUsageBeforeStatement[statementCount] = cloneFeatureUsage(run.featureUsage);

      const semantic = finalizeSemanticEvaluationRun(run, elementsByStatement);
      cached = {
        statementIds,
        elementsByStatement,
        handleRangesByStatement,
        diagnosticsByStatement,
        checkpointsBeforeStatement,
        featureUsageBeforeStatement,
        dependencies: semantic.dependencies
      };

      return {
        semantic,
        stats: {
          strategy: "incremental",
          recomputeFromStatementIndex: startIndex,
          recomputedStatementCount: statementCount - startIndex,
          reusedStatementCount: startIndex
        }
      };
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
  const elementsByStatement: SceneElement[][] = [];
  const handleRangesByStatement: HandleRange[] = [];
  const diagnosticsByStatement: Diagnostic[][] = [];
  const checkpointsBeforeStatement: SemanticContextSnapshot[] = [];
  const featureUsageBeforeStatement: FeatureUsage[] = [];

  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    checkpointsBeforeStatement[statementIndex] = snapshotSemanticContext(run.context);
    featureUsageBeforeStatement[statementIndex] = cloneFeatureUsage(run.featureUsage);
    const evaluated = evaluateSemanticStatementByIndex(run, statementIndex);
    elementsByStatement.push(evaluated.elements);
    handleRangesByStatement.push({
      start: evaluated.handleStart,
      end: evaluated.handleEnd
    });
    diagnosticsByStatement.push(
      run.diagnostics.slice(evaluated.diagnosticsStart, evaluated.diagnosticsEnd)
    );
  }
  checkpointsBeforeStatement[statementCount] = snapshotSemanticContext(run.context);
  featureUsageBeforeStatement[statementCount] = cloneFeatureUsage(run.featureUsage);

  const semantic = finalizeSemanticEvaluationRun(run, elementsByStatement);
  const nextCached: CachedSemanticRun = {
    statementIds,
    elementsByStatement,
    handleRangesByStatement,
    diagnosticsByStatement,
    checkpointsBeforeStatement,
    featureUsageBeforeStatement,
    dependencies: semantic.dependencies
  };
  return {
    output: {
      semantic,
      stats: {
        strategy: "full",
        recomputeFromStatementIndex: null,
        recomputedStatementCount: statementCount,
        reusedStatementCount: 0,
        fallbackReason
      }
    },
    cached: nextCached
  };
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

function parseStatementIndexFromSourceId(sourceId: string): number | null {
  const match = STATEMENT_INDEX_PATTERN.exec(sourceId);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function cloneFeatureUsage(featureUsage: FeatureUsage): FeatureUsage {
  return { ...featureUsage };
}

function assignFeatureUsage(target: FeatureUsage, source: FeatureUsage): void {
  for (const key of Object.keys(target)) {
    target[key] = source[key] ?? target[key];
  }
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
