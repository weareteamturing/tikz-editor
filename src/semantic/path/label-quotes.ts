import type { EdgeOperationItem, NodeItem, Span, ToOperationItem } from "../../ast/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import {
  readNamedCoordinate,
  readNamedNodeGeometry,
  type NamedNodeGeometry,
  type NodeQuotesMode,
  type SemanticContext
} from "../context.js";
import { parseLength } from "../coords/parse-length.js";
import { applyNameScope } from "../nodes/named-coordinates.js";
import { intersectRayWithPolygon } from "../nodes/shape-geometry.js";
import { findTopLevelCharacter, readBalancedBlock, parseStyleValueAsOptionList } from "../style/option-utils.js";
import type { Point } from "../types.js";

type QuotesMode = NodeQuotesMode;

export type NodeAdornmentSpec = {
  kind: "label" | "pin";
  span: Span;
  text: string;
  angleRaw: string;
  options: OptionListAst | undefined;
  distancePt: number;
  pinEdgeRaw: string | null;
};

export type NodeAdornmentPlan = {
  mainOptions: OptionListAst | undefined;
  adornments: NodeAdornmentSpec[];
};

export type NodeAdornmentDefaults = {
  quoteMode: QuotesMode;
  labelPosition: string;
  pinPosition: string;
  labelDistancePt: number;
  pinDistancePt: number;
  pinEdgeRaw: string | null;
};

export type MaterializedNodeAdornment = {
  node: NodeItem;
  mainPoint: Point | null;
  mainNameRaw: string;
  pinEdgeOptions: OptionListAst | undefined;
};

const CONTROL_OPTION_KEYS = new Set([
  "label",
  "pin",
  "label position",
  "pin position",
  "label distance",
  "pin distance",
  "pin edge",
  "quotes mean label",
  "quotes mean pin"
]);

const CONTROL_OPTION_FLAGS = new Set([
  "quotes mean label",
  "quotes mean pin"
]);

const DIRECTION_SHORTHANDS_TO_POSITION: Record<string, string> = {
  centered: "center",
  above: "90",
  below: "-90",
  left: "180",
  right: "0",
  "above left": "135",
  "above right": "45",
  "below left": "-135",
  "below right": "-45"
};

const DIRECTION_TO_DEGREES: Record<string, number> = {
  right: 0,
  "above right": 45,
  above: 90,
  "above left": 135,
  left: 180,
  "below left": 225,
  below: 270,
  "below right": 315,
  east: 0,
  "north east": 45,
  north: 90,
  "north west": 135,
  west: 180,
  "south west": 225,
  south: 270,
  "south east": 315
};

const DIRECTION_TO_ANCHOR: Record<string, string> = {
  right: "east",
  "above right": "north east",
  above: "north",
  "above left": "north west",
  left: "west",
  "below left": "south west",
  below: "south",
  "below right": "south east",
  east: "east",
  "north east": "north east",
  north: "north",
  "north west": "north west",
  west: "west",
  "south west": "south west",
  south: "south",
  "south east": "south east"
};

type RunningAdornmentDefaults = {
  quoteMode: QuotesMode;
  labelPosition: string;
  pinPosition: string;
  labelDistancePt: number;
  pinDistancePt: number;
  pinEdgeRaw: string | null;
};

type ParsedAdornment = {
  kind: "label" | "pin";
  span: Span;
  text: string;
  angleRaw: string;
  options: OptionListAst | undefined;
  distancePt: number;
  pinEdgeRaw: string | null;
  angleExplicit: boolean;
};

type ParsedQuoteToken = {
  text: string;
  optionsRaw: string;
  hasApostrophe: boolean;
};

export function extractNodeAdornmentPlan(
  options: OptionListAst | undefined,
  baseDefaults?: Partial<NodeAdornmentDefaults>
): NodeAdornmentPlan {
  if (!options) {
    return { mainOptions: undefined, adornments: [] };
  }

  const defaults: RunningAdornmentDefaults = {
    quoteMode: baseDefaults?.quoteMode ?? "label",
    labelPosition: baseDefaults?.labelPosition ?? "above",
    pinPosition: baseDefaults?.pinPosition ?? "above",
    labelDistancePt: baseDefaults?.labelDistancePt ?? (parseLength("0pt", "pt") ?? 0),
    pinDistancePt: baseDefaults?.pinDistancePt ?? (parseLength("3ex", "pt") ?? 12.9),
    pinEdgeRaw: baseDefaults?.pinEdgeRaw ?? null
  };

  const adornments: NodeAdornmentSpec[] = [];
  const mainEntries: OptionEntry[] = [];

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "quotes mean pin") {
        defaults.quoteMode = "pin";
        continue;
      }
      if (entry.key === "quotes mean label") {
        defaults.quoteMode = "label";
        continue;
      }
      if (CONTROL_OPTION_FLAGS.has(entry.key)) {
        continue;
      }
      mainEntries.push(entry);
      continue;
    }

    if (entry.kind === "kv") {
      if (entry.key === "label position") {
        const normalized = normalizeText(entry.valueRaw);
        if (normalized.length > 0) {
          defaults.labelPosition = normalized;
        }
        continue;
      }
      if (entry.key === "pin position") {
        const normalized = normalizeText(entry.valueRaw);
        if (normalized.length > 0) {
          defaults.pinPosition = normalized;
        }
        continue;
      }
      if (entry.key === "label distance") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null && Number.isFinite(parsed)) {
          defaults.labelDistancePt = parsed;
        }
        continue;
      }
      if (entry.key === "pin distance") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null && Number.isFinite(parsed)) {
          defaults.pinDistancePt = parsed;
        }
        continue;
      }
      if (entry.key === "pin edge") {
        defaults.pinEdgeRaw = entry.valueRaw;
        continue;
      }

      if (entry.key === "label" || entry.key === "pin") {
        const parsed = parseAdornmentValue(entry.key, entry.valueRaw, entry.span, defaults);
        if (parsed) {
          adornments.push({
            kind: parsed.kind,
            span: parsed.span,
            text: parsed.text,
            angleRaw: parsed.angleRaw,
            options: parsed.options,
            distancePt: parsed.distancePt,
            pinEdgeRaw: parsed.pinEdgeRaw
          });
        }
        continue;
      }

      if (CONTROL_OPTION_KEYS.has(entry.key)) {
        continue;
      }
      mainEntries.push(entry);
      continue;
    }

    const quote = parseQuoteToken(entry.raw);
    if (!quote) {
      mainEntries.push(entry);
      continue;
    }

    const quoteOptionsRaw = composeQuoteOptions(quote.optionsRaw, quote.hasApostrophe);
    const quoteStyleFlag = defaults.quoteMode === "pin" ? "every pin quotes" : "every label quotes";
    const quoteOptionsWithDefaults = quoteOptionsRaw.length > 0 ? `${quoteStyleFlag},${quoteOptionsRaw}` : quoteStyleFlag;
    const parsedQuote = parseAdornmentValue(
      defaults.quoteMode,
      quoteOptionsWithDefaults.length > 0 ? `{[${quoteOptionsWithDefaults}]${quote.text}}` : quote.text,
      entry.span,
      defaults
    );
    if (!parsedQuote) {
      continue;
    }

    parsedQuote.options = applyDirectionShorthands(parsedQuote.options, parsedQuote.kind);
    const directionalOverride = extractDirectionalAngle(parsedQuote.options);
    if (!parsedQuote.angleExplicit && directionalOverride) {
      parsedQuote.angleRaw = directionalOverride;
    }

    adornments.push({
      kind: parsedQuote.kind,
      span: parsedQuote.span,
      text: parsedQuote.text,
      angleRaw: parsedQuote.angleRaw,
      options: parsedQuote.options,
      distancePt: parsedQuote.distancePt,
      pinEdgeRaw: parsedQuote.pinEdgeRaw
    });
  }

  return {
    mainOptions: optionListFromEntries(mainEntries, options.span, options.raw),
    adornments
  };
}

export function materializeNodeAdornment(params: {
  spec: NodeAdornmentSpec;
  context: SemanticContext;
  mainNodeNameRaw: string;
  ownerId: string;
  adornmentIndex: number;
}): MaterializedNodeAdornment {
  const { spec, context, mainNodeNameRaw, ownerId, adornmentIndex } = params;
  const generatedName = `generated_pin_${sanitizeName(mainNodeNameRaw)}_${adornmentIndex}`;
  const explicitName = extractOptionValue(spec.options, "name");
  const resolvedName = explicitName ?? (spec.kind === "pin" ? generatedName : undefined);
  const mainPoint = resolveNamedPoint(mainNodeNameRaw, context);
  const mainGeometry = resolveNamedGeometry(mainNodeNameRaw, context);

  const parsedAngle = parseAdornmentAngle(spec.angleRaw, mainNodeNameRaw, context, mainPoint);
  const center = mainPoint ?? { x: 0, y: 0 };
  let target = center;
  let anchor = "center";

  if (parsedAngle.kind !== "center") {
    const radians = (parsedAngle.degrees * Math.PI) / 180;
    const direction = { x: Math.cos(radians), y: Math.sin(radians) };
    const borderPoint =
      parsedAngle.borderPoint ??
      resolveNamedBorderPointByAngle(mainNodeNameRaw, parsedAngle.degrees, context) ??
      intersectNodeBorder(mainGeometry, direction) ??
      center;
    target = {
      x: borderPoint.x + direction.x * spec.distancePt,
      y: borderPoint.y + direction.y * spec.distancePt
    };
    anchor = anchorFacingAway(parsedAngle.degrees);
  }

  const filteredBase = sanitizeAdornmentOptions(spec.options);
  const entries: OptionEntry[] = [...(filteredBase?.entries ?? [])];
  const hasAnchor = hasExplicitAnchor(entries);
  if (!hasAnchor) {
    entries.push(kvEntry("anchor", anchor, spec.span));
  }
  if (!hasOptionKey(entries, "at")) {
    entries.push(kvEntry("at", `(${formatPt(target.x)}pt,${formatPt(target.y)}pt)`, spec.span));
  }
  if (resolvedName && !hasOptionKey(entries, "name")) {
    entries.push(kvEntry("name", resolvedName, spec.span));
  }

  const options = optionListFromEntries(entries, spec.span, "");
  const pinEdgeOptions =
    spec.kind === "pin" && spec.pinEdgeRaw != null
      ? (parseStyleValueAsOptionList(spec.pinEdgeRaw) ?? undefined)
      : undefined;

  const node: NodeItem = {
    kind: "Node",
    id: `${ownerId}:adornment:${adornmentIndex}`,
    span: spec.span,
    raw: spec.text,
    templateRaw: spec.text,
    name: resolvedName,
    optionsSpan: options?.span,
    options,
    textSource: "group",
    textSpan: spec.span,
    text: spec.text
  };

  return {
    node,
    mainPoint,
    mainNameRaw: mainNodeNameRaw,
    pinEdgeOptions
  };
}

export function extractToLikeOptionPlan<T extends ToOperationItem | EdgeOperationItem>(item: T): {
  item: T;
  generatedNodes: NodeItem[];
} {
  const options = item.options;
  if (!options) {
    return { item, generatedNodes: [] };
  }

  const generatedNodes: NodeItem[] = [];
  const keptEntries: OptionEntry[] = [];
  let generatedIndex = 0;

  for (const entry of options.entries) {
    if (entry.kind === "kv" && (entry.key === "edge label" || entry.key === "edge label'")) {
      const optionsRaw = entry.key === "edge label'" ? "auto,swap" : "auto";
      const nodeOptions = parseGeneratedOptions(optionsRaw, entry.span);
      generatedNodes.push(
        makeSyntheticOperationNode(item.id, generatedIndex, stripWrappingBraces(entry.valueRaw), nodeOptions, entry.span, entry.raw)
      );
      generatedIndex += 1;
      continue;
    }

    if (entry.kind === "kv" && entry.key === "edge node") {
      const parsedNodes = parseEdgeNodeOptionValue(item.id, generatedIndex, entry.valueRaw, entry.span, entry.raw);
      if (parsedNodes.length > 0) {
        generatedNodes.push(...parsedNodes);
        generatedIndex += parsedNodes.length;
        continue;
      }
    }

    const quote = parseQuoteToken(entry.raw);
    if (quote) {
      const quoteOptions = composeQuoteOptions(quote.optionsRaw, quote.hasApostrophe);
      const optionsRaw = quoteOptions.length > 0 ? `every edge quotes,${quoteOptions}` : "every edge quotes";
      const nodeOptions = parseGeneratedOptions(optionsRaw, entry.span);
      generatedNodes.push(
        makeSyntheticOperationNode(item.id, generatedIndex, stripWrappingBraces(quote.text), nodeOptions, entry.span, entry.raw)
      );
      generatedIndex += 1;
      continue;
    }

    keptEntries.push(entry);
  }

  const cleanedOptions = optionListFromEntries(keptEntries, options.span, options.raw);
  if (cleanedOptions === options && generatedNodes.length === 0) {
    return { item, generatedNodes };
  }

  return {
    item: {
      ...item,
      options: cleanedOptions,
      optionsSpan: cleanedOptions?.span
    },
    generatedNodes
  };
}

function parseAdornmentValue(
  kind: "label" | "pin",
  rawValue: string,
  span: Span,
  defaults: RunningAdornmentDefaults
): ParsedAdornment | null {
  let value = stripWrappingBraces(rawValue).trim();
  if (value.length === 0) {
    return null;
  }

  let optionsRaw = "";
  if (value.startsWith("[")) {
    const block = readBalancedBlock(value, 0, "[", "]");
    if (block) {
      optionsRaw = block.content.trim();
      value = value.slice(block.nextIndex).trim();
    }
  }

  const colonIndex = findTopLevelCharacter(value, ":");
  let angleRaw = kind === "label" ? defaults.labelPosition : defaults.pinPosition;
  let angleExplicit = false;
  let textRaw = value;
  if (colonIndex >= 0) {
    const maybeAngle = value.slice(0, colonIndex).trim();
    const maybeText = value.slice(colonIndex + 1).trim();
    if (maybeAngle.length > 0) {
      angleRaw = maybeAngle;
      angleExplicit = true;
    }
    textRaw = maybeText;
  }

  if (textRaw.length === 0) {
    return null;
  }

  const styleFlag = kind === "label" ? "every label" : "every pin";
  const optionsWithStyle = optionsRaw.length > 0 ? `${styleFlag},${optionsRaw}` : styleFlag;
  const parsedOptions = parseGeneratedOptions(optionsWithStyle, span);
  const cleanedOptions = sanitizeAdornmentOptions(parsedOptions);
  const distancePt = resolveAdornmentDistance(cleanedOptions, kind, defaults);
  const pinEdgeRaw = kind === "pin" ? resolvePinEdgeRaw(cleanedOptions, defaults.pinEdgeRaw) : null;

  return {
    kind,
    span,
    text: stripWrappingBraces(textRaw),
    angleRaw,
    options: cleanedOptions,
    distancePt,
    pinEdgeRaw,
    angleExplicit
  };
}

function parseQuoteToken(raw: string): ParsedQuoteToken | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("\"")) {
    return null;
  }

  let cursor = 1;
  while (cursor < trimmed.length) {
    const char = trimmed[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "\"") {
      break;
    }
    cursor += 1;
  }

  if (cursor >= trimmed.length || trimmed[cursor] !== "\"") {
    return null;
  }

  let text = trimmed.slice(1, cursor);
  let rest = trimmed.slice(cursor + 1).trim();
  let hasApostrophe = false;
  if (rest.startsWith("'")) {
    hasApostrophe = true;
    rest = rest.slice(1).trim();
  }

  let optionsRaw = rest;
  if (rest.startsWith("{")) {
    const block = readBalancedBlock(rest, 0, "{", "}");
    if (!block) {
      return null;
    }
    optionsRaw = block.content.trim();
    rest = rest.slice(block.nextIndex).trim();
    if (rest.length > 0) {
      optionsRaw = optionsRaw.length > 0 ? `${optionsRaw}, ${rest}` : rest;
    }
  }

  return {
    text,
    optionsRaw: optionsRaw.trim(),
    hasApostrophe
  };
}

function composeQuoteOptions(optionsRaw: string, hasApostrophe: boolean): string {
  const trimmed = optionsRaw.trim();
  if (hasApostrophe) {
    return trimmed.length > 0 ? `swap,${trimmed}` : "swap";
  }
  return trimmed;
}

function extractDirectionalAngle(options: OptionListAst | undefined): string | null {
  if (!options) {
    return null;
  }

  let resolved: string | null = null;
  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "centered") {
        resolved = "center";
        continue;
      }
      if (entry.key in DIRECTION_TO_DEGREES) {
        resolved = entry.key;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "label position" || entry.key === "pin position") {
      const normalized = normalizeText(entry.valueRaw);
      if (normalized.length > 0) {
        resolved = normalized;
      }
      continue;
    }
    if (entry.key in DIRECTION_TO_DEGREES) {
      resolved = entry.key;
    }
  }

  return resolved;
}

function applyDirectionShorthands(
  options: OptionListAst | undefined,
  kind: "label" | "pin"
): OptionListAst | undefined {
  if (!options) {
    return undefined;
  }

  const positionKey = kind === "label" ? "label position" : "pin position";
  const rewritten: OptionEntry[] = [];
  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      const rewrittenValue = DIRECTION_SHORTHANDS_TO_POSITION[entry.key];
      if (rewrittenValue != null) {
        rewritten.push(kvEntry(positionKey, rewrittenValue, entry.span));
        continue;
      }
    }
    rewritten.push(entry);
  }

  return optionListFromEntries(rewritten, options.span, options.raw);
}

function resolveAdornmentDistance(
  options: OptionListAst | undefined,
  kind: "label" | "pin",
  defaults: RunningAdornmentDefaults
): number {
  const key = kind === "label" ? "label distance" : "pin distance";
  const fallback = kind === "label" ? defaults.labelDistancePt : defaults.pinDistancePt;
  if (!options) {
    return fallback;
  }

  let resolved = fallback;
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== key) {
      continue;
    }
    const parsed = parseLength(entry.valueRaw, "pt");
    if (parsed != null && Number.isFinite(parsed)) {
      resolved = parsed;
    }
  }

  return resolved;
}

function resolvePinEdgeRaw(options: OptionListAst | undefined, fallback: string | null): string | null {
  if (!options) {
    return fallback;
  }

  let resolved = fallback;
  for (const entry of options.entries) {
    if (entry.kind === "kv" && entry.key === "pin edge") {
      resolved = entry.valueRaw;
    }
  }
  return resolved;
}

function sanitizeAdornmentOptions(options: OptionListAst | undefined): OptionListAst | undefined {
  if (!options) {
    return undefined;
  }

  const filtered: OptionEntry[] = [];
  for (const entry of options.entries) {
    if (entry.kind === "flag" && CONTROL_OPTION_FLAGS.has(entry.key)) {
      continue;
    }
    if (entry.kind === "kv" && CONTROL_OPTION_KEYS.has(entry.key)) {
      continue;
    }
    filtered.push(entry);
  }

  return optionListFromEntries(filtered, options.span, options.raw);
}

function parseGeneratedOptions(raw: string, span: Span): OptionListAst | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = parseOptionListRaw(`[${trimmed}]`, span.from);
  const normalizedEntries = parsed.entries.map((entry) => {
    if (entry.kind === "unknown" && entry.raw.trim() === "'") {
      return {
        kind: "flag" as const,
        key: "swap",
        span: entry.span,
        raw: "swap"
      };
    }
    return entry;
  });

  return optionListFromEntries(normalizedEntries, parsed.span, parsed.raw);
}

function parseEdgeNodeOptionValue(
  ownerId: string,
  startingIndex: number,
  rawValue: string,
  span: Span,
  raw: string
): NodeItem[] {
  const nodes: NodeItem[] = [];
  let remainder = stripWrappingBraces(rawValue).trim();

  while (remainder.length > 0) {
    // Intentionally limited to common `node[...] (...) {..}` / `\node ...` forms.
    // More dynamic TeX forms are left untouched for later dedicated parsing support.
    const parsed = parseSingleEdgeNodeSpec(remainder);
    if (!parsed) {
      break;
    }

    nodes.push(
      makeSyntheticOperationNode(ownerId, startingIndex + nodes.length, parsed.text, parsed.options, span, raw, parsed.name)
    );
    remainder = parsed.rest.trim();
  }

  return nodes;
}

function parseSingleEdgeNodeSpec(source: string): {
  name?: string;
  options: OptionListAst | undefined;
  text: string;
  rest: string;
} | null {
  let cursor = 0;
  const nodeKeyword = source.startsWith("\\node") ? "\\node" : source.startsWith("node") ? "node" : null;
  if (!nodeKeyword) {
    return null;
  }
  cursor += nodeKeyword.length;

  while (cursor < source.length && /\s/u.test(source[cursor] ?? "")) {
    cursor += 1;
  }

  let options: OptionListAst | undefined;
  if ((source[cursor] ?? "") === "[") {
    const block = readBalancedBlock(source, cursor, "[", "]");
    if (!block) {
      return null;
    }
    options = parseGeneratedOptions(block.content, {
      from: 0,
      to: block.nextIndex
    });
    cursor = block.nextIndex;
    while (cursor < source.length && /\s/u.test(source[cursor] ?? "")) {
      cursor += 1;
    }
  }

  let name: string | undefined;
  if ((source[cursor] ?? "") === "(") {
    const block = readBalancedBlock(source, cursor, "(", ")");
    if (!block) {
      return null;
    }
    const normalizedName = stripWrappingBraces(block.content).trim();
    if (normalizedName.length > 0) {
      name = normalizedName;
    }
    cursor = block.nextIndex;
    while (cursor < source.length && /\s/u.test(source[cursor] ?? "")) {
      cursor += 1;
    }
  }

  if ((source[cursor] ?? "") !== "{") {
    return null;
  }
  const block = readBalancedBlock(source, cursor, "{", "}");
  if (!block) {
    return null;
  }

  return {
    name,
    options,
    text: stripWrappingBraces(block.content),
    rest: source.slice(block.nextIndex)
  };
}

function makeSyntheticOperationNode(
  ownerId: string,
  index: number,
  text: string,
  options: OptionListAst | undefined,
  span: Span,
  raw: string,
  name?: string
): NodeItem {
  return {
    kind: "Node",
    id: `${ownerId}:synthetic-node:${index}`,
    span,
    raw,
    templateRaw: raw,
    name,
    optionsSpan: options?.span,
    options,
    textSource: "group",
    textSpan: span,
    text
  };
}

function parseAdornmentAngle(
  rawAngle: string,
  mainNodeNameRaw: string,
  context: SemanticContext,
  mainPoint: Point | null
): { kind: "center" } | { kind: "angle"; degrees: number; borderPoint?: Point } {
  const normalized = normalizeText(rawAngle);
  if (normalized === "center" || normalized === "centered") {
    return { kind: "center" };
  }

  const mapped = DIRECTION_TO_DEGREES[normalized];
  if (mapped != null) {
    const mappedAnchor = DIRECTION_TO_ANCHOR[normalized];
    if (mappedAnchor) {
      const anchorPoint = resolveNamedPoint(`${mainNodeNameRaw}.${mappedAnchor}`, context);
      if (anchorPoint) {
        return { kind: "angle", degrees: mapped, borderPoint: anchorPoint };
      }
    }
    return { kind: "angle", degrees: mapped };
  }

  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    return { kind: "angle", degrees: normalizeDegrees(numeric) };
  }

  if (mainPoint) {
    const anchorPoint = resolveNamedPoint(`${mainNodeNameRaw}.${normalized}`, context);
    if (anchorPoint) {
      const dx = anchorPoint.x - mainPoint.x;
      const dy = anchorPoint.y - mainPoint.y;
      const degrees = normalizeDegrees((Math.atan2(dy, dx) * 180) / Math.PI);
      return { kind: "angle", degrees, borderPoint: anchorPoint };
    }
  }

  return { kind: "angle", degrees: 90 };
}

function resolveNamedPoint(nameRaw: string, context: SemanticContext): Point | null {
  const scoped = applyNameScope(nameRaw, context);
  const candidates = scoped === nameRaw ? [nameRaw] : [scoped, nameRaw];
  for (const candidate of candidates) {
    const point = readNamedCoordinate(context, candidate);
    if (point) {
      return point;
    }
  }
  return null;
}

function resolveNamedGeometry(nameRaw: string, context: SemanticContext): NamedNodeGeometry | null {
  const scoped = applyNameScope(nameRaw, context);
  const candidates = scoped === nameRaw ? [nameRaw] : [scoped, nameRaw];
  for (const candidate of candidates) {
    const geometry = readNamedNodeGeometry(context, candidate);
    if (geometry) {
      return geometry;
    }
  }
  return null;
}

function intersectNodeBorder(geometry: NamedNodeGeometry | null, direction: Point): Point | null {
  if (!geometry) {
    return null;
  }
  const dx = direction.x;
  const dy = direction.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return geometry.center;
  }

  if (geometry.shape === "circle") {
    const radius = geometry.anchorRadius;
    return {
      x: geometry.center.x + (dx / len) * radius,
      y: geometry.center.y + (dy / len) * radius
    };
  }

  if (geometry.shape === "rectangle") {
    const hw = geometry.anchorHalfWidth;
    const hh = geometry.anchorHalfHeight;
    const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
    return {
      x: geometry.center.x + dx * scale,
      y: geometry.center.y + dy * scale
    };
  }

  if (geometry.shape === "ellipse") {
    const rx = geometry.anchorHalfWidth;
    const ry = geometry.anchorHalfHeight;
    const scale = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
    if (!Number.isFinite(scale)) {
      return geometry.center;
    }
    return {
      x: geometry.center.x + dx * scale,
      y: geometry.center.y + dy * scale
    };
  }

  if (geometry.anchorPolygon && geometry.anchorPolygon.length >= 3) {
    const hit = intersectRayWithPolygon({ x: 0, y: 0 }, { x: dx, y: dy }, geometry.anchorPolygon);
    if (hit) {
      return {
        x: geometry.center.x + hit.x,
        y: geometry.center.y + hit.y
      };
    }
  }

  return geometry.center;
}

function resolveNamedBorderPointByAngle(mainNodeNameRaw: string, angleDegrees: number, context: SemanticContext): Point | null {
  const normalized = normalizeDegrees(angleDegrees);
  const octant = Math.round(normalized / 45) % 8;
  const anchorByOctant = ["east", "north east", "north", "north west", "west", "south west", "south", "south east"];
  const anchor = anchorByOctant[octant];
  return resolveNamedPoint(`${mainNodeNameRaw}.${anchor}`, context);
}

function anchorFacingAway(degrees: number): string {
  const normalized = normalizeDegrees(degrees);
  if (normalized < 4 || normalized >= 356) {
    return "west";
  }
  if (normalized < 87) {
    return "south west";
  }
  if (normalized < 94) {
    return "south";
  }
  if (normalized < 177) {
    return "south east";
  }
  if (normalized < 184) {
    return "east";
  }
  if (normalized < 267) {
    return "north east";
  }
  if (normalized < 274) {
    return "north";
  }
  return "north west";
}

function normalizeDegrees(value: number): number {
  let normalized = value % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function hasExplicitAnchor(entries: OptionEntry[]): boolean {
  return entries.some((entry) => entry.kind === "kv" && entry.key === "anchor");
}

function extractOptionValue(options: OptionListAst | undefined, key: string): string | undefined {
  if (!options) {
    return undefined;
  }
  let resolved: string | undefined;
  for (const entry of options.entries) {
    if (entry.kind === "kv" && entry.key === key) {
      resolved = stripWrappingBraces(entry.valueRaw).trim();
    }
  }
  return resolved && resolved.length > 0 ? resolved : undefined;
}

function hasOptionKey(entries: OptionEntry[], key: string): boolean {
  return entries.some((entry) => entry.kind === "kv" && entry.key === key);
}

function kvEntry(key: string, valueRaw: string, span: Span): OptionEntry {
  return {
    kind: "kv",
    key,
    valueRaw,
    span,
    raw: `${key}=${valueRaw}`
  };
}

function optionListFromEntries(entries: OptionEntry[], span: Span, raw: string): OptionListAst | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  return {
    span,
    raw: raw.length > 0 ? raw : `[${entries.map((entry) => entry.raw).join(", ")}]`,
    entries
  };
}

function stripWrappingBraces(valueRaw: string): string {
  let value = valueRaw.trim();
  while (value.startsWith("{") && value.endsWith("}") && isWrappedBySingleBracePair(value)) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function isWrappedBySingleBracePair(raw: string): boolean {
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
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
      if (depth === 0 && index !== raw.length - 1) {
        return false;
      }
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

function normalizeText(raw: string): string {
  return stripWrappingBraces(raw).trim().toLowerCase().replace(/\s+/g, " ");
}

function formatPt(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}

function sanitizeName(raw: string): string {
  const sanitized = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  return sanitized.length > 0 ? sanitized : "node";
}
