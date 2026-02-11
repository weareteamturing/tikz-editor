import type { PathCommand } from "../../ast/types.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import type { Matrix2D, Point, ResolvedStyle } from "../types.js";
import { multiplyMatrix, rotationMatrix, scaleMatrix, translationMatrix } from "../transform.js";
import { parseCoordinateLike, parseLength } from "../coords/parse-length.js";

const PT_PER_CM = 28.3464567;

const NAMED_COLORS = new Set([
  "black",
  "white",
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "brown",
  "gray"
]);

export type ResolvedContextDelta = {
  style: ResolvedStyle;
  transform: Matrix2D;
  diagnostics: string[];
};

export function defaultStyle(): ResolvedStyle {
  return {
    stroke: "black",
    fill: null,
    lineWidth: 0.4,
    markerStart: null,
    markerEnd: null,
    opacity: 1
  };
}

export function commandDefaultStyle(command: PathCommand): Partial<ResolvedStyle> {
  switch (command) {
    case "draw":
    case "path":
    case "pattern":
    case "shade":
    case "shadedraw":
      return {};
    case "fill":
      return { fill: "black", stroke: null };
    case "filldraw":
      return { fill: "black" };
    case "clip":
    case "useasboundingbox":
      return { stroke: null, fill: null };
    case "node":
    case "coordinate":
      return {};
    default:
      return {};
  }
}

export function resolveContextDelta(baseStyle: ResolvedStyle, baseTransform: Matrix2D, optionLists: OptionListAst[]): ResolvedContextDelta {
  const diagnostics: string[] = [];
  let style = { ...baseStyle };
  let transform = baseTransform;

  for (const list of optionLists) {
    for (const entry of list.entries) {
      const outcome = applyOptionEntry(entry, style, transform);
      style = outcome.style;
      transform = outcome.transform;
      diagnostics.push(...outcome.diagnostics);
    }
  }

  return { style, transform, diagnostics };
}

function applyOptionEntry(
  entry: OptionEntry,
  style: ResolvedStyle,
  transform: Matrix2D
): { style: ResolvedStyle; transform: Matrix2D; diagnostics: string[] } {
  if (entry.kind === "unknown") {
    return { style, transform, diagnostics: [] };
  }

  if (entry.kind === "flag") {
    return applyFlagEntry(entry.key, style, transform);
  }

  return applyKvEntry(entry.key, entry.valueRaw, style, transform);
}

function applyFlagEntry(
  key: string,
  style: ResolvedStyle,
  transform: Matrix2D
): { style: ResolvedStyle; transform: Matrix2D; diagnostics: string[] } {
  if (key === "thick") {
    return { style: { ...style, lineWidth: 0.8 }, transform, diagnostics: [] };
  }
  if (key === "very thick") {
    return { style: { ...style, lineWidth: 1.2 }, transform, diagnostics: [] };
  }
  if (key === "thin") {
    return { style: { ...style, lineWidth: 0.2 }, transform, diagnostics: [] };
  }
  if (key === "->") {
    return { style: { ...style, markerEnd: "arrow" }, transform, diagnostics: [] };
  }
  if (key === "<-") {
    return { style: { ...style, markerStart: "arrow" }, transform, diagnostics: [] };
  }
  if (key === "<->") {
    return { style: { ...style, markerStart: "arrow", markerEnd: "arrow" }, transform, diagnostics: [] };
  }
  if (NAMED_COLORS.has(key)) {
    return { style: { ...style, stroke: key }, transform, diagnostics: [] };
  }

  return {
    style,
    transform,
    diagnostics: [`unsupported-option-flag:${key}`]
  };
}

function applyKvEntry(
  key: string,
  valueRaw: string,
  style: ResolvedStyle,
  transform: Matrix2D
): { style: ResolvedStyle; transform: Matrix2D; diagnostics: string[] } {
  if (key === "fill") {
    return { style: { ...style, fill: normalizeColor(valueRaw) }, transform, diagnostics: [] };
  }
  if (key === "draw" || key === "color") {
    return { style: { ...style, stroke: normalizeColor(valueRaw) }, transform, diagnostics: [] };
  }
  if (key === "line width") {
    const length = parseLength(valueRaw, "pt");
    if (length == null) {
      return { style, transform, diagnostics: [`invalid-line-width:${valueRaw}`] };
    }
    return { style: { ...style, lineWidth: length }, transform, diagnostics: [] };
  }
  if (key === "opacity") {
    const value = Number(valueRaw);
    if (Number.isFinite(value)) {
      return { style: { ...style, opacity: clamp01(value) }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-opacity:${valueRaw}`] };
  }
  if (key === "xshift") {
    const shift = parseLength(valueRaw, "pt");
    if (shift == null) {
      return { style, transform, diagnostics: [`invalid-xshift:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, translationMatrix(shift, 0)), diagnostics: [] };
  }
  if (key === "yshift") {
    const shift = parseLength(valueRaw, "pt");
    if (shift == null) {
      return { style, transform, diagnostics: [`invalid-yshift:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, translationMatrix(0, shift)), diagnostics: [] };
  }
  if (key === "shift") {
    const vector = parseCoordinateLike(valueRaw);
    if (!vector) {
      return { style, transform, diagnostics: [`invalid-shift:${valueRaw}`] };
    }

    const x = parseLength(vector.x, "pt");
    const y = parseLength(vector.y, "pt");
    if (x == null || y == null) {
      return { style, transform, diagnostics: [`invalid-shift:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, translationMatrix(x, y)), diagnostics: [] };
  }
  if (key === "scale") {
    const factor = Number(valueRaw);
    if (!Number.isFinite(factor)) {
      return { style, transform, diagnostics: [`invalid-scale:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, scaleMatrix(factor, factor)), diagnostics: [] };
  }
  if (key === "xscale") {
    const factor = Number(valueRaw);
    if (!Number.isFinite(factor)) {
      return { style, transform, diagnostics: [`invalid-xscale:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, scaleMatrix(factor, 1)), diagnostics: [] };
  }
  if (key === "yscale") {
    const factor = Number(valueRaw);
    if (!Number.isFinite(factor)) {
      return { style, transform, diagnostics: [`invalid-yscale:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, scaleMatrix(1, factor)), diagnostics: [] };
  }
  if (key === "rotate") {
    const degrees = Number(valueRaw);
    if (!Number.isFinite(degrees)) {
      return { style, transform, diagnostics: [`invalid-rotate:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, rotationMatrix(degrees)), diagnostics: [] };
  }

  if (key === "radius") {
    const radius = parseLength(valueRaw, "cm");
    if (radius == null) {
      return { style, transform, diagnostics: [`invalid-radius:${valueRaw}`] };
    }
    return { style: { ...style, lineWidth: style.lineWidth }, transform, diagnostics: [`radius:${radius / PT_PER_CM}`] };
  }

  return {
    style,
    transform,
    diagnostics: [`unsupported-option-key:${key}`]
  };
}

export function extractCircleRadius(options: OptionListAst | undefined): number | null {
  if (!options) {
    return null;
  }

  for (const entry of options.entries) {
    if (entry.kind === "kv" && entry.key === "radius") {
      const radius = parseLength(entry.valueRaw, "cm");
      if (radius != null) {
        return radius;
      }
    }
  }

  return null;
}

function normalizeColor(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (NAMED_COLORS.has(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("#")) {
    return normalized;
  }
  return normalized || "black";
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function defaultCoordinateDelta(): Point {
  return { x: PT_PER_CM, y: PT_PER_CM };
}
