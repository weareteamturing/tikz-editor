import type { SyntaxNode } from "@lezer/common";

import { coordinateItemId } from "../../ast/ids.js";
import type { CoordinateItem } from "../../ast/types.js";
import type { ParsedCoordinate } from "./types.js";

export function mapCoordinateItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): CoordinateItem {
  const raw = source.slice(node.from, node.to);
  const parsed = parseCoordinate(raw);

  return {
    kind: "Coordinate",
    id: coordinateItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    x: parsed.x,
    y: parsed.y,
    raw,
    form: parsed.form
  };
}

export function parseCoordinate(raw: string): ParsedCoordinate {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("(")) {
    return { x: "", y: "", form: "unknown", isWellFormed: false };
  }

  const hasClosingParen = trimmed.endsWith(")");
  if (!hasClosingParen) {
    return { x: "", y: "", form: "unknown", isWellFormed: false };
  }

  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return { x: "", y: "", form: "unknown", isWellFormed: false };
  }

  if (inner.includes("$")) {
    return { x: inner, y: "", form: "calc", isWellFormed: true };
  }

  const commaSplit = splitAtTopLevel(inner, ",");
  if (commaSplit) {
    const x = commaSplit.left.trim();
    const y = commaSplit.right.trim();
    return {
      x,
      y,
      form: "cartesian",
      isWellFormed: x.length > 0 && y.length > 0
    };
  }

  const colonSplit = splitAtTopLevel(inner, ":");
  if (colonSplit) {
    const angle = colonSplit.left.trim();
    const radius = colonSplit.right.trim();
    return {
      x: angle,
      y: radius,
      form: "polar",
      isWellFormed: angle.length > 0 && radius.length > 0
    };
  }

  return {
    x: inner,
    y: "",
    form: "named",
    isWellFormed: true
  };
}

export function splitAtTopLevel(input: string, separator: string): { left: string; right: string } | null {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === separator && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return {
        left: input.slice(0, i),
        right: input.slice(i + 1)
      };
    }
  }

  return null;
}
