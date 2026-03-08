import { coordinateInner } from "./shared.js";
import { parseLength } from "../coords/parse-length.js";

export function parseCoordinateOperation(raw: string): { name: string } | null {
  const inlineWithAt = raw.match(/coordinate\s*\(([^\)]+)\)\s*at\s*(\([^\)]+\))/i);
  if (inlineWithAt) {
    return { name: inlineWithAt[1].trim() };
  }

  const simple = raw.match(/coordinate\s*\(([^\)]+)\)/i);
  if (!simple) {
    return null;
  }
  return { name: simple[1].trim() };
}

export function parseCircleRadiusFromCoordinateRaw(raw: string): number | null {
  const inner = coordinateInner(raw);
  if (!inner) {
    return null;
  }

  if (inner.includes(",") || inner.includes(":") || /\band\b/i.test(inner)) {
    return null;
  }

  return parseLength(inner, "cm");
}

export function parseEllipseRadiiFromCoordinateRaw(raw: string): { rx: number; ry: number } | null {
  const inner = coordinateInner(raw);
  if (!inner) {
    return null;
  }

  const match = inner.match(/^(.+?)\s+and\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const rx = parseLength(match[1].trim(), "cm");
  const ry = parseLength(match[2].trim(), "cm");
  if (rx == null || ry == null) {
    return null;
  }

  return { rx, ry };
}
