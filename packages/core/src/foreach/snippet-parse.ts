import type { PathItem, Statement } from "../ast/types.js";
import { parseTikz } from "../parser/index.js";
import { isWrappedBySingleBracePair } from "../utils/braces.js";

export type ForeachSnippetParseResult<T> = {
  value: T;
  hasParseError: boolean;
};

export function parseStatementsFromBody(bodyRaw: string): ForeachSnippetParseResult<Statement[]> {
  const content = stripWrappingBraces(bodyRaw.trim());
  const source = `\\begin{tikzpicture}\n${content}\n\\end{tikzpicture}`;
  const parsed = parseTikz(source, { recover: true });
  const hasParseError = parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  return {
    value: parsed.figure.body,
    hasParseError
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
