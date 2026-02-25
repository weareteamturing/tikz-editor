import type { NodeTextEngine } from "../text/types.js";

export type SvgViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SvgRenderPart = {
  partId: string;
  sourceId: string;
  elementId: string | null;
  order: number;
  markup: string;
  fingerprint: string;
};

export type SvgRenderModel = {
  viewBox: SvgViewBox;
  defs: string[];
  defsFingerprint: string;
  parts: SvgRenderPart[];
  diagnostics: Array<{
    code: string;
    message: string;
  }>;
};

export type SvgDiffHints = {
  affectedSourceIds?: readonly string[];
};

export type SvgPatchOp =
  | {
      kind: "upsertPart";
      part: SvgRenderPart;
      afterPartId: string | null;
    }
  | {
      kind: "removePart";
      partId: string;
    }
  | {
      kind: "setViewBox";
      viewBox: SvgViewBox;
    }
  | {
      kind: "replaceDefs";
      defs: string[];
      defsFingerprint: string;
    }
  | {
      kind: "replaceAll";
      model: SvgRenderModel;
    };

export type EmitSvgOptions = {
  padding?: number;
  includeXmlns?: boolean;
  textEngine?: NodeTextEngine | null;
  /**
   * Optional render-model reuse hints for exact incremental SVG emission.
   * If invariants do not hold, emitter falls back to full model emission.
   */
  reuse?: {
    previousModel?: SvgRenderModel | null;
    affectedSourceIds?: readonly string[] | null;
  };
};

export type EmitSvgResult = {
  svg: string;
  viewBox: SvgViewBox;
  model: SvgRenderModel;
  diagnostics: Array<{
    code: string;
    message: string;
  }>;
};
