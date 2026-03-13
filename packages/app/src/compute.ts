import type { ParseTikzResult } from "tikz-editor/parser/index";
import type {
  IncrementalParseSession,
  IncrementalParseStats
} from "tikz-editor/parser/index";
import type { EvaluateTikzResult } from "tikz-editor/semantic/index";
import type { EmitSvgOptions, EmitSvgResult, SvgRenderModel } from "tikz-editor/svg/index";
import type { EditHandle, SceneFigure } from "tikz-editor/semantic/types";
import type { RenderDiagnostic } from "tikz-editor/render/index";
import type { NodeTextEngine } from "tikz-editor/text/types";
import type { SourcePatch } from "tikz-editor/edit/types";
import type {
  IncrementalSemanticStats,
  IncrementalSemanticSession,
  IncrementalSemanticTrigger
} from "tikz-editor/semantic/index";

/**
 * A plain-data snapshot of a fully evaluated TikZ document.
 * Structured-clone compatible — ready for Web Worker transfer.
 */
export type SessionSnapshot = {
  source: string;
  revision: number;
  figures: ParseTikzResult["figures"];
  activeFigureId: string | null;
  editHandles: EditHandle[];
  scene: SceneFigure | null;
  svg: EmitSvgResult | null;
  svgModel: SvgRenderModel | null;
  parseResult: ParseTikzResult | null;
  semanticResult: EvaluateTikzResult | null;
  incremental: SessionSnapshotIncrementalInfo | null;
};

export type SessionSnapshotIncrementalInfo = {
  trigger: Extract<IncrementalSemanticTrigger, "drag-element" | "drag-handle">;
  changedSourceIds: string[];
  parseStrategy: IncrementalParseStats["strategy"];
  parseFallbackReason: IncrementalParseStats["fallbackReason"];
  reparsedStatementCount: number;
  parserReusedStatementCount: number;
  strategy: IncrementalSemanticStats["strategy"];
  replayMode?: IncrementalSemanticStats["replayMode"];
  fallbackReason: IncrementalSemanticStats["fallbackReason"];
  recomputeFromStatementIndex: number | null;
  recomputedStatementCount: number;
  reusedStatementCount: number;
  corridorEndStatementIndex?: number | null;
  affectedStatementCount?: number;
};

export type ComputeRequest = {
  /** UUID identifying this request; used to discard stale responses. */
  id: string;
  documentId?: string;
  source: string;
  activeFigureId?: string | null;
  changedSourceIds?: string[] | null;
  patches?: SourcePatch[] | null;
  trigger?: IncrementalSemanticTrigger;
  kind?: "render" | "prewarm";
};

export type ComputeResponse = {
  /** Matches the request id. */
  id: string;
  documentId?: string;
  snapshot: SessionSnapshot;
  diagnostics: RenderDiagnostic[];
};

let revisionCounter = 0;
let incrementalSemanticSession: IncrementalSemanticSession | null = null;
let incrementalParseSession: IncrementalParseSession | null = null;
let textEnginePromise: Promise<NodeTextEngine | null> | null = null;
let previousSvgModel: SvgRenderModel | null = null;
let incrementalWarmSource: string | null = null;

export function makeEmptySnapshot(source: string = ""): SessionSnapshot {
  return {
    source,
    revision: 0,
    figures: [],
    activeFigureId: null,
    editHandles: [],
    scene: null,
    svg: null,
    svgModel: null,
    parseResult: null,
    semanticResult: null,
    incremental: null
  };
}

/**
 * Compute a full SessionSnapshot for the given source.
 * Phase 0: synchronous implementation wrapped in a Promise.
 * The interface is designed so a Web Worker can be swapped in later.
 */
export async function computeSnapshot(request: ComputeRequest): Promise<ComputeResponse> {
  const revision = ++revisionCounter;
  const requestKind = request.kind ?? "render";

  try {
    const trigger = request.trigger ?? "other";
    const changedSourceIds = normalizeChangedSourceIds(request.changedSourceIds ?? []);
    const patches = normalizePatches(request.patches ?? []);
    const isDragTrigger = trigger === "drag-element" || trigger === "drag-handle";
    if (requestKind === "prewarm" && incrementalWarmSource === request.source) {
      return {
        id: request.id,
        documentId: request.documentId,
        snapshot: makeEmptySnapshot(request.source),
        diagnostics: []
      };
    }
    if (isDragTrigger && changedSourceIds.length > 0) {
      const result = await computeSnapshotIncremental(
        request.source,
        request.activeFigureId,
        changedSourceIds,
        patches,
        trigger
      );
      const snapshot: SessionSnapshot = {
        source: request.source,
        revision,
        figures: result.parse.figures,
        activeFigureId: result.parse.activeFigureId,
        editHandles: result.semantic.editHandles,
        scene: result.semantic.scene,
        svg: result.svg,
        svgModel: result.svg.model,
        parseResult: result.parse,
        semanticResult: result.semantic,
        incremental: {
          trigger,
          changedSourceIds,
          parseStrategy: result.parseStats.strategy,
          parseFallbackReason: result.parseStats.fallbackReason,
          reparsedStatementCount: result.parseStats.reparsedStatementCount,
          parserReusedStatementCount: result.parseStats.reusedStatementCount,
          strategy: result.semanticStats.strategy,
          replayMode: result.semanticStats.replayMode,
          fallbackReason: result.semanticStats.fallbackReason,
          recomputeFromStatementIndex: result.semanticStats.recomputeFromStatementIndex,
          recomputedStatementCount: result.semanticStats.recomputedStatementCount,
          reusedStatementCount: result.semanticStats.reusedStatementCount,
          corridorEndStatementIndex: result.semanticStats.corridorEndStatementIndex,
          affectedStatementCount: result.semanticStats.affectedStatementCount
        }
      };
      return {
        id: request.id,
        documentId: request.documentId,
        snapshot,
        diagnostics: result.renderDiagnostics
      };
    }

    const { renderTikzToSvgAsync } = await import("tikz-editor/render/index");
    const result = await renderTikzToSvgAsync(request.source, {
      parse: {
        recover: true,
        activeFigureId: request.activeFigureId,
        includeContextDefinitions: true
      },
      svg: { padding: 18 }
    });
    // Non-drag requests currently bypass the incremental session.
    // Reset to avoid reusing stale cached prefixes on the next drag.
    incrementalSemanticSession?.reset();
    incrementalWarmSource = request.source;
    const parseSession = await getIncrementalParseSession();
    parseSession.prime(result.parse, {
      activeFigureId: request.activeFigureId ?? result.parse.activeFigureId,
      includeContextDefinitions: true
    });
    const semanticSession = await getIncrementalSemanticSession();
    semanticSession.evaluate({
      figure: result.parse.figure,
      source: request.source,
      options: { textEngine: await getOptionalTextEngine() },
      hints: { trigger: "other" }
    });
    previousSvgModel = result.svg.model;

    const snapshot: SessionSnapshot = {
      source: request.source,
      revision,
      figures: result.parse.figures,
      activeFigureId: result.parse.activeFigureId,
      editHandles: result.semantic.editHandles,
      scene: result.semantic.scene,
      svg: result.svg,
      svgModel: result.svg.model,
      parseResult: result.parse,
      semanticResult: result.semantic,
      incremental: null
    };

    return {
      id: request.id,
      documentId: request.documentId,
      snapshot,
      diagnostics: result.renderDiagnostics
    };
  } catch (error) {
    incrementalSemanticSession?.reset();
    incrementalParseSession?.reset();
    incrementalWarmSource = null;
    previousSvgModel = null;
    const snapshot: SessionSnapshot = {
      source: request.source,
      revision,
      figures: [],
      activeFigureId: null,
      editHandles: [],
      scene: null,
      svg: null,
      svgModel: null,
      parseResult: null,
      semanticResult: null,
      incremental: null
    };

    return {
      id: request.id,
      documentId: request.documentId,
      snapshot,
      diagnostics: [
        {
          code: "compute-error",
          message: error instanceof Error ? error.message : String(error),
          severity: "error"
        }
      ]
    };
  }
}

async function computeSnapshotIncremental(
  source: string,
  activeFigureId: string | null | undefined,
  changedSourceIds: string[],
  patches: SourcePatch[],
  trigger: Extract<IncrementalSemanticTrigger, "drag-element" | "drag-handle">
): Promise<{
  parse: ParseTikzResult;
  semantic: EvaluateTikzResult;
  svg: EmitSvgResult;
  parseStats: IncrementalParseStats;
  semanticStats: IncrementalSemanticStats;
  renderDiagnostics: RenderDiagnostic[];
}> {
  const [{ emitSvg }, { collectGeometryInvalidation }] = await Promise.all([
    import("tikz-editor/svg/index"),
    import("tikz-editor/semantic/index")
  ]);
  const textEngine = await getOptionalTextEngine();
  const parseSession = await getIncrementalParseSession();
  const parseIncremental = parseSession.evaluate({
    source,
    activeFigureId,
    includeContextDefinitions: true,
    patches,
    changedSourceIds,
    trigger
  });
  const parseResult = parseIncremental.parse;
  const session = await getIncrementalSemanticSession();
  let reusePreviousModel = previousSvgModel;

  let incremental = session.evaluate({
    figure: parseResult.figure,
    source: parseResult.source,
    options: { textEngine },
    hints: {
      changedSourceIds,
      trigger
    }
  });
  let semanticResult = incremental.semantic;
  let incrementalStats = incremental.stats;
  let affectedSourceIdsForReuse = collectSvgReuseAffectedSourceIds(
    semanticResult,
    changedSourceIds,
    collectGeometryInvalidation
  );

  let svgResult = emitSvg(semanticResult.scene, {
    padding: 18,
    textEngine,
    reuse: buildSvgReuseHints(reusePreviousModel, affectedSourceIdsForReuse)
  });
  reusePreviousModel = svgResult.model;

  const flushedPendingTextKeys = await textEngine?.flushPending?.();
  if (flushedPendingTextKeys && flushedPendingTextKeys.length > 0) {
    incremental = session.evaluate({
      figure: parseResult.figure,
      source: parseResult.source,
      options: { textEngine },
      hints: {
        changedSourceIds,
        trigger
      }
    });
    semanticResult = incremental.semantic;
    incrementalStats = incremental.stats;
    const dependencyAffectedSourceIds = collectSvgReuseAffectedSourceIds(
      semanticResult,
      changedSourceIds,
      collectGeometryInvalidation
    );
    const mathJaxAffectedSourceIds = collectMathJaxTextSourceIdsByCacheKeys(semanticResult, flushedPendingTextKeys);
    affectedSourceIdsForReuse = mergeSourceIds(dependencyAffectedSourceIds, mathJaxAffectedSourceIds);
    svgResult = emitSvg(semanticResult.scene, {
      padding: 18,
      textEngine,
      reuse: buildSvgReuseHints(reusePreviousModel, affectedSourceIdsForReuse)
    });
    reusePreviousModel = svgResult.model;
  }

  previousSvgModel = reusePreviousModel;
  incrementalWarmSource = source;

  return {
    parse: parseResult,
    semantic: semanticResult,
    svg: svgResult,
    parseStats: parseIncremental.stats,
    semanticStats: incrementalStats,
    renderDiagnostics: []
  };
}

function collectMathJaxTextSourceIdsByCacheKeys(
  semanticResult: EvaluateTikzResult,
  changedCacheKeys: readonly string[]
): string[] {
  if (changedCacheKeys.length === 0) {
    return [];
  }
  const changed = new Set(changedCacheKeys);
  const sourceIds = new Set<string>();
  for (const element of semanticResult.scene.elements) {
    if (element.kind !== "Text" || element.textRenderInfo?.mode !== "mathjax") {
      continue;
    }
    if (!changed.has(element.textRenderInfo.cacheKey)) {
      continue;
    }
    sourceIds.add(element.sourceRef.sourceId);
  }
  return [...sourceIds].sort();
}

function mergeSourceIds(left: string[] | null, right: string[] | null): string[] | null {
  if ((!left || left.length === 0) && (!right || right.length === 0)) {
    return null;
  }
  const merged = new Set<string>();
  for (const sourceId of left ?? []) {
    merged.add(sourceId);
  }
  for (const sourceId of right ?? []) {
    merged.add(sourceId);
  }
  return [...merged].sort();
}

function collectSvgReuseAffectedSourceIds(
  semanticResult: EvaluateTikzResult,
  changedSourceIds: string[],
  collectGeometryInvalidation: (
    graph: EvaluateTikzResult["dependencies"],
    query: { changedSourceIds: readonly string[] }
  ) => { affectedSourceIds: string[]; reachedOpaque: boolean }
): string[] | null {
  const invalidation = collectGeometryInvalidation(semanticResult.dependencies, {
    changedSourceIds
  });
  if (invalidation.reachedOpaque) {
    return null;
  }
  if (invalidation.affectedSourceIds.length === 0) {
    return null;
  }
  return invalidation.affectedSourceIds;
}

function buildSvgReuseHints(
  previousModel: SvgRenderModel | null,
  affectedSourceIds: string[] | null
): EmitSvgOptions["reuse"] | undefined {
  if (!previousModel || !affectedSourceIds || affectedSourceIds.length === 0) {
    return undefined;
  }
  return {
    previousModel,
    affectedSourceIds
  };
}

async function getIncrementalSemanticSession(): Promise<IncrementalSemanticSession> {
  if (incrementalSemanticSession) {
    return incrementalSemanticSession;
  }
  const { createIncrementalSemanticSession } = await import("tikz-editor/semantic/index");
  incrementalSemanticSession = createIncrementalSemanticSession();
  return incrementalSemanticSession;
}

async function getIncrementalParseSession(): Promise<IncrementalParseSession> {
  if (incrementalParseSession) {
    return incrementalParseSession;
  }
  const { createIncrementalParseSession } = await import("tikz-editor/parser/index");
  incrementalParseSession = createIncrementalParseSession();
  return incrementalParseSession;
}

async function getOptionalTextEngine(): Promise<NodeTextEngine | null> {
  if (!textEnginePromise) {
    textEnginePromise = (async () => {
      try {
        const { createMathJaxNodeTextEngine } = await import("tikz-editor/text/mathjax-engine");
        return await createMathJaxNodeTextEngine();
      } catch (_error) {
        return null;
      }
    })();
  }
  return textEnginePromise;
}

function normalizeChangedSourceIds(sourceIds: readonly string[]): string[] {
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

function normalizePatches(patches: readonly SourcePatch[]): SourcePatch[] {
  return patches.map((patch) => ({
    oldSpan: { ...patch.oldSpan },
    newSpan: { ...patch.newSpan },
    replacement: patch.replacement
  }));
}
