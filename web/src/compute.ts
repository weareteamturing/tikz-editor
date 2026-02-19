import { renderTikzToSvgAsync } from "tikz-editor/render/index";
import type { ParseTikzResult } from "tikz-editor/parser/index";
import type { EvaluateTikzResult } from "tikz-editor/semantic/index";
import type { EmitSvgResult } from "tikz-editor/svg/index";
import type { EditHandle, SceneFigure } from "tikz-editor/semantic/types";
import type { RenderDiagnostic } from "tikz-editor/render/index";

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
  parseResult: ParseTikzResult | null;
  semanticResult: EvaluateTikzResult | null;
};

export type ComputeRequest = {
  /** UUID identifying this request; used to discard stale responses. */
  id: string;
  source: string;
};

export type ComputeResponse = {
  /** Matches the request id. */
  id: string;
  snapshot: SessionSnapshot;
  diagnostics: RenderDiagnostic[];
};

let revisionCounter = 0;

export function makeEmptySnapshot(source: string = ""): SessionSnapshot {
  return {
    source,
    revision: 0,
    editHandles: [],
    scene: null,
    svg: null,
    parseResult: null,
    semanticResult: null
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
    const result = await renderTikzToSvgAsync(request.source, {
      parse: { recover: true },
      svg: { padding: 18 }
    });

    const snapshot: SessionSnapshot = {
      source: request.source,
      revision,
      editHandles: result.semantic.editHandles,
      scene: result.semantic.scene,
      svg: result.svg,
      parseResult: result.parse,
      semanticResult: result.semantic
    };

    return {
      id: request.id,
      snapshot,
      diagnostics: result.renderDiagnostics
    };
  } catch (error) {
    const snapshot: SessionSnapshot = {
      source: request.source,
      revision,
      editHandles: [],
      scene: null,
      svg: null,
      parseResult: null,
      semanticResult: null
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
