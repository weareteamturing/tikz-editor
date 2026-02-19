import type { ParseTikzResult } from "../parser/index.js";
import type { CoordinateItem, NodeItem, PathItem, Statement } from "../ast/types.js";
import type { EditHandle } from "../semantic/types.js";
import type { ApplyEditResult, EditIntent, EditIntentResult, TikzEdit } from "./types.js";
import { replaceSpan } from "./patch.js";
import { formatCoordinate } from "./style.js";
import { rewriteCoordinate } from "./rewrite.js";
import { computeSourceFingerprint } from "../utils/source-fingerprint.js";

export function applyEdit(parseResult: ParseTikzResult, edit: TikzEdit): ApplyEditResult {
  const target = findPathItem(parseResult.figure.body, edit.targetId);

  if (!target) {
    throw new Error(`Unknown edit target id: ${edit.targetId}`);
  }

  if (edit.kind === "updateCoordinate") {
    if (target.kind !== "Coordinate") {
      throw new Error(`Target ${edit.targetId} is not a coordinate.`);
    }

    const oldRaw = parseResult.source.slice(target.span.from, target.span.to);
    const replacement = formatCoordinate(oldRaw, edit.x, edit.y);
    const updated = replaceSpan(parseResult.source, target.span, replacement);

    return {
      source: updated.source,
      changedSpans: [updated.changedSpan]
    };
  }

  if (target.kind !== "Node") {
    throw new Error(`Target ${edit.targetId} is not a node.`);
  }

  const updated = replaceSpan(parseResult.source, target.textSpan, edit.text);

  return {
    source: updated.source,
    changedSpans: [updated.changedSpan]
  };
}

function findPathItem(statements: Statement[], targetId: string): PathItem | null {
  for (const statement of statements) {
    if (statement.kind === "Path") {
      for (const item of statement.items) {
        if (item.id === targetId) {
          return item;
        }
      }
    }

    if (statement.kind === "Scope") {
      const nested = findPathItem(statement.body, targetId);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

export function applyEditIntent(
  source: string,
  editHandles: EditHandle[],
  intent: EditIntent
): EditIntentResult {
  if (intent.kind === "move") {
    return applyMoveIntent(source, editHandles, intent);
  }

  return { kind: "error", message: `Unknown intent kind: ${(intent as { kind: string }).kind}` };
}

function applyMoveIntent(
  source: string,
  editHandles: EditHandle[],
  intent: Extract<EditIntent, { kind: "move" }>
): EditIntentResult {
  const handle = editHandles.find((h) => h.id === intent.handleId);
  if (!handle) {
    return { kind: "error", message: `Handle not found: ${intent.handleId}` };
  }

  if (handle.rewriteMode === "unsupported") {
    return {
      kind: "unsupported",
      reason: `Coordinate form "${handle.coordinateForm}" cannot be rewritten`,
      handleId: handle.id
    };
  }

  if (
    editHandles.some(
      (candidate) =>
        candidate.id !== handle.id &&
        candidate.sourceSpan.from === handle.sourceSpan.from &&
        candidate.sourceSpan.to === handle.sourceSpan.to
    )
  ) {
    return {
      kind: "unsupported",
      reason: "Edit target maps to a shared source span (e.g. foreach/macro expansion).",
      handleId: handle.id
    };
  }

  if (handle.sourceFingerprint !== computeSourceFingerprint(source)) {
    return { kind: "error", message: "Handle does not match current source (stale handle)." };
  }

  if (handle.sourceSpan.from < 0 || handle.sourceSpan.to > source.length || handle.sourceSpan.from >= handle.sourceSpan.to) {
    return { kind: "error", message: "Handle source span exceeds source length (stale handle?)" };
  }

  const currentSourceText = source.slice(handle.sourceSpan.from, handle.sourceSpan.to);
  if (currentSourceText !== handle.sourceText) {
    return { kind: "error", message: "Handle span content mismatch (stale handle)." };
  }

  const replacement = rewriteCoordinate(intent.newWorld, handle, source);
  if (replacement === null) {
    return {
      kind: "unsupported",
      reason: "Coordinate rewrite failed (non-invertible transform?)",
      handleId: handle.id
    };
  }

  const updated = replaceSpan(source, handle.sourceSpan, replacement);
  return {
    kind: "success",
    newSource: updated.source,
    patches: [
      {
        oldSpan: handle.sourceSpan,
        newSpan: updated.changedSpan,
        replacement
      }
    ]
  };
}

export function isCoordinateItem(item: PathItem): item is CoordinateItem {
  return item.kind === "Coordinate";
}

export function isNodeItem(item: PathItem): item is NodeItem {
  return item.kind === "Node";
}
