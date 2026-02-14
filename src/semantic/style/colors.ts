import { COLOR_HEX, NAMED_COLORS } from "./constants.js";
import { normalizeOptionValue } from "./option-utils.js";

export function normalizeColor(raw: string): string {
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
