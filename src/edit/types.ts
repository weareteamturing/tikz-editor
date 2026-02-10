import type { Span } from "../ast/types.js";

export type TikzEdit =
  | { kind: "updateCoordinate"; targetId: string; x: string; y: string }
  | { kind: "updateNodeText"; targetId: string; text: string };

export type ApplyEditResult = {
  source: string;
  changedSpans: Span[];
};
