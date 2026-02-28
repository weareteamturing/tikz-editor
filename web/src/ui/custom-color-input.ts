import type { RgbColor } from "tikz-editor/edit/rgb-to-xcolor";

export type ParsedCustomColor = { rgb: RgbColor; hex: string; warning?: string };

const ALPHA_WARNING = "Alpha channel ignored; using opaque RGB.";

type ParsedInput = {
  rgb: RgbColor;
  warning?: string;
};

export function parseCustomColorInput(raw: string): ParsedCustomColor | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const hexColor = parseHexColor(trimmed);
  if (hexColor) {
    return finalizeParsedInput(hexColor);
  }

  const functionColor = parseFunctionColor(trimmed);
  if (functionColor) {
    return finalizeParsedInput(functionColor);
  }

  const bareColor = parseBareRgbTriplet(trimmed);
  if (bareColor) {
    return finalizeParsedInput(bareColor);
  }

  return null;
}

function finalizeParsedInput(parsed: ParsedInput): ParsedCustomColor {
  return {
    rgb: parsed.rgb,
    hex: rgbToHex(parsed.rgb),
    ...(parsed.warning ? { warning: parsed.warning } : {})
  };
}

function parseHexColor(raw: string): ParsedInput | null {
  const normalized = raw.replace(/^#/, "");
  if (!/^[0-9a-f]+$/i.test(normalized)) {
    return null;
  }

  if (normalized.length === 3 || normalized.length === 4) {
    const expanded = normalized
      .slice(0, 3)
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
    return {
      rgb: {
        r: Number.parseInt(expanded.slice(0, 2), 16),
        g: Number.parseInt(expanded.slice(2, 4), 16),
        b: Number.parseInt(expanded.slice(4, 6), 16)
      },
      ...(normalized.length === 4 ? { warning: ALPHA_WARNING } : {})
    };
  }

  if (normalized.length === 6 || normalized.length === 8) {
    return {
      rgb: {
        r: Number.parseInt(normalized.slice(0, 2), 16),
        g: Number.parseInt(normalized.slice(2, 4), 16),
        b: Number.parseInt(normalized.slice(4, 6), 16)
      },
      ...(normalized.length === 8 ? { warning: ALPHA_WARNING } : {})
    };
  }

  return null;
}

function parseFunctionColor(raw: string): ParsedInput | null {
  const match = raw.match(/^([a-z]+)\((.*)\)$/iu);
  if (!match) {
    return null;
  }

  const fnName = match[1]!.toLowerCase();
  const body = match[2]!;
  if (fnName === "rgb" || fnName === "rgba") {
    return parseRgbLike(body, fnName === "rgba");
  }
  if (fnName === "hsl" || fnName === "hsla") {
    return parseHslLike(body, fnName === "hsla");
  }
  if (fnName === "hsv" || fnName === "hsva" || fnName === "hsb" || fnName === "hsba") {
    return parseHsvLike(body, fnName.endsWith("a"));
  }
  return null;
}

function parseBareRgbTriplet(raw: string): ParsedInput | null {
  const { values, commaSyntax } = splitValues(raw);
  if (values.length !== 3 && values.length !== 4) {
    return null;
  }
  if (commaSyntax && raw.includes("/") && values.length < 4) {
    return null;
  }

  const r = parseRgbChannel(values[0]!);
  const g = parseRgbChannel(values[1]!);
  const b = parseRgbChannel(values[2]!);
  if (r == null || g == null || b == null) {
    return null;
  }

  let warning: string | undefined;
  if (values.length === 4) {
    const alpha = parseAlpha(values[3]!);
    if (alpha == null) {
      return null;
    }
    warning = ALPHA_WARNING;
  }

  return {
    rgb: { r, g, b },
    ...(warning ? { warning } : {})
  };
}

function parseRgbLike(body: string, alphaRequired: boolean): ParsedInput | null {
  const parsed = parseFunctionArguments(body, alphaRequired);
  if (!parsed || parsed.channels.length !== 3) {
    return null;
  }

  const r = parseRgbChannel(parsed.channels[0]!);
  const g = parseRgbChannel(parsed.channels[1]!);
  const b = parseRgbChannel(parsed.channels[2]!);
  if (r == null || g == null || b == null) {
    return null;
  }

  if (parsed.alpha != null && parseAlpha(parsed.alpha) == null) {
    return null;
  }

  return {
    rgb: { r, g, b },
    ...(parsed.alpha != null ? { warning: ALPHA_WARNING } : {})
  };
}

function parseHslLike(body: string, alphaRequired: boolean): ParsedInput | null {
  const parsed = parseFunctionArguments(body, alphaRequired);
  if (!parsed || parsed.channels.length !== 3) {
    return null;
  }

  const hue = parseHueDegrees(parsed.channels[0]!);
  const saturation = parseRatio(parsed.channels[1]!);
  const lightness = parseRatio(parsed.channels[2]!);
  if (hue == null || saturation == null || lightness == null) {
    return null;
  }

  if (parsed.alpha != null && parseAlpha(parsed.alpha) == null) {
    return null;
  }

  return {
    rgb: hslToRgb(hue, saturation, lightness),
    ...(parsed.alpha != null ? { warning: ALPHA_WARNING } : {})
  };
}

function parseHsvLike(body: string, alphaRequired: boolean): ParsedInput | null {
  const parsed = parseFunctionArguments(body, alphaRequired);
  if (!parsed || parsed.channels.length !== 3) {
    return null;
  }

  const hue = parseHueDegrees(parsed.channels[0]!);
  const saturation = parseRatio(parsed.channels[1]!);
  const value = parseRatio(parsed.channels[2]!);
  if (hue == null || saturation == null || value == null) {
    return null;
  }

  if (parsed.alpha != null && parseAlpha(parsed.alpha) == null) {
    return null;
  }

  return {
    rgb: hsvToRgb(hue, saturation, value),
    ...(parsed.alpha != null ? { warning: ALPHA_WARNING } : {})
  };
}

function parseFunctionArguments(
  body: string,
  alphaRequired: boolean
): { channels: [string, string, string]; alpha: string | null } | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let colorPart = trimmed;
  let alphaPart: string | null = null;
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex >= 0) {
    colorPart = trimmed.slice(0, slashIndex).trim();
    alphaPart = trimmed.slice(slashIndex + 1).trim();
    if (alphaPart.length === 0) {
      return null;
    }
  }

  const { values, commaSyntax } = splitValues(colorPart);
  let channels = values;
  if (channels.length === 4 && alphaPart == null) {
    alphaPart = channels[3]!;
    channels = channels.slice(0, 3);
  }

  if (channels.length !== 3) {
    return null;
  }
  if (alphaRequired && alphaPart == null) {
    return null;
  }
  if (commaSyntax && alphaPart != null && alphaPart.includes(",")) {
    return null;
  }

  return {
    channels: [channels[0]!, channels[1]!, channels[2]!],
    alpha: alphaPart
  };
}

function splitValues(raw: string): { values: string[]; commaSyntax: boolean } {
  const commaSyntax = raw.includes(",");
  if (commaSyntax) {
    return {
      commaSyntax: true,
      values: raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    };
  }
  return {
    commaSyntax: false,
    values: raw
      .trim()
      .split(/\s+/u)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
  };
}

function parseRgbChannel(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (value.endsWith("%")) {
    const percentage = Number(value.slice(0, -1));
    if (!Number.isFinite(percentage)) {
      return null;
    }
    return clampByte((percentage / 100) * 255);
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return clampByte(numeric);
}

function parseRatio(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (value.endsWith("%")) {
    const percentage = Number(value.slice(0, -1));
    if (!Number.isFinite(percentage)) {
      return null;
    }
    return clamp01(percentage / 100);
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric > 1) {
    return clamp01(numeric / 100);
  }
  return clamp01(numeric);
}

function parseHueDegrees(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (value.endsWith("deg")) {
    const numeric = Number(value.slice(0, -3));
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (value.endsWith("turn")) {
    const numeric = Number(value.slice(0, -4));
    return Number.isFinite(numeric) ? numeric * 360 : null;
  }
  if (value.endsWith("rad")) {
    const numeric = Number(value.slice(0, -3));
    return Number.isFinite(numeric) ? (numeric * 180) / Math.PI : null;
  }
  if (value.endsWith("grad")) {
    const numeric = Number(value.slice(0, -4));
    return Number.isFinite(numeric) ? numeric * 0.9 : null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseAlpha(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (value.endsWith("%")) {
    const percentage = Number(value.slice(0, -1));
    if (!Number.isFinite(percentage)) {
      return null;
    }
    return clamp01(percentage / 100);
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric > 1) {
    return clamp01(numeric / 100);
  }
  return clamp01(numeric);
}

function hslToRgb(hueDegrees: number, saturation: number, lightness: number): RgbColor {
  const h = normalizeHue(hueDegrees) / 360;
  const s = clamp01(saturation);
  const l = clamp01(lightness);

  if (s <= 0) {
    const gray = clampByte(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hueToRgb(p, q, h + 1 / 3);
  const g = hueToRgb(p, q, h);
  const b = hueToRgb(p, q, h - 1 / 3);
  return {
    r: clampByte(r * 255),
    g: clampByte(g * 255),
    b: clampByte(b * 255)
  };
}

function hueToRgb(p: number, q: number, tRaw: number): number {
  let t = tRaw;
  if (t < 0) {
    t += 1;
  }
  if (t > 1) {
    t -= 1;
  }
  if (t < 1 / 6) {
    return p + (q - p) * 6 * t;
  }
  if (t < 1 / 2) {
    return q;
  }
  if (t < 2 / 3) {
    return p + (q - p) * (2 / 3 - t) * 6;
  }
  return p;
}

function hsvToRgb(hueDegrees: number, saturation: number, value: number): RgbColor {
  const h = normalizeHue(hueDegrees);
  const s = clamp01(saturation);
  const v = clamp01(value);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;
  if (h < 60) {
    rPrime = c;
    gPrime = x;
  } else if (h < 120) {
    rPrime = x;
    gPrime = c;
  } else if (h < 180) {
    gPrime = c;
    bPrime = x;
  } else if (h < 240) {
    gPrime = x;
    bPrime = c;
  } else if (h < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  return {
    r: clampByte((rPrime + m) * 255),
    g: clampByte((gPrime + m) * 255),
    b: clampByte((bPrime + m) * 255)
  };
}

function normalizeHue(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function clampByte(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 255) {
    return 255;
  }
  return Math.round(value);
}

function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function rgbToHex(rgb: RgbColor): string {
  return (
    "#" +
    [rgb.r, rgb.g, rgb.b]
      .map((channel) => clampByte(channel))
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")
  );
}
