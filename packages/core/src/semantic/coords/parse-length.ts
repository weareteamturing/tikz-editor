import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import {
  convertQuantityToLength,
  evaluatePgfMathExpression,
  type PgfMathQuantity
} from "../pgfmath/evaluator.js";

export type ParsedQuantity = PgfMathQuantity;

export function parseLength(input: string, defaultUnit: "cm" | "pt"): number | null {
  const quantity = parseQuantityExpression(input);
  if (quantity == null) {
    return null;
  }
  return convertQuantityToLength(quantity, defaultUnit);
}

export function parseQuantityExpression(input: string): ParsedQuantity | null {
  const result = evaluatePgfMathExpression(input);
  if (result.ok === false) {
    return null;
  }
  return result.quantity;
}

export function parseCoordinateLike(raw: string): { x: string; y: string } | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("(") === false || trimmed.endsWith(")") === false) {
    return null;
  }

  const inner = trimmed.slice(1, -1).trim();
  const parts = splitAllAtTopLevel(inner, ",").map((part) => part.trim());
  if (parts.length < 2) {
    return null;
  }
  return { x: parts[0], y: parts[1] };
}
