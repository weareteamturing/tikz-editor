export type NodeTextFontStyle = "normal" | "italic";
export type NodeTextFontWeight = "normal" | "bold";
export type NodeTextFontFamily = "serif" | "sans" | "monospace";

export type NodeTextValidationIssue = {
  code?: string;
  message: string;
};

export type NodeTextMeasureRequest = {
  text: string;
  textWidthPt: number | null;
  fontStyle: NodeTextFontStyle;
  fontWeight: NodeTextFontWeight;
  fontFamily: NodeTextFontFamily;
  fontSizePt: number;
};

export type NodeTextMetrics = {
  cacheKey: string;
  width: number;
  height: number;
  baselineY: number;
  midLineY: number;
};

export type NodeTextRenderPayload = {
  cacheKey: string;
  viewBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  body: string;
};

export type NodeTextRenderInfo =
  | {
      mode: "plain";
    }
  | {
      mode: "mathjax";
      cacheKey: string;
    };

export type NodeTextEngine = {
  validate(text: string): NodeTextValidationIssue | null;
  measure(request: NodeTextMeasureRequest): NodeTextMetrics | null;
  renderFromCache(cacheKey: string): NodeTextRenderPayload | null;
  /**
   * Resolve pending async renders and return the cache keys that became available
   * during this flush. Returns an empty list when nothing changed.
   */
  flushPending?(): Promise<readonly string[]>;
};
