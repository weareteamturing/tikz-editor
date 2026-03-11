import type { Span, Statement, PathStatement, PathItem, NodeItem } from "../ast/types.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import type { OptionListAst } from "../options/types.js";
import { parseOptionListRaw } from "../options/parse.js";
import {
  extractNodeAdornmentPlan,
  makeNodeAdornmentTargetId,
  stripAdornmentInternalStyleOptions
} from "../semantic/path/label-quotes.js";
import { parseCustomStyleDefinition } from "../semantic/style/custom-styles.js";
import { readBalancedBlock } from "../semantic/style/option-utils.js";

export type PropertyTargetKind =
  | "figure"
  | "path-statement"
  | "style-source"
  | "path-keyword"
  | "node-item"
  | "node-adornment"
  | "to-operation"
  | "edge-operation"
  | "coordinate-operation"
  | "svg-operation";

export const TIKZPICTURE_GLOBAL_TARGET_ID = "__tikzpicture__";
export const STYLE_SOURCE_TARGET_PREFIX = "__style_source__:";

export type PropertyTargetOptionsFormat = "bracketed" | "bare" | "braced";

export type PropertyTarget = {
  id: string;
  kind: PropertyTargetKind;
  pathCommand?: string;
  span: Span;
  options?: OptionListAst;
  optionsSpan?: Span;
  optionsFormat?: PropertyTargetOptionsFormat;
  insertOffset: number;
  optionSpan?: Span;
  valueSpan?: Span;
  textSpan?: Span;
  angleRaw?: string;
  angleSpan?: Span;
  distancePt?: number;
  defaultDistancePt?: number;
  distanceExplicit?: boolean;
  pinEdgeRaw?: string | null;
  ownerId?: string;
  ownerSourceId?: string;
  adornmentKind?: "label" | "pin";
  adornmentIndex?: number;
};

export type PropertyTargetResolution =
  | { kind: "found"; target: PropertyTarget }
  | { kind: "not-found"; reason: string };

export function resolvePropertyTarget(source: string, elementId: string, parseOptions: EditParseOptions = {}): PropertyTargetResolution {
  const normalizedId = elementId.trim();
  if (normalizedId.length === 0) {
    return { kind: "not-found", reason: "Missing element id" };
  }

  if (normalizedId === TIKZPICTURE_GLOBAL_TARGET_ID) {
    return resolveFigurePropertyTarget(source, parseOptions);
  }

  if (normalizedId.startsWith(STYLE_SOURCE_TARGET_PREFIX)) {
    return resolveStyleSourceTarget(source, normalizedId);
  }

  const parseResult = parseTikzForEdit(source, parseOptions);
  const target = findTargetInStatements(parseResult.figure.body, source, normalizedId);
  if (!target) {
    return { kind: "not-found", reason: `No editable source target found for ${normalizedId}` };
  }

  return { kind: "found", target };
}

function resolveFigurePropertyTarget(source: string, parseOptions: EditParseOptions): PropertyTargetResolution {
  const parseResult = parseTikzForEdit(source, parseOptions);
  const figure = parseResult.figure;
  if (figure.span.from >= figure.span.to) {
    return { kind: "not-found", reason: "No editable tikzpicture target found." };
  }
  const insertOffset = resolveFigureInsertOffset(source, figure.span);
  if (insertOffset == null) {
    return { kind: "not-found", reason: "No editable tikzpicture target found." };
  }

  return {
      kind: "found",
      target: {
        id: TIKZPICTURE_GLOBAL_TARGET_ID,
        kind: "figure",
        span: figure.span,
        options: figure.options,
        optionsSpan: figure.options?.span,
        optionsFormat: "bracketed",
        insertOffset
      }
    };
}

function resolveStyleSourceTarget(source: string, targetId: string): PropertyTargetResolution {
  const parsed = parseStyleSourceTargetId(targetId);
  if (!parsed) {
    return { kind: "not-found", reason: `Invalid style source target id: ${targetId}` };
  }
  const span: Span = { from: parsed.from, to: parsed.to };
  if (span.from < 0 || span.to > source.length || span.from >= span.to) {
    return { kind: "not-found", reason: `Style source span out of bounds: ${targetId}` };
  }

  const raw = source.slice(span.from, span.to);
  const standalone = resolveStandaloneCommandTarget(targetId, raw, span);
  if (standalone) {
    return { kind: "found", target: standalone };
  }

  const styleDefinition = resolveStyleDefinitionEntryTarget(targetId, raw, span);
  if (styleDefinition) {
    return { kind: "found", target: styleDefinition };
  }

  return { kind: "not-found", reason: `No editable style source target found for ${targetId}` };
}

function resolveStandaloneCommandTarget(targetId: string, raw: string, span: Span): PropertyTarget | null {
  const tikzset = parseBracedCommandOptionTarget(raw, span.from, "\\tikzset");
  if (tikzset) {
    return {
      id: targetId,
      kind: "style-source",
      span,
      options: tikzset.options,
      optionsSpan: tikzset.optionsSpan,
      optionsFormat: "bare",
      insertOffset: tikzset.optionsSpan.to
    };
  }

  const pgfkeys = parseBracedCommandOptionTarget(raw, span.from, "\\pgfkeys");
  if (pgfkeys) {
    return {
      id: targetId,
      kind: "style-source",
      span,
      options: pgfkeys.options,
      optionsSpan: pgfkeys.optionsSpan,
      optionsFormat: "bare",
      insertOffset: pgfkeys.optionsSpan.to
    };
  }

  const legacy = parseLegacyTikzStyleTarget(raw, span.from);
  if (legacy) {
    return {
      id: targetId,
      kind: "style-source",
      span,
      options: legacy.options,
      optionsSpan: legacy.optionsSpan,
      optionsFormat: legacy.optionsFormat,
      insertOffset: legacy.optionsSpan.to
    };
  }

  return null;
}

function resolveStyleDefinitionEntryTarget(targetId: string, raw: string, span: Span): PropertyTarget | null {
  const parsedEntry = parseOptionListRaw(`[${raw}]`, span.from);
  const entry = parsedEntry.entries[0];
  if (!entry || entry.kind !== "kv") {
    return null;
  }
  const definition = parseCustomStyleDefinition(entry.key) ?? parseReservedStyleDefinition(entry.key);
  if (!definition) {
    return null;
  }

  const valueOffset = entry.raw.lastIndexOf(entry.valueRaw);
  const absoluteValueFrom = valueOffset >= 0 ? entry.span.from + valueOffset - 1 : entry.span.to - entry.valueRaw.length;
  const trimmedValue = entry.valueRaw.trim();
  if (trimmedValue.length === 0) {
    return {
      id: targetId,
      kind: "style-source",
      span,
      options: parseOptionListRaw("", absoluteValueFrom),
      optionsSpan: { from: absoluteValueFrom, to: absoluteValueFrom },
      optionsFormat: "bare",
      insertOffset: absoluteValueFrom
    };
  }

  const wrapper = detectWrappedOptionValue(trimmedValue, absoluteValueFrom);
  if (!wrapper) {
    return {
      id: targetId,
      kind: "style-source",
      span,
      options: parseOptionListRaw(trimmedValue, absoluteValueFrom),
      optionsSpan: { from: absoluteValueFrom, to: absoluteValueFrom + entry.valueRaw.length },
      optionsFormat: "bare",
      insertOffset: absoluteValueFrom + entry.valueRaw.length
    };
  }

  return {
    id: targetId,
    kind: "style-source",
    span,
    options: wrapper.options,
    optionsSpan: wrapper.span,
    optionsFormat: wrapper.format,
    insertOffset: wrapper.span.to
  };
}

function parseBracedCommandOptionTarget(
  raw: string,
  absoluteFrom: number,
  command: "\\tikzset" | "\\pgfkeys"
): { options: OptionListAst; optionsSpan: Span } | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(command)) {
    return null;
  }

  const commandOffset = raw.indexOf(command);
  const openBraceOffset = raw.indexOf("{", commandOffset + command.length);
  if (openBraceOffset < 0) {
    return null;
  }
  const block = readBalancedBlock(raw, openBraceOffset, "{", "}");
  if (!block) {
    return null;
  }

  const contentFrom = absoluteFrom + openBraceOffset + 1;
  const contentTo = absoluteFrom + block.nextIndex - 1;
  return {
    options: parseOptionListRaw(block.content, contentFrom),
    optionsSpan: { from: contentFrom, to: contentTo }
  };
}

function parseLegacyTikzStyleTarget(
  raw: string,
  absoluteFrom: number
): { options: OptionListAst; optionsSpan: Span; optionsFormat: PropertyTargetOptionsFormat } | null {
  const stripped = raw.trim();
  if (!stripped.startsWith("\\tikzstyle")) {
    return null;
  }

  const eqIndex = raw.indexOf("=");
  if (eqIndex < 0) {
    return null;
  }
  let valueStart = eqIndex + 1;
  while (valueStart < raw.length && /\s/.test(raw[valueStart] ?? "")) {
    valueStart += 1;
  }
  let valueEnd = raw.length;
  while (valueEnd > valueStart && /\s|;/.test(raw[valueEnd - 1] ?? "")) {
    valueEnd -= 1;
  }
  if (valueStart >= valueEnd) {
    return null;
  }
  const valueRaw = raw.slice(valueStart, valueEnd);
  const wrapped = detectWrappedOptionValue(valueRaw, absoluteFrom + valueStart);
  if (wrapped) {
    return {
      options: wrapped.options,
      optionsSpan: wrapped.span,
      optionsFormat: wrapped.format
    };
  }
  return {
    options: parseOptionListRaw(valueRaw, absoluteFrom + valueStart),
    optionsSpan: { from: absoluteFrom + valueStart, to: absoluteFrom + valueEnd },
    optionsFormat: "bare"
  };
}

function detectWrappedOptionValue(
  rawValue: string,
  absoluteFrom: number
): { options: OptionListAst; span: Span; format: PropertyTargetOptionsFormat } | null {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const leading = rawValue.indexOf("{");
    const block = readBalancedBlock(rawValue, leading, "{", "}");
    if (block && block.nextIndex === rawValue.trimEnd().length) {
      const span = { from: absoluteFrom + leading + 1, to: absoluteFrom + block.nextIndex - 1 };
      return {
        options: parseOptionListRaw(block.content, absoluteFrom + leading + 1),
        span,
        format: "bare"
      };
    }
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const leading = rawValue.indexOf("[");
    const block = readBalancedBlock(rawValue, leading, "[", "]");
    if (block && block.nextIndex === rawValue.trimEnd().length) {
      const span = { from: absoluteFrom + leading, to: absoluteFrom + block.nextIndex };
      return {
        options: parseOptionListRaw(rawValue.slice(leading, block.nextIndex), absoluteFrom + leading),
        span,
        format: "bracketed"
      };
    }
  }
  return null;
}

function parseReservedStyleDefinition(key: string): { name: string } | null {
  const normalized = key.trim().toLowerCase();
  if (
    normalized.endsWith("/.style")
    || normalized.endsWith("/.append style")
    || normalized.endsWith("/.prefix style")
  ) {
    return { name: normalized };
  }
  return null;
}

function parseStyleSourceTargetId(targetId: string): { from: number; to: number } | null {
  const payload = targetId.slice(STYLE_SOURCE_TARGET_PREFIX.length);
  const [fromRaw, toRaw] = payload.split(":");
  const from = Number(fromRaw);
  const to = Number(toRaw);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }
  return { from, to };
}

export function makeStyleSourceTargetId(span: Span): string {
  return `${STYLE_SOURCE_TARGET_PREFIX}${span.from}:${span.to}`;
}

function findTargetInStatements(statements: Statement[], source: string, elementId: string): PropertyTarget | null {
  for (const statement of statements) {
    if (statement.kind === "Path") {
      if (statement.id === elementId) {
        return makePathStatementTarget(statement, source);
      }

      const fromItems = findTargetInPathItems(statement.items, source, elementId, statement.id);
      if (fromItems) {
        return fromItems;
      }
      continue;
    }

    if (statement.kind === "Scope") {
      if (statement.id === elementId) {
        return makeScopeTarget(statement, source);
      }
      const nested = findTargetInStatements(statement.body, source, elementId);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function findTargetInPathItems(
  items: PathItem[],
  source: string,
  elementId: string,
  ownerSourceId: string
): PropertyTarget | null {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) {
      continue;
    }

    if (item.kind === "PathKeyword" && item.id === elementId) {
      return makePathKeywordTarget(item, items, index);
    }

    if (item.kind === "Node" && item.id === elementId) {
      return makeNodeTarget(item, source);
    }
    const nodeAdornment =
      item.kind === "Node"
        ? makeNodeAdornmentTarget(item, elementId, source, ownerSourceId)
        : null;
    if (nodeAdornment) {
      return nodeAdornment;
    }

    if (item.kind === "ToOperation") {
      if (item.id === elementId) {
        return makeToLikeOperationTarget("to-operation", item.id, item.span, item.options, item.optionsSpan, /\bto\b/, source);
      }
      const nestedNode = findTargetInNodeList(item.nodes, source, elementId, item.id);
      if (nestedNode) {
        return nestedNode;
      }
      continue;
    }

    if (item.kind === "EdgeOperation") {
      if (item.id === elementId) {
        return makeToLikeOperationTarget("edge-operation", item.id, item.span, item.options, item.optionsSpan, /\bedge\b/, source);
      }
      const nestedNode = findTargetInNodeList(item.nodes, source, elementId, item.id);
      if (nestedNode) {
        return nestedNode;
      }
      continue;
    }

    if (item.kind === "CoordinateOperation" && item.id === elementId) {
      return makeToLikeOperationTarget(
        "coordinate-operation",
        item.id,
        item.span,
        item.options,
        item.optionsSpan,
        /\bcoordinate\b/,
        source
      );
    }

    if (item.kind === "SvgOperation" && item.id === elementId) {
      return makeToLikeOperationTarget("svg-operation", item.id, item.span, item.options, item.optionsSpan, /\bsvg\b/, source);
    }

    if (item.kind === "ChildOperation") {
      const nested = findTargetInPathItems(item.body, source, elementId, ownerSourceId);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function findTargetInNodeList(
  nodes: NodeItem[] | undefined,
  source: string,
  elementId: string,
  ownerSourceId: string
): PropertyTarget | null {
  if (!nodes || nodes.length === 0) {
    return null;
  }

  for (const node of nodes) {
    if (node.id === elementId) {
      return makeNodeTarget(node, source);
    }
    const adornment = makeNodeAdornmentTarget(node, elementId, source, ownerSourceId);
    if (adornment) {
      return adornment;
    }
  }
  return null;
}

function makePathStatementTarget(statement: PathStatement, source: string): PropertyTarget {
  const commandRegex =
    statement.command === "node"
      ? /\\?(?:node|matrix)\b/
      : new RegExp(String.raw`\\?${escapeRegex(statement.command)}\b`);
  const insertOffset = resolveInsertOffset(source, statement.span, commandRegex);

  return {
    id: statement.id,
    kind: "path-statement",
    pathCommand: statement.command,
    span: statement.span,
    options: statement.options,
    optionsSpan: statement.options?.span,
    insertOffset
  };
}

function makeScopeTarget(statement: Extract<Statement, { kind: "Scope" }>, source: string): PropertyTarget {
  return {
    id: statement.id,
    kind: "style-source",
    span: statement.span,
    options: statement.options,
    optionsSpan: statement.options?.span,
    optionsFormat: "bracketed",
    insertOffset: resolveInsertOffset(source, statement.span, /\bscope\b/)
  };
}

function makeNodeTarget(node: NodeItem, source: string): PropertyTarget {
  return {
    id: node.id,
    kind: "node-item",
    span: node.span,
    options: node.options,
    optionsSpan: node.optionsSpan ?? node.options?.span,
    insertOffset: resolveInsertOffset(source, node.span, /\bnode\b/)
  };
}

function makeNodeAdornmentTarget(
  node: NodeItem,
  elementId: string,
  source: string,
  ownerSourceId: string
): PropertyTarget | null {
  const plan = extractNodeAdornmentPlan(node.options);
  if (plan.adornments.length === 0) {
    return null;
  }

  for (let index = 0; index < plan.adornments.length; index += 1) {
    const adornment = plan.adornments[index];
    if (!adornment) {
      continue;
    }
    const expectedId = makeNodeAdornmentTargetId(node.id, index, adornment.kind);
    if (expectedId !== elementId) {
      continue;
    }

    return {
      id: elementId,
      kind: "node-adornment",
      span: adornment.span,
      options: stripAdornmentInternalStyleOptions(adornment.options),
      optionsSpan: adornment.valueSpan,
      optionSpan: adornment.span,
      valueSpan: adornment.valueSpan,
      textSpan: adornment.textSpan,
      angleRaw: adornment.angleRaw,
      angleSpan: adornment.angleSpan,
      distancePt: adornment.distancePt,
      defaultDistancePt: adornment.defaultDistancePt,
      distanceExplicit: adornment.distanceExplicit,
      pinEdgeRaw: adornment.pinEdgeRaw,
      insertOffset: adornment.valueSpan.to,
      ownerId: node.id,
      ownerSourceId,
      adornmentKind: adornment.kind,
      adornmentIndex: index
    };
  }

  return null;
}

function makePathKeywordTarget(item: Extract<PathItem, { kind: "PathKeyword" }>, items: PathItem[], index: number): PropertyTarget {
  const maybeOption = items[index + 1];
  const optionItem = maybeOption?.kind === "PathOption" ? maybeOption : null;
  return {
    id: item.id,
    kind: "path-keyword",
    span: item.span,
    options: optionItem?.options,
    optionsSpan: optionItem?.span ?? optionItem?.options?.span,
    insertOffset: item.span.to
  };
}

function makeToLikeOperationTarget(
  kind: Exclude<PropertyTargetKind, "path-statement" | "path-keyword" | "node-item">,
  id: string,
  span: Span,
  options: OptionListAst | undefined,
  optionsSpan: Span | undefined,
  keywordRegex: RegExp,
  source: string
): PropertyTarget {
  return {
    id,
    kind,
    span,
    options,
    optionsSpan: optionsSpan ?? options?.span,
    insertOffset: resolveInsertOffset(source, span, keywordRegex)
  };
}

function resolveInsertOffset(source: string, span: Span, tokenRegex: RegExp): number {
  const slice = source.slice(span.from, span.to);
  const match = tokenRegex.exec(slice);
  if (!match || match.index == null) {
    return span.from;
  }
  return span.from + match.index + match[0].length;
}

function resolveFigureInsertOffset(source: string, span: Span): number | null {
  const figureEnvOffset = resolveInsertOffset(source, span, /\\begin\{tikzpicture\*?\}/);
  if (figureEnvOffset !== span.from) {
    return figureEnvOffset;
  }

  const inlineOffset = resolveInsertOffset(source, span, /\\tikz\b/);
  if (inlineOffset !== span.from) {
    return inlineOffset;
  }

  return null;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
