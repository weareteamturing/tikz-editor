import type { Span, Statement, PathStatement, PathItem, NodeItem } from "../ast/types.js";
import { parseTikz } from "../parser/index.js";
import type { OptionListAst } from "../options/types.js";

export type PropertyTargetKind =
  | "figure"
  | "path-statement"
  | "path-keyword"
  | "node-item"
  | "to-operation"
  | "edge-operation"
  | "coordinate-operation"
  | "svg-operation";

export const TIKZPICTURE_GLOBAL_TARGET_ID = "__tikzpicture__";

export type PropertyTarget = {
  id: string;
  kind: PropertyTargetKind;
  pathCommand?: string;
  span: Span;
  options?: OptionListAst;
  optionsSpan?: Span;
  insertOffset: number;
};

export type PropertyTargetResolution =
  | { kind: "found"; target: PropertyTarget }
  | { kind: "not-found"; reason: string };

export function resolvePropertyTarget(source: string, elementId: string): PropertyTargetResolution {
  const normalizedId = elementId.trim();
  if (normalizedId.length === 0) {
    return { kind: "not-found", reason: "Missing element id" };
  }

  if (normalizedId === TIKZPICTURE_GLOBAL_TARGET_ID) {
    return resolveFigurePropertyTarget(source);
  }

  const parseResult = parseTikz(source, { recover: true });
  const target = findTargetInStatements(parseResult.figure.body, source, normalizedId);
  if (!target) {
    return { kind: "not-found", reason: `No editable source target found for ${normalizedId}` };
  }

  return { kind: "found", target };
}

function resolveFigurePropertyTarget(source: string): PropertyTargetResolution {
  const parseResult = parseTikz(source, { recover: true });
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
      insertOffset
    }
  };
}

function findTargetInStatements(statements: Statement[], source: string, elementId: string): PropertyTarget | null {
  for (const statement of statements) {
    if (statement.kind === "Path") {
      if (statement.id === elementId) {
        return makePathStatementTarget(statement, source);
      }

      const fromItems = findTargetInPathItems(statement.items, source, elementId);
      if (fromItems) {
        return fromItems;
      }
      continue;
    }

    if (statement.kind === "Scope") {
      const nested = findTargetInStatements(statement.body, source, elementId);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function findTargetInPathItems(items: PathItem[], source: string, elementId: string): PropertyTarget | null {
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

    if (item.kind === "ToOperation") {
      if (item.id === elementId) {
        return makeToLikeOperationTarget("to-operation", item.id, item.span, item.options, item.optionsSpan, /\bto\b/, source);
      }
      const nestedNode = findTargetInNodeList(item.nodes, source, elementId);
      if (nestedNode) {
        return nestedNode;
      }
      continue;
    }

    if (item.kind === "EdgeOperation") {
      if (item.id === elementId) {
        return makeToLikeOperationTarget("edge-operation", item.id, item.span, item.options, item.optionsSpan, /\bedge\b/, source);
      }
      const nestedNode = findTargetInNodeList(item.nodes, source, elementId);
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
      const nested = findTargetInPathItems(item.body, source, elementId);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function findTargetInNodeList(nodes: NodeItem[] | undefined, source: string, elementId: string): PropertyTarget | null {
  if (!nodes || nodes.length === 0) {
    return null;
  }

  for (const node of nodes) {
    if (node.id === elementId) {
      return makeNodeTarget(node, source);
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
