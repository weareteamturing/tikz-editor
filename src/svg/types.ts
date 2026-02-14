import type { NodeTextEngine } from "../text/types.js";

export type SvgViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EmitSvgOptions = {
  padding?: number;
  includeXmlns?: boolean;
  textEngine?: NodeTextEngine | null;
};

export type EmitSvgResult = {
  svg: string;
  viewBox: SvgViewBox;
  diagnostics: Array<{
    code: string;
    message: string;
  }>;
};
