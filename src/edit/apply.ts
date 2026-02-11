import type { ParseTikzResult } from "../parser/index.js";
import type { CoordinateItem, NodeItem, PathItem, Statement } from "../ast/types.js";
import type { ApplyEditResult, TikzEdit } from "./types.js";
import { replaceSpan } from "./patch.js";
import { formatCoordinate } from "./style.js";

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

export function isCoordinateItem(item: PathItem): item is CoordinateItem {
  return item.kind === "Coordinate";
}

export function isNodeItem(item: PathItem): item is NodeItem {
  return item.kind === "Node";
}
