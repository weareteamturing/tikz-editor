import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";
import { parseCoordinateLike, parseLength } from "../coords/parse-length.js";
import type { ResolvedStyle } from "../types.js";

export function parseStyleValueAsOptionList(valueRaw: string): OptionListAst | null {
  const trimmed = valueRaw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let inner = trimmed;
  if (inner.startsWith("{") && inner.endsWith("}")) {
    inner = inner.slice(1, -1).trim();
  }

  if (inner.length === 0) {
    return null;
  }

  const optionRaw = inner.startsWith("[") ? inner : `[${inner}]`;
  return parseOptionListRaw(optionRaw);
}

export function parseFontStyle(raw: string): Pick<ResolvedStyle, "fontStyle"> | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes("itshape") || normalized.includes("slshape")) {
    return { fontStyle: "italic" };
  }
  if (normalized.includes("upshape") || normalized.includes("normalfont")) {
    return { fontStyle: "normal" };
  }
  return null;
}

export function parseAxisVector(raw: string, axis: "x" | "y"): { x: number; y: number } | null {
  const pair = parseCoordinateLike(raw);
  if (pair) {
    const x = parseLength(pair.x, "cm");
    const y = parseLength(pair.y, "cm");
    if (x == null || y == null) {
      return null;
    }
    return { x, y };
  }

  const length = parseLength(raw, "cm");
  if (length == null) {
    return null;
  }
  return axis === "x" ? { x: length, y: 0 } : { x: 0, y: length };
}

export function normalizeOptionValue(raw: string): string {
  return stripEnclosingBraces(raw).trim();
}

export function stripEnclosingBraces(raw: string): string {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    return trimmed;
  }

  const block = readBalancedBlock(trimmed, 0, "{", "}");
  if (!block || block.nextIndex !== trimmed.length) {
    return trimmed;
  }
  return block.content.trim();
}

export function readOptionalBracketOptions(input: string, startIndex: number): { optionsRaw: string | null; nextIndex: number } {
  let cursor = startIndex;
  while (cursor < input.length && /\s/.test(input[cursor] ?? "")) {
    cursor += 1;
  }
  if (input[cursor] !== "[") {
    return { optionsRaw: null, nextIndex: cursor };
  }
  const block = readBalancedBlock(input, cursor, "[", "]");
  if (!block) {
    return { optionsRaw: null, nextIndex: cursor };
  }
  return { optionsRaw: block.content, nextIndex: block.nextIndex };
}

export function readBalancedBlock(
  input: string,
  startIndex: number,
  open: string,
  close: string
): { content: string; nextIndex: number } | null {
  if (input[startIndex] !== open) {
    return null;
  }

  let depth = 0;
  for (let index = startIndex; index < input.length; index += 1) {
    const char = input[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: input.slice(startIndex + 1, index),
          nextIndex: index + 1
        };
      }
    }
  }

  return null;
}

export function findTopLevelCharacter(input: string, character: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "\\") {
      index += 1;
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
    if (char === character && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return index;
    }
  }

  return -1;
}
