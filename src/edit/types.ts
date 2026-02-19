import type { Span } from "../ast/types.js";
import type { Point } from "../semantic/types.js";

export type TikzEdit =
  | { kind: "updateCoordinate"; targetId: string; x: string; y: string }
  | { kind: "updateNodeText"; targetId: string; text: string };

export type ApplyEditResult = {
  source: string;
  changedSpans: Span[];
};

/** High-level editing intent (world coordinates, handle-based). */
export type EditIntent = { kind: "move"; handleId: string; newWorld: Point };

/** Result of applying an edit intent. */
export type EditIntentResult =
  | { kind: "success"; newSource: string; patches: SourcePatch[] }
  | { kind: "unsupported"; reason: string; handleId: string }
  | { kind: "error"; message: string };

/** A source text patch recording what was replaced and where. */
export type SourcePatch = {
  oldSpan: Span;
  newSpan: Span;
  replacement: string;
};
