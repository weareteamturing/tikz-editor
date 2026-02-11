import type { PathCommand } from "../../ast/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import type { Matrix2D, ResolvedStyle } from "../types.js";
import { multiplyMatrix, rotationMatrix, scaleMatrix, translationMatrix } from "../transform.js";
import { parseCoordinateLike, parseLength } from "../coords/parse-length.js";

const NAMED_COLORS = new Set([
  "black",
  "white",
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "brown",
  "gray",
  "purple",
  "cyan",
  "magenta"
]);

const COLOR_HEX: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  blue: "#0000ff",
  green: "#008000",
  yellow: "#ffff00",
  orange: "#ffa500",
  brown: "#8b4513",
  gray: "#808080",
  purple: "#800080",
  cyan: "#00ffff",
  magenta: "#ff00ff"
};

const NON_STYLE_OPTION_KEYS = new Set([
  "start angle",
  "end angle",
  "delta angle",
  "step",
  "xstep",
  "ystep",
  "x step",
  "y step",
  "name",
  "alias",
  "node contents",
  "at",
  "shape",
  "anchor",
  "inner sep",
  "inner xsep",
  "inner ysep",
  "outer sep",
  "outer xsep",
  "outer ysep",
  "minimum width",
  "minimum height",
  "minimum size",
  "shape aspect",
  "shape border rotate",
  "shape border uses incircle",
  "auto",
  "pos",
  "node distance",
  "above",
  "below",
  "left",
  "right",
  "above left",
  "above right",
  "below left",
  "below right",
  "base left",
  "base right",
  "mid left",
  "mid right",
  "node font",
  "font",
  "text width",
  "text height",
  "text depth",
  "node halign header",
  "badness warnings for centered text",
  "execute at begin node",
  "execute at end node",
  "name prefix",
  "name suffix",
  "every node/.style",
  "every node/.append style",
  "every rectangle node/.style",
  "every rectangle node/.append style",
  "every circle node/.style",
  "every circle node/.append style",
  "transform shape"
]);

const NON_STYLE_OPTION_FLAGS = new Set([
  "behind path",
  "in front of path",
  "circle",
  "rectangle",
  "coordinate",
  "above",
  "below",
  "left",
  "right",
  "above left",
  "above right",
  "below left",
  "below right",
  "centered",
  "midway",
  "near start",
  "near end",
  "very near start",
  "very near end",
  "at start",
  "at end",
  "swap",
  "sloped",
  "allow upside down",
  "bend at start",
  "bend at end",
  "transform shape"
]);

const PT_PER_CM = parseLength("1cm", "cm") ?? 28.4527559055;
export const DEFAULT_TEXT_FONT_SIZE = 9.96264;
const DEFAULT_DOUBLE_DISTANCE = 0.6;

export type ResolvedContextDelta = {
  style: ResolvedStyle;
  transform: Matrix2D;
  diagnostics: string[];
};

export function defaultStyle(): ResolvedStyle {
  return {
    stroke: "black",
    fill: null,
    textColor: null,
    textOpacity: 1,
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    fontStyle: "normal",
    doubleStroke: false,
    doubleDistance: DEFAULT_DOUBLE_DISTANCE,
    textAlign: "center",
    drawExplicit: false,
    radius: null,
    xRadius: null,
    yRadius: null,
    roundedCorners: null,
    lineWidth: 0.4,
    dashArray: null,
    lineCap: "butt",
    lineJoin: "miter",
    markerStart: null,
    markerEnd: null,
    opacity: 1,
    strokeOpacity: 1,
    fillOpacity: 1
  };
}

export function commandDefaultStyle(command: PathCommand, inheritedStyle: ResolvedStyle): Partial<ResolvedStyle> {
  switch (command) {
    case "draw":
      return {
        stroke: inheritedStyle.stroke ?? "black",
        drawExplicit: true
      };
    case "path":
      return {
        stroke: null,
        fill: null,
        drawExplicit: false
      };
    case "pattern":
      return {
        fill: inheritedStyle.fill ?? "black"
      };
    case "shade":
      return {
        fill: inheritedStyle.fill ?? "black",
        stroke: inheritedStyle.drawExplicit ? inheritedStyle.stroke ?? "black" : null
      };
    case "shadedraw":
      return {
        fill: inheritedStyle.fill ?? "black",
        stroke: inheritedStyle.stroke ?? "black",
        drawExplicit: true
      };
    case "fill":
      return {
        fill: inheritedStyle.fill ?? "black",
        stroke: inheritedStyle.drawExplicit ? inheritedStyle.stroke ?? "black" : null
      };
    case "filldraw":
      return {
        fill: inheritedStyle.fill ?? "black",
        stroke: inheritedStyle.stroke ?? "black",
        drawExplicit: true
      };
    case "clip":
    case "useasboundingbox":
      return {
        stroke: null,
        fill: null,
        drawExplicit: false
      };
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
  if (key === "draw") {
    return { style: { ...style, stroke: style.stroke ?? "black", drawExplicit: true }, transform, diagnostics: [] };
  }
  if (key === "fill") {
    return { style: { ...style, fill: style.fill ?? "black" }, transform, diagnostics: [] };
  }
  if (key === "rounded corners") {
    return { style: { ...style, roundedCorners: parseLength("4pt", "pt") ?? 4 }, transform, diagnostics: [] };
  }
  if (key === "sharp corners") {
    return { style: { ...style, roundedCorners: null }, transform, diagnostics: [] };
  }
  if (key === "ultra thin") {
    return { style: { ...style, lineWidth: 0.1 }, transform, diagnostics: [] };
  }
  if (key === "very thin") {
    return { style: { ...style, lineWidth: 0.2 }, transform, diagnostics: [] };
  }
  if (key === "thick") {
    return { style: { ...style, lineWidth: 0.8 }, transform, diagnostics: [] };
  }
  if (key === "semithick") {
    return { style: { ...style, lineWidth: 0.6 }, transform, diagnostics: [] };
  }
  if (key === "very thick") {
    return { style: { ...style, lineWidth: 1.2 }, transform, diagnostics: [] };
  }
  if (key === "ultra thick") {
    return { style: { ...style, lineWidth: 1.6 }, transform, diagnostics: [] };
  }
  if (key === "thin") {
    return { style: { ...style, lineWidth: 0.4 }, transform, diagnostics: [] };
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
  if (key === "solid") {
    return { style: { ...style, dashArray: null }, transform, diagnostics: [] };
  }
  if (key === "double") {
    return { style: { ...style, doubleStroke: true }, transform, diagnostics: [] };
  }
  if (key === "dashed") {
    return { style: { ...style, dashArray: [3, 3] }, transform, diagnostics: [] };
  }
  if (key === "densely dashed") {
    return { style: { ...style, dashArray: [4, 2] }, transform, diagnostics: [] };
  }
  if (key === "loosely dashed") {
    return { style: { ...style, dashArray: [6, 4] }, transform, diagnostics: [] };
  }
  if (key === "dotted") {
    return { style: { ...style, dashArray: [1, 3] }, transform, diagnostics: [] };
  }
  if (key === "densely dotted") {
    return { style: { ...style, dashArray: [1, 2] }, transform, diagnostics: [] };
  }
  if (key === "loosely dotted") {
    return { style: { ...style, dashArray: [1, 4] }, transform, diagnostics: [] };
  }
  if (NAMED_COLORS.has(key)) {
    return { style: { ...style, stroke: key, textColor: key }, transform, diagnostics: [] };
  }

  if (NON_STYLE_OPTION_FLAGS.has(key)) {
    return { style, transform, diagnostics: [] };
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
  if (key === "every path/.style" || key === "every path/.append style") {
    const nested = parseStyleValueAsOptionList(valueRaw);
    if (!nested) {
      return { style, transform, diagnostics: [`invalid-style-value:${valueRaw}`] };
    }

    let nextStyle = style;
    let nextTransform = transform;
    const diagnostics: string[] = [];
    for (const entry of nested.entries) {
      const outcome = applyOptionEntry(entry, nextStyle, nextTransform);
      nextStyle = outcome.style;
      nextTransform = outcome.transform;
      diagnostics.push(...outcome.diagnostics);
    }

    return { style: nextStyle, transform: nextTransform, diagnostics };
  }

  if (key === "fill") {
    return { style: { ...style, fill: normalizeColor(valueRaw) }, transform, diagnostics: [] };
  }
  if (key === "draw") {
    if (valueRaw.trim().toLowerCase() === "none") {
      return { style: { ...style, stroke: null, drawExplicit: false }, transform, diagnostics: [] };
    }
    return { style: { ...style, stroke: normalizeColor(valueRaw), drawExplicit: true }, transform, diagnostics: [] };
  }
  if (key === "color") {
    if (valueRaw.trim().toLowerCase() === "none") {
      return { style: { ...style, stroke: null, textColor: null }, transform, diagnostics: [] };
    }
    const normalizedColor = normalizeColor(valueRaw);
    return { style: { ...style, stroke: normalizedColor, textColor: normalizedColor }, transform, diagnostics: [] };
  }
  if (key === "text") {
    return { style: { ...style, textColor: normalizeColor(valueRaw) }, transform, diagnostics: [] };
  }
  if (key === "text opacity") {
    const value = Number(valueRaw);
    if (Number.isFinite(value)) {
      return { style: { ...style, textOpacity: clamp01(value) }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-text-opacity:${valueRaw}`] };
  }
  if (key === "align") {
    const normalized = valueRaw.trim().toLowerCase();
    if (
      normalized === "left" ||
      normalized === "flush left" ||
      normalized === "right" ||
      normalized === "flush right" ||
      normalized === "center" ||
      normalized === "flush center" ||
      normalized === "justify" ||
      normalized === "none"
    ) {
      return { style: { ...style, textAlign: normalized }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-align:${valueRaw}`] };
  }
  if (key === "line width") {
    const length = parseLength(valueRaw, "pt");
    if (length == null) {
      return { style, transform, diagnostics: [`invalid-line-width:${valueRaw}`] };
    }
    return { style: { ...style, lineWidth: length }, transform, diagnostics: [] };
  }
  if (key === "double distance") {
    const length = parseLength(valueRaw, "pt");
    if (length == null || length < 0) {
      return { style, transform, diagnostics: [`invalid-double-distance:${valueRaw}`] };
    }
    return { style: { ...style, doubleDistance: length }, transform, diagnostics: [] };
  }
  if (key === "node font" || key === "font") {
    const parsed = parseFontStyle(valueRaw);
    if (!parsed) {
      return { style, transform, diagnostics: [] };
    }
    return { style: { ...style, ...parsed }, transform, diagnostics: [] };
  }
  if (key === "radius") {
    const radius = parseLength(valueRaw, "cm");
    if (radius == null) {
      return { style, transform, diagnostics: [`invalid-radius:${valueRaw}`] };
    }
    return { style: { ...style, radius }, transform, diagnostics: [] };
  }
  if (key === "x radius") {
    const xRadius = parseLength(valueRaw, "cm");
    if (xRadius == null) {
      return { style, transform, diagnostics: [`invalid-x-radius:${valueRaw}`] };
    }
    return { style: { ...style, xRadius }, transform, diagnostics: [] };
  }
  if (key === "y radius") {
    const yRadius = parseLength(valueRaw, "cm");
    if (yRadius == null) {
      return { style, transform, diagnostics: [`invalid-y-radius:${valueRaw}`] };
    }
    return { style: { ...style, yRadius }, transform, diagnostics: [] };
  }
  if (key === "rounded corners") {
    const roundedCorners = parseLength(valueRaw, "pt");
    if (roundedCorners == null) {
      return { style, transform, diagnostics: [`invalid-rounded-corners:${valueRaw}`] };
    }
    return { style: { ...style, roundedCorners }, transform, diagnostics: [] };
  }
  if (key === "opacity") {
    const value = Number(valueRaw);
    if (Number.isFinite(value)) {
      const opacity = clamp01(value);
      return {
        style: { ...style, opacity, strokeOpacity: opacity, fillOpacity: opacity, textOpacity: opacity },
        transform,
        diagnostics: []
      };
    }
    return { style, transform, diagnostics: [`invalid-opacity:${valueRaw}`] };
  }
  if (key === "draw opacity") {
    const value = Number(valueRaw);
    if (Number.isFinite(value)) {
      return { style: { ...style, strokeOpacity: clamp01(value) }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-draw-opacity:${valueRaw}`] };
  }
  if (key === "fill opacity") {
    const value = Number(valueRaw);
    if (Number.isFinite(value)) {
      return { style: { ...style, fillOpacity: clamp01(value) }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-fill-opacity:${valueRaw}`] };
  }
  if (key === "line cap") {
    const normalized = valueRaw.trim().toLowerCase();
    if (normalized === "round" || normalized === "butt") {
      return { style: { ...style, lineCap: normalized }, transform, diagnostics: [] };
    }
    if (normalized === "rect" || normalized === "projecting") {
      return { style: { ...style, lineCap: "square" }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-line-cap:${valueRaw}`] };
  }
  if (key === "line join") {
    const normalized = valueRaw.trim().toLowerCase();
    if (normalized === "round" || normalized === "bevel" || normalized === "miter") {
      return { style: { ...style, lineJoin: normalized }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-line-join:${valueRaw}`] };
  }
  if (key === "dash pattern") {
    const parsed = parseDashPattern(valueRaw);
    if (!parsed) {
      return { style, transform, diagnostics: [`invalid-dash-pattern:${valueRaw}`] };
    }
    return { style: { ...style, dashArray: parsed }, transform, diagnostics: [] };
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
  if (key === "x") {
    const parsed = parseAxisVector(valueRaw, "x");
    if (!parsed) {
      return { style, transform, diagnostics: [`invalid-x-axis:${valueRaw}`] };
    }
    const matrix = {
      ...transform,
      a: parsed.x / PT_PER_CM,
      b: parsed.y / PT_PER_CM
    };
    return { style, transform: matrix, diagnostics: [] };
  }
  if (key === "y") {
    const parsed = parseAxisVector(valueRaw, "y");
    if (!parsed) {
      return { style, transform, diagnostics: [`invalid-y-axis:${valueRaw}`] };
    }
    const matrix = {
      ...transform,
      c: parsed.x / PT_PER_CM,
      d: parsed.y / PT_PER_CM
    };
    return { style, transform: matrix, diagnostics: [] };
  }

  if (NON_STYLE_OPTION_KEYS.has(key)) {
    return { style, transform, diagnostics: [] };
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

function parseFontStyle(raw: string): Pick<ResolvedStyle, "fontStyle"> | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes("itshape") || normalized.includes("slshape")) {
    return { fontStyle: "italic" };
  }
  if (normalized.includes("upshape") || normalized.includes("normalfont")) {
    return { fontStyle: "normal" };
  }
  return null;
}

function parseAxisVector(raw: string, axis: "x" | "y"): { x: number; y: number } | null {
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

function normalizeColor(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "none") {
    return "none";
  }
  if (NAMED_COLORS.has(normalized)) {
    return COLOR_HEX[normalized] ?? normalized;
  }
  if (normalized.startsWith("#")) {
    return normalized;
  }
  const mixed = parseMixedColor(normalized);
  if (mixed) {
    return mixed;
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

function parseDashPattern(raw: string): number[] | null {
  const tokens = raw.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length < 2) {
    return null;
  }

  const result: number[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const mode = tokens[i]?.toLowerCase();
    const lengthRaw = tokens[i + 1];
    if (!mode || !lengthRaw || (mode !== "on" && mode !== "off")) {
      return null;
    }
    const length = parseLength(lengthRaw, "pt");
    if (length == null || length <= 0) {
      return null;
    }
    result.push(length);
  }

  return result.length > 0 ? result : null;
}

function parseMixedColor(raw: string): string | null {
  const match = raw.match(/^([a-z]+)!([0-9]{1,3})(?:!([a-z]+))?$/i);
  if (!match) {
    return null;
  }

  const first = match[1].toLowerCase();
  const second = (match[3] ?? "white").toLowerCase();
  const pct = Number(match[2]);
  if (!(first in COLOR_HEX) || !(second in COLOR_HEX) || !Number.isFinite(pct)) {
    return null;
  }

  const t = clamp01(pct / 100);
  const c1 = hexToRgb(COLOR_HEX[first]);
  const c2 = hexToRgb(COLOR_HEX[second]);
  return rgbToHex({
    r: Math.round(c1.r * t + c2.r * (1 - t)),
    g: Math.round(c1.g * t + c2.g * (1 - t)),
    b: Math.round(c1.b * t + c2.b * (1 - t))
  });
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace(/^#/, "");
  const value = normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized;
  const parsed = Number.parseInt(value, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255
  };
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  return (
    "#" +
    [rgb.r, rgb.g, rgb.b]
      .map((component) => Math.max(0, Math.min(255, component)))
      .map((component) => component.toString(16).padStart(2, "0"))
      .join("")
  );
}
