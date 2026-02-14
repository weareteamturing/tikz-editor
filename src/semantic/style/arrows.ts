import { parseOptionListRaw } from "../../options/parse.js";
import { parseLength } from "../coords/parse-length.js";
import type { ArrowMarker, ArrowTip, ArrowTipKind, ResolvedStyle, TipsMode } from "../types.js";
import { ARROW_NAME_ALIASES, DEFAULT_ARROW_LENGTH, DEFAULT_ARROW_WIDTH, NAMED_COLORS } from "./constants.js";
import { normalizeColor } from "./colors.js";
import { findTopLevelCharacter, readBalancedBlock, readOptionalBracketOptions, stripEnclosingBraces } from "./option-utils.js";

export function parseTipsMode(raw: string): TipsMode | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized.length === 0) {
    return "true";
  }
  if (normalized === "proper") {
    return "proper";
  }
  if (normalized === "on draw") {
    return "on draw";
  }
  if (normalized === "on proper draw") {
    return "on proper draw";
  }
  if (normalized === "false" || normalized === "never") {
    return "never";
  }
  return null;
}

export function parseArrowSpecification(raw: string, style: ResolvedStyle): { start: ArrowMarker | null; end: ArrowMarker | null } | null {
  const trimmed = stripEnclosingBraces(raw.trim());
  if (!trimmed.includes("-")) {
    return null;
  }

  const splitIndex = findTopLevelCharacter(trimmed, "-");
  if (splitIndex < 0) {
    return null;
  }

  const startRaw = trimmed.slice(0, splitIndex).trim();
  const endRaw = trimmed.slice(splitIndex + 1).trim();
  const start = parseArrowSideSpecification(startRaw, "start", style);
  const end = parseArrowSideSpecification(endRaw, "end", style);

  return {
    start,
    end
  };
}

export function parseArrowSideSpecification(raw: string, side: "start" | "end", style: ResolvedStyle): ArrowMarker | null {
  const input = stripEnclosingBraces(raw.trim());
  if (input.length === 0) {
    return null;
  }

  const tips: ArrowTip[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    while (cursor < input.length && (/\s/.test(input[cursor] ?? "") || input[cursor] === ".")) {
      cursor += 1;
    }
    if (cursor >= input.length) {
      break;
    }

    const char = input[cursor];
    if (char === "{") {
      const group = readBalancedBlock(input, cursor, "{", "}");
      if (!group) {
        break;
      }
      const nested = parseArrowSideSpecification(group.content, side, style);
      if (nested) {
        tips.push(...nested.tips.map(cloneArrowTip));
      }
      cursor = group.nextIndex;
      continue;
    }

    if (char === ">" || char === "<" || char === "|") {
      cursor += 1;
      const optionBlock = readOptionalBracketOptions(input, cursor);
      cursor = optionBlock.nextIndex;
      const baseTips = expandArrowSymbol(char, side, style);
      for (const tip of baseTips) {
        tips.push(applyArrowTipOptions(tip, optionBlock.optionsRaw));
      }
      continue;
    }

    const named = readArrowNamedTip(input, cursor);
    if (!named) {
      cursor += 1;
      continue;
    }
    cursor = named.nextIndex;
    const optionBlock = readOptionalBracketOptions(input, cursor);
    cursor = optionBlock.nextIndex;
    const tip = applyArrowTipOptions(makeDefaultArrowTip(resolveArrowTipKind(named.name)), optionBlock.optionsRaw);
    tips.push(tip);
  }

  return tips.length > 0 ? { tips } : null;
}

function expandArrowSymbol(symbol: ">" | "<" | "|", side: "start" | "end", style: ResolvedStyle): ArrowTip[] {
  if (symbol === "|") {
    return [makeDefaultArrowTip("bar")];
  }

  if (symbol === "<") {
    if (style.arrowShorthandStart.tips.length > 0) {
      return style.arrowShorthandStart.tips.map(cloneArrowTip);
    }
    return [makeDefaultArrowTip(side === "start" ? "to" : "cm-rightarrow")];
  }

  if (style.arrowShorthandEnd.tips.length > 0) {
    return style.arrowShorthandEnd.tips.map(cloneArrowTip);
  }
  return [makeDefaultArrowTip("to")];
}

function resolveArrowTipKind(rawName: string): ArrowTipKind {
  const normalized = rawName.trim().toLowerCase();
  for (const alias of ARROW_NAME_ALIASES) {
    if (normalized === alias.name) {
      return alias.kind;
    }
  }
  if (normalized.includes("stealth")) {
    return "stealth";
  }
  if (normalized.includes("latex")) {
    return "latex";
  }
  if (normalized.includes("triangle")) {
    return "triangle";
  }
  if (normalized.includes("hook")) {
    return "hooks";
  }
  if (normalized.includes("bar") || normalized.includes("bracket")) {
    return "bar";
  }
  if (normalized.includes("implies")) {
    return "implies";
  }
  if (normalized.includes("rightarrow") || normalized === ">" || normalized === "<" || normalized.includes("to")) {
    return "to";
  }
  return "to";
}

export function makeDefaultArrowMarker(kind: ArrowTipKind): ArrowMarker {
  return { tips: [makeDefaultArrowTip(kind)] };
}

function makeDefaultArrowTip(kind: ArrowTipKind): ArrowTip {
  if (kind === "bar") {
    return {
      kind,
      open: true,
      round: false,
      color: null,
      fill: "none",
      length: 4,
      width: 8,
      lineWidth: null
    };
  }
  if (kind === "hooks") {
    return {
      kind,
      open: true,
      round: true,
      color: null,
      fill: "none",
      length: 7,
      width: 8,
      lineWidth: null
    };
  }
  if (kind === "triangle") {
    return {
      kind,
      open: false,
      round: false,
      color: null,
      fill: null,
      length: 8,
      width: 8,
      lineWidth: null
    };
  }
  if (kind === "implies") {
    return {
      kind,
      open: false,
      round: false,
      color: null,
      fill: null,
      length: 9,
      width: 7,
      lineWidth: null
    };
  }
  return {
    kind,
    open: false,
    round: false,
    color: null,
    fill: null,
    length: DEFAULT_ARROW_LENGTH,
    width: DEFAULT_ARROW_WIDTH,
    lineWidth: null
  };
}

export function cloneArrowMarker(marker: ArrowMarker): ArrowMarker {
  return { tips: marker.tips.map(cloneArrowTip) };
}

function cloneArrowTip(tip: ArrowTip): ArrowTip {
  return { ...tip };
}

function applyArrowTipOptions(base: ArrowTip, optionsRaw: string | null): ArrowTip {
  if (!optionsRaw || optionsRaw.trim().length === 0) {
    return base;
  }

  const options = parseOptionListRaw(`[${optionsRaw}]`);
  let tip: ArrowTip = { ...base };

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      const key = entry.key;
      if (key === "open") {
        tip = { ...tip, open: true, fill: "none" };
        continue;
      }
      if (key === "round") {
        tip = { ...tip, round: true };
        continue;
      }
      if (key === "sharp") {
        tip = { ...tip, round: false };
        continue;
      }
      if (NAMED_COLORS.has(key)) {
        tip = { ...tip, color: normalizeColor(key) };
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    const key = entry.key;
    if (key === "length") {
      const length = parseArrowDimension(entry.valueRaw);
      if (length != null && length >= 0) {
        tip = { ...tip, length };
      }
      continue;
    }
    if (key === "width") {
      const width = parseArrowDimension(entry.valueRaw);
      if (width != null && width >= 0) {
        tip = { ...tip, width };
      }
      continue;
    }
    if (key === "scale") {
      const factor = parseArrowFactor(entry.valueRaw);
      if (factor != null && factor >= 0) {
        tip = { ...tip, length: tip.length * factor, width: tip.width * factor };
      }
      continue;
    }
    if (key === "scale length") {
      const factor = parseArrowFactor(entry.valueRaw);
      if (factor != null && factor >= 0) {
        tip = { ...tip, length: tip.length * factor };
      }
      continue;
    }
    if (key === "scale width") {
      const factor = parseArrowFactor(entry.valueRaw);
      if (factor != null && factor >= 0) {
        tip = { ...tip, width: tip.width * factor };
      }
      continue;
    }
    if (key === "line width") {
      const width = parseArrowDimension(entry.valueRaw);
      if (width != null && width >= 0) {
        tip = { ...tip, lineWidth: width };
      }
      continue;
    }
    if (key === "color") {
      tip = { ...tip, color: normalizeColor(entry.valueRaw) };
      continue;
    }
    if (key === "fill") {
      const fill = normalizeColor(entry.valueRaw);
      tip = { ...tip, fill, open: fill === "none" ? true : tip.open };
      continue;
    }
  }

  return tip;
}

function parseArrowDimension(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const primaryToken = trimmed.split(/\s+/)[0];
  const parsedLength = parseLength(primaryToken ?? trimmed, "pt");
  if (parsedLength != null) {
    return parsedLength;
  }
  const numeric = Number(primaryToken ?? trimmed);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return null;
}

function parseArrowFactor(raw: string): number | null {
  const primaryToken = raw.trim().split(/\s+/)[0];
  if (!primaryToken) {
    return null;
  }
  const parsed = Number(primaryToken);
  return Number.isFinite(parsed) ? parsed : null;
}

function readArrowNamedTip(input: string, startIndex: number): { name: string; nextIndex: number } | null {
  const remainder = input.slice(startIndex);
  const remainderLower = remainder.toLowerCase();

  for (const alias of ARROW_NAME_ALIASES) {
    if (!remainderLower.startsWith(alias.name)) {
      continue;
    }

    const boundary = remainder[alias.name.length];
    if (boundary && !/\s|[.[\]{}<>|]/.test(boundary)) {
      continue;
    }
    return {
      name: alias.name,
      nextIndex: startIndex + alias.name.length
    };
  }

  let cursor = startIndex;
  while (cursor < input.length && !/\s|[.[\]{}<>|\-]/.test(input[cursor] ?? "")) {
    cursor += 1;
  }
  if (cursor === startIndex) {
    return null;
  }
  return {
    name: input.slice(startIndex, cursor),
    nextIndex: cursor
  };
}
