import type { NodeTextRenderInfo } from "../../text/types.js";

export type NodeShape = "rectangle" | "circle" | "ellipse" | "diamond" | "trapezium" | "coordinate";
export type NodeLayer = "front" | "behind";

export type NodeLayout = {
  textLines: string[];
  textBlockWidth: number;
  textBlockHeight: number;
  textRenderInfo: NodeTextRenderInfo;
  visualWidth: number;
  visualHeight: number;
  visualRadius: number;
  anchorHalfWidth: number;
  anchorHalfHeight: number;
  anchorRadius: number;
  baseLineY: number;
  midLineY: number;
};
