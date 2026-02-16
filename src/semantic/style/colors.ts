import { COLOR_HEX, NAMED_COLORS } from "./constants.js";
import { normalizeOptionValue } from "./option-utils.js";

export function normalizeColor(raw: string, opts: { currentColor?: string | null } = {}): string {
  const normalized = raw.trim().toLowerCase();
  const currentColor = resolveCurrentColor(opts.currentColor);
  if (normalized === "none") {
    return "none";
  }
  if (normalized === ".") {
    return currentColor ?? "black";
  }
  if (NAMED_COLORS.has(normalized)) {
    return COLOR_HEX[normalized] ?? normalized;
  }
  if (normalized.startsWith("#")) {
    return normalized;
  }
  const modelColor = parseXcolorModelColor(normalized);
  if (modelColor) {
    return modelColor;
  }
  const mixed = parseMixedColor(normalized, currentColor);
  if (mixed) {
    return mixed;
  }
  return normalized || "black";
}

export function normalizeShadingName(raw: string): string {
  const normalized = normalizeOptionValue(raw).toLowerCase();
  return normalized.replace(/\s+/g, " ").trim();
}

export function mixNormalizedColors(first: string, second: string, ratio: number): string | null {
  const c1 = toRgbColor(first);
  const c2 = toRgbColor(second);
  if (!c1 || !c2) {
    return null;
  }

  const t = clamp01(ratio);
  return rgbToHex({
    r: Math.round(c1.r * t + c2.r * (1 - t)),
    g: Math.round(c1.g * t + c2.g * (1 - t)),
    b: Math.round(c1.b * t + c2.b * (1 - t))
  });
}

function toRgbColor(color: string): { r: number; g: number; b: number } | null {
  const normalized = color.trim().toLowerCase();
  if (normalized in COLOR_HEX) {
    return hexToRgb(COLOR_HEX[normalized]);
  }
  if (/^#[0-9a-f]{3}$/i.test(normalized) || /^#[0-9a-f]{6}$/i.test(normalized)) {
    return hexToRgb(normalized);
  }
  return null;
}

export function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function parseMixedColor(raw: string, currentColor: string | null): string | null {
  const parts = raw.split("!").map((part) => part.trim());
  if (parts.length <= 1 || !parts[0]) {
    return null;
  }

  let current = toRgbColor(resolveRelativeColorReference(parts[0], currentColor, "black"));
  if (!current) {
    return null;
  }

  let cursor = 1;
  while (cursor < parts.length) {
    const percentageRaw = parts[cursor];
    const percentage = Number(percentageRaw);
    if (!percentageRaw || !Number.isFinite(percentage)) {
      return null;
    }
    cursor += 1;

    const mixColorName = parts[cursor] && parts[cursor].length > 0 ? parts[cursor] : "white";
    if (parts[cursor] && parts[cursor].length > 0) {
      cursor += 1;
    }

    const mixColor = toRgbColor(resolveRelativeColorReference(mixColorName, currentColor, "white"));
    if (!mixColor) {
      return null;
    }

    const t = clamp01(percentage / 100);
    current = {
      r: current.r * t + mixColor.r * (1 - t),
      g: current.g * t + mixColor.g * (1 - t),
      b: current.b * t + mixColor.b * (1 - t)
    };
  }

  return rgbToHex(current);
}

function parseXcolorModelColor(raw: string): string | null {
  const unwrapped = unwrapSingleBracePair(raw);
  const rgbBodyMatch = unwrapped.match(/^rgb(?:\s*,\s*255)?\s*:\s*(.+)$/i);
  if (!rgbBodyMatch) {
    return null;
  }

  const components = parseNamedRgbComponents(rgbBodyMatch[1] ?? "");
  if (!components) {
    return null;
  }

  const max = Math.max(components.r, components.g, components.b);
  const scale = max > 1 ? 255 : 1;
  return rgbToHex({
    r: (components.r / scale) * 255,
    g: (components.g / scale) * 255,
    b: (components.b / scale) * 255
  });
}

function parseNamedRgbComponents(raw: string): { r: number; g: number; b: number } | null {
  const values = new Map<string, number>();
  const entries = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    const match = entry.match(/^([a-z]+)\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/i);
    if (!match) {
      return null;
    }
    const channel = match[1].toLowerCase();
    const value = Number(match[2]);
    if (!Number.isFinite(value)) {
      return null;
    }
    values.set(channel, value);
  }

  const r = values.get("red");
  const g = values.get("green");
  const b = values.get("blue");
  if (r == null || g == null || b == null) {
    return null;
  }
  return { r, g, b };
}

function unwrapSingleBracePair(raw: string): string {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    return trimmed;
  }

  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && index !== trimmed.length - 1) {
        return trimmed;
      }
      if (depth < 0) {
        return trimmed;
      }
    }
  }

  return depth === 0 ? trimmed.slice(1, -1).trim() : trimmed;
}

function resolveRelativeColorReference(token: string, currentColor: string | null, fallback: string): string {
  return token === "." ? currentColor ?? fallback : token;
}

function resolveCurrentColor(color: string | null | undefined): string | null {
  if (!color) {
    return null;
  }
  const normalized = color.trim().toLowerCase();
  if (normalized.length === 0 || normalized === "." || normalized === "none") {
    return null;
  }
  if (normalized in COLOR_HEX) {
    return COLOR_HEX[normalized];
  }
  if (/^#[0-9a-f]{3}$/i.test(normalized) || /^#[0-9a-f]{6}$/i.test(normalized)) {
    return normalized;
  }
  return parseMixedColor(normalized, null) ?? normalized;
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
      .map((component) => Math.round(Math.max(0, Math.min(255, component))))
      .map((component) => component.toString(16).padStart(2, "0"))
      .join("")
  );
}
