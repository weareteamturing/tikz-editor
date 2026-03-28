import type { PathItem, Span, Statement } from "../ast/types.js";
import { parseTikz, type ParseTikzResult } from "../parser/index.js";
import { isWrappedBySingleBracePair } from "../utils/braces.js";

export type ForeachSnippetParseResult<T> = {
  value: T;
  hasParseError: boolean;
};

export type ForeachSnippetSourceMapper = {
  mapSpan: (span: Span) => Span | null;
  mapOffset: (offset: number) => number | null;
};

export type ForeachStatementBodyParseResult = {
  parseResult: ParseTikzResult;
  hasParseError: boolean;
  sourceMapper: ForeachSnippetSourceMapper;
};

export function parseStatementsFromBody(bodyRaw: string): ForeachSnippetParseResult<Statement[]> {
  const parsed = parseStatementsFromBodyWithMapping(bodyRaw, { from: 0, to: bodyRaw.length });
  return {
    value: parsed.parseResult.figure.body,
    hasParseError: parsed.hasParseError
  };
}

export function parseStatementsFromBodyWithMapping(
  bodyRaw: string,
  bodySpan: Span
): ForeachStatementBodyParseResult {
  const prepared = prepareForeachBodySnippet(bodyRaw, bodySpan);
  const parseResult = parseTikz(prepared.syntheticSource, { recover: true });
  const hasParseError = parseResult.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  return {
    parseResult,
    hasParseError,
    sourceMapper: {
      mapSpan: (span) => mapSyntheticSpanToOriginal(span, prepared),
      mapOffset: (offset) => mapSyntheticOffsetToOriginal(offset, prepared)
    }
  };
}

export function parsePathItemsFromFragment(pathFragmentRaw: string): ForeachSnippetParseResult<PathItem[]> {
  const content = stripWrappingBraces(pathFragmentRaw.trim());
  const source = `\\begin{tikzpicture}\n\\path ${content};\n\\end{tikzpicture}`;
  const parsed = parseTikz(source, { recover: true });
  const statement = parsed.figure.body.find((entry) => entry.kind === "Path");
  const hasParseError = parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (!statement || statement.kind !== "Path") {
    return {
      value: [],
      hasParseError: true
    };
  }

  return {
    value: statement.items,
    hasParseError
  };
}

export function parseNodeItemsFromTemplate(nodeTemplateRaw: string): ForeachSnippetParseResult<PathItem[]> {
  const source = `\\begin{tikzpicture}\n\\path ${nodeTemplateRaw};\n\\end{tikzpicture}`;
  const parsed = parseTikz(source, { recover: true });
  const statement = parsed.figure.body.find((entry) => entry.kind === "Path");
  const hasParseError = parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (!statement || statement.kind !== "Path") {
    return {
      value: [],
      hasParseError: true
    };
  }

  return {
    value: statement.items,
    hasParseError
  };
}

function stripWrappingBraces(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}") || !isWrappedBySingleBracePair(trimmed)) {
    return raw;
  }
  return trimmed.slice(1, -1).trim();
}

type PreparedForeachBodySnippet = {
  syntheticSource: string;
  syntheticContentFrom: number;
  syntheticContentTo: number;
  originalContentFrom: number;
  originalContentTo: number;
};

function prepareForeachBodySnippet(bodyRaw: string, bodySpan: Span): PreparedForeachBodySnippet {
  const leftTrimmed = bodyRaw.trimStart();
  const leftTrim = bodyRaw.length - leftTrimmed.length;
  const rightTrimmed = leftTrimmed.trimEnd();
  const rightTrim = leftTrimmed.length - rightTrimmed.length;

  let working = rightTrimmed;
  let openingTrim = 0;
  let closingTrim = 0;
  if (working.startsWith("{") && working.endsWith("}") && isWrappedBySingleBracePair(working)) {
    working = working.slice(1, -1);
    openingTrim = 1;
    closingTrim = 1;
  }

  const contentLeftTrimmed = working.trimStart();
  const contentLeftTrim = working.length - contentLeftTrimmed.length;
  const content = contentLeftTrimmed.trimEnd();
  const contentRightTrim = contentLeftTrimmed.length - content.length;

  const syntheticPrefix = "\\begin{tikzpicture}\n";
  const syntheticSuffix = "\n\\end{tikzpicture}";
  return {
    syntheticSource: `${syntheticPrefix}${content}${syntheticSuffix}`,
    syntheticContentFrom: syntheticPrefix.length,
    syntheticContentTo: syntheticPrefix.length + content.length,
    originalContentFrom: bodySpan.from + leftTrim + openingTrim + contentLeftTrim,
    originalContentTo: bodySpan.to - rightTrim - closingTrim - contentRightTrim
  };
}

function mapSyntheticOffsetToOriginal(
  offset: number,
  prepared: PreparedForeachBodySnippet
): number | null {
  if (offset < prepared.syntheticContentFrom || offset > prepared.syntheticContentTo) {
    return null;
  }
  return prepared.originalContentFrom + (offset - prepared.syntheticContentFrom);
}

function mapSyntheticSpanToOriginal(
  span: Span,
  prepared: PreparedForeachBodySnippet
): Span | null {
  const from = mapSyntheticOffsetToOriginal(span.from, prepared);
  const to = mapSyntheticOffsetToOriginal(span.to, prepared);
  if (from == null || to == null || from > to) {
    return null;
  }
  return { from, to };
}
