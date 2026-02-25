import type { ParseTikzResult } from "tikz-editor/parser/index";
import type { EvaluateTikzResult } from "tikz-editor/semantic/index";
import type { EmitSvgResult, SvgRenderModel } from "tikz-editor/svg/index";
import type { EditHandle, SceneFigure } from "tikz-editor/semantic/types";
import type { RenderDiagnostic } from "tikz-editor/render/index";
import type { NodeTextEngine } from "tikz-editor/text/types";
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
  strategy: IncrementalSemanticStats["strategy"];
  fallbackReason: IncrementalSemanticStats["fallbackReason"];
  recomputeFromStatementIndex: number | null;
  recomputedStatementCount: number;
  reusedStatementCount: number;
};

export type ComputeRequest = {
  /** UUID identifying this request; used to discard stale responses. */
  id: string;
  source: string;
  changedSourceIds?: string[] | null;
  trigger?: IncrementalSemanticTrigger;
};

export type ComputeResponse = {
  /** Matches the request id. */
  id: string;
  snapshot: SessionSnapshot;
  diagnostics: RenderDiagnostic[];
};

let revisionCounter = 0;
let incrementalSession: IncrementalSemanticSession | null = null;
let textEnginePromise: Promise<NodeTextEngine | null> | null = null;

export function makeEmptySnapshot(source: string = ""): SessionSnapshot {
  return {
    source,
    revision: 0,
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

  try {
    const trigger = request.trigger ?? "other";
    const changedSourceIds = normalizeChangedSourceIds(request.changedSourceIds ?? []);
    const isDragTrigger = trigger === "drag-element" || trigger === "drag-handle";
    if (isDragTrigger && changedSourceIds.length > 0) {
      const result = await computeSnapshotIncremental(request.source, changedSourceIds, trigger);
      const snapshot: SessionSnapshot = {
        source: request.source,
        revision,
        editHandles: result.semantic.editHandles,
        scene: result.semantic.scene,
        svg: result.svg,
        svgModel: result.svg.model,
        parseResult: result.parse,
        semanticResult: result.semantic,
        incremental: {
          trigger,
          changedSourceIds,
          strategy: result.stats.strategy,
          fallbackReason: result.stats.fallbackReason,
          recomputeFromStatementIndex: result.stats.recomputeFromStatementIndex,
          recomputedStatementCount: result.stats.recomputedStatementCount,
          reusedStatementCount: result.stats.reusedStatementCount
        }
      };
      return {
        id: request.id,
        snapshot,
        diagnostics: result.renderDiagnostics
      };
    }

    const { renderTikzToSvgAsync } = await import("tikz-editor/render/index");
    const result = await renderTikzToSvgAsync(request.source, {
      parse: { recover: true },
      svg: { padding: 18 }
    });
    // Non-drag requests currently bypass the incremental session.
    // Reset to avoid reusing stale cached prefixes on the next drag.
    incrementalSession?.reset();

    const snapshot: SessionSnapshot = {
      source: request.source,
      revision,
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
      snapshot,
      diagnostics: result.renderDiagnostics
    };
  } catch (error) {
    incrementalSession?.reset();
    const snapshot: SessionSnapshot = {
      source: request.source,
      revision,
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
  changedSourceIds: string[],
  trigger: Extract<IncrementalSemanticTrigger, "drag-element" | "drag-handle">
): Promise<{
  parse: ParseTikzResult;
  semantic: EvaluateTikzResult;
  svg: EmitSvgResult;
  stats: IncrementalSemanticStats;
  renderDiagnostics: RenderDiagnostic[];
}> {
  const [{ parseTikz }, { emitSvg }] = await Promise.all([
    import("tikz-editor/parser/index"),
    import("tikz-editor/svg/index")
  ]);
  const textEngine = await getOptionalTextEngine();
  const parseResult = parseTikz(source, { recover: true });
  const session = await getIncrementalSemanticSession();

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

  let svgResult = emitSvg(semanticResult.scene, {
    padding: 18,
    textEngine
  });

  const flushedPendingText = await textEngine?.flushPending?.();
  if (flushedPendingText) {
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
    svgResult = emitSvg(semanticResult.scene, {
      padding: 18,
      textEngine
    });
  }

  return {
    parse: parseResult,
    semantic: semanticResult,
    svg: svgResult,
    stats: incrementalStats,
    renderDiagnostics: []
  };
}

async function getIncrementalSemanticSession(): Promise<IncrementalSemanticSession> {
  if (incrementalSession) {
    return incrementalSession;
  }
  const { createIncrementalSemanticSession } = await import("tikz-editor/semantic/index");
  incrementalSession = createIncrementalSemanticSession();
  return incrementalSession;
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
