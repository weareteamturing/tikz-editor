import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";

const UNIT_FACTORS: Record<string, number> = {
  pt: 1,
  cm: 28.4527559055,
  mm: 2.84527559055,
  in: 72.27,
  ex: 4.3,
  em: 10
};

export function parseLength(input: string, defaultUnit: "cm" | "pt"): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = trimmed.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([A-Za-z]+)?$/);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  const unit = (match[2] ?? defaultUnit).toLowerCase();
  const factor = UNIT_FACTORS[unit];
  if (!Number.isFinite(value) || factor == null) {
    return null;
  }
  return value * factor;
}

export function parseCoordinateLike(raw: string): { x: string; y: string } | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    return null;
  }

  const inner = trimmed.slice(1, -1).trim();
  const parts = splitAllAtTopLevel(inner, ",").map((part) => part.trim());
  if (parts.length < 2) {
    return null;
  }
  return { x: parts[0], y: parts[1] };
}
