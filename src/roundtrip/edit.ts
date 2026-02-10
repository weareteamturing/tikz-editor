import type { ParseTikzResult } from "../parser/index.js";
import type { CoordinateItem, NodeItem, PathItem, Span, Statement } from "../ir/types.js";

export type TikzEdit =
  | { kind: "updateCoordinate"; targetId: string; x: string; y: string }
  | { kind: "updateNodeText"; targetId: string; text: string };

export type ApplyEditResult = {
  source: string;
  changedSpans: Span[];
};

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
    if (statement.kind !== "Path") {
      continue;
    }

    for (const item of statement.items) {
      if (item.id === targetId) {
        return item;
      }
    }
  }

  return null;
}

function replaceSpan(source: string, span: Span, replacement: string): { source: string; changedSpan: Span } {
  const next = `${source.slice(0, span.from)}${replacement}${source.slice(span.to)}`;

  return {
    source: next,
    changedSpan: {
      from: span.from,
      to: span.from + replacement.length
    }
  };
}

function formatCoordinate(oldRaw: string, x: string, y: string): string {
  const exact = oldRaw.match(/^\((\s*)([^,)]*)(\s*),(\s*)([^)]*)(\s*)\)$/s);
  if (exact) {
    return `(${exact[1]}${x}${exact[3]},${exact[4]}${y}${exact[6]})`;
  }

  const afterComma = /,\s+/.test(oldRaw) ? " " : "";
  return `(${x},${afterComma}${y})`;
}

export function isCoordinateItem(item: PathItem): item is CoordinateItem {
  return item.kind === "Coordinate";
}

export function isNodeItem(item: PathItem): item is NodeItem {
  return item.kind === "Node";
}
