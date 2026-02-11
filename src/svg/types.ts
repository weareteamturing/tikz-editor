export type SvgViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EmitSvgOptions = {
  padding?: number;
  includeXmlns?: boolean;
};

export type EmitSvgResult = {
  svg: string;
  viewBox: SvgViewBox;
  diagnostics: Array<{
    code: string;
    message: string;
  }>;
};

