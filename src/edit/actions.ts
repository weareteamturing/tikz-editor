import type { EditHandle, Point } from "../semantic/types.js";
import type { SourcePatch } from "./types.js";
import { applyEditIntent } from "./apply.js";
import { rewriteCoordinate } from "./rewrite.js";
import { replaceSpan } from "./patch.js";

export type ResizeRole =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top"
  | "bottom"
  | "left"
  | "right";

export type StyleLevel = "command" | "scope" | "named-style" | "preamble";

export type ElementTemplate =
  | { kind: "node"; text?: string }
  | { kind: "line"; hasArrow?: boolean }
  | { kind: "rectangle" }
  | { kind: "circle" }
  | { kind: "filledCircle" };

export type EditAction =
  | { kind: "moveElement"; elementId: string; delta: Point }
  | { kind: "moveHandle"; handleId: string; newWorld: Point }
  | { kind: "setProperty"; elementId: string; level: StyleLevel; key: string; value: string }
  | { kind: "addElement"; template: ElementTemplate; at: Point }
  | { kind: "deleteElement"; elementId: string }
  | { kind: "resizeElement"; elementId: string; role: ResizeRole; newWorld: Point };

export type EditActionResult =
  | { kind: "success"; newSource: string; patches: SourcePatch[] }
  | {
      kind: "partial";
      newSource: string;
      patches: SourcePatch[];
      skippedHandles: string[];
      reason: string;
    }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

export function applyEditAction(
  source: string,
  editHandles: EditHandle[],
  action: EditAction
): EditActionResult {
  switch (action.kind) {
    case "moveHandle":
      return applyMoveHandle(source, editHandles, action.handleId, action.newWorld);
    case "moveElement":
      return applyMoveElement(source, editHandles, action.elementId, action.delta);
    case "setProperty":
    case "addElement":
    case "deleteElement":
    case "resizeElement":
      return { kind: "unsupported", reason: `${action.kind} is not yet implemented` };
  }
}

function applyMoveHandle(
  source: string,
  editHandles: EditHandle[],
  handleId: string,
  newWorld: Point
): EditActionResult {
  const result = applyEditIntent(source, editHandles, { kind: "move", handleId, newWorld });
  if (result.kind === "success") {
    return { kind: "success", newSource: result.newSource, patches: result.patches };
  }
  if (result.kind === "unsupported") {
    return { kind: "unsupported", reason: result.reason };
  }
  return { kind: "error", message: result.message };
}

function applyMoveElement(
  source: string,
  editHandles: EditHandle[],
  elementId: string,
  delta: Point
): EditActionResult {
  const elementHandles = editHandles.filter((h) => h.sourceId === elementId);

  if (elementHandles.length === 0) {
    return { kind: "unsupported", reason: `No handles found for element ${elementId}` };
  }

  const rewritable = elementHandles.filter((h) => h.rewriteMode !== "unsupported");
  const skippedHandles = elementHandles
    .filter((h) => h.rewriteMode === "unsupported")
    .map((h) => h.id);

  if (rewritable.length === 0) {
    return {
      kind: "unsupported",
      reason: `All handles for element ${elementId} use unsupported coordinate forms`
    };
  }

  // Compute (span, replacement) pairs for all rewritable handles using the original source.
  // We use rewriteCoordinate directly (bypassing fingerprint check) since all handles are fresh
  // and we verify content matches before computing the replacement.
  type PendingReplacement = { span: { from: number; to: number }; text: string; handleId: string };
  const pending: PendingReplacement[] = [];

  for (const handle of rewritable) {
    const actualText = source.slice(handle.sourceSpan.from, handle.sourceSpan.to);
    if (actualText !== handle.sourceText) {
      skippedHandles.push(handle.id);
      continue;
    }

    const newWorld: Point = { x: handle.world.x + delta.x, y: handle.world.y + delta.y };
    const text = rewriteCoordinate(newWorld, handle, source);
    if (text !== null) {
      pending.push({ span: handle.sourceSpan, text, handleId: handle.id });
    } else {
      skippedHandles.push(handle.id);
    }
  }

  if (pending.length === 0) {
    return { kind: "unsupported", reason: "No coordinate rewrites succeeded" };
  }

  // Sort descending by span start so that lower-offset spans remain valid after each replacement.
  pending.sort((a, b) => b.span.from - a.span.from);

  let currentSource = source;
  const patches: SourcePatch[] = [];

  for (const { span, text } of pending) {
    const updated = replaceSpan(currentSource, span, text);
    patches.push({ oldSpan: span, newSpan: updated.changedSpan, replacement: text });
    currentSource = updated.source;
  }

  if (skippedHandles.length > 0) {
    return {
      kind: "partial",
      newSource: currentSource,
      patches,
      skippedHandles,
      reason: "Some handles use unsupported coordinate forms and were skipped"
    };
  }

  return { kind: "success", newSource: currentSource, patches };
}
