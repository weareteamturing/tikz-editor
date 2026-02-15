import type { NodeTextRenderInfo } from "../../text/types.js";

export type NodeShape =
  | "rectangle"
  | "circle"
  | "ellipse"
  | "diamond"
  | "trapezium"
  | "semicircle"
  | "regular polygon"
  | "star"
  | "isosceles triangle"
  | "kite"
  | "dart"
  | "circular sector"
  | "cylinder"
  | "cloud"
  | "starburst"
  | "signal"
  | "tape"
  | "coordinate";
export type NodeLayer = "front" | "behind";

export type NodeLayout = {
  textLines: string[];
  textBlockWidth: number;
  textBlockHeight: number;
  textRenderInfo: NodeTextRenderInfo;
  naturalWidth: number;
  naturalHeight: number;
  minimumWidth: number;
  minimumHeight: number;
  outerXSep: number;
  outerYSep: number;
  visualWidth: number;
  visualHeight: number;
  visualRadius: number;
  anchorHalfWidth: number;
  anchorHalfHeight: number;
  anchorRadius: number;
  baseLineY: number;
  midLineY: number;
};
