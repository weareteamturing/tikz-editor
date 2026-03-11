import type { Tree } from "@lezer/common";

import type { Diagnostic } from "../diagnostics/types.js";
import type { Statement, TikzFigure, TikzFigureInventoryItem } from "../ast/types.js";
import { unknownStatementId } from "../ast/ids.js";
import { mapBodyStatements, mapStatementNode, unwrapStatementLikeNode } from "../domains/statements/parse.js";
import { parseOptionListRaw } from "../options/parse.js";
import { findFirstChildByName, findFirstNodeByName, forEachChild, walk } from "../syntax/cursor.js";
import { parseSyntax } from "../syntax/parse.js";
import { collectParseErrorDiagnostics, collectStructuralDiagnostics } from "../diagnostics/collect.js";

export type CstToAstResult = {
  figure: TikzFigure;
  figures: TikzFigureInventoryItem[];
  activeFigureId: string | null;
  diagnostics: Diagnostic[];
};

export type CstToIrResult = CstToAstResult;

export type CstToAstOptions = {
  activeFigureId?: string | null;
  includeContextDefinitions?: boolean;
  contextDefinitions?: Statement[];
};

type FigureNodeEntry = {
  id: string;
  node: import("@lezer/common").SyntaxNode | null;
  inventory: TikzFigureInventoryItem;
};

export function fromCst(tree: Tree, source: string, opts: CstToAstOptions = {}): CstToAstResult {
  const diagnostics: Diagnostic[] = [];
  collectParseErrorDiagnostics(tree.topNode, diagnostics);

  const figureEntries = collectFigureNodes(tree, source);
  const activeFigureEntry = resolveActiveFigureEntry(figureEntries, opts.activeFigureId);
  if (figureEntries.length === 0) {
    const inlineNode = findFirstNodeByName(tree.topNode, "TikzInline");
    if (inlineNode) {
      const state = { nextStatementIndex: 0 };
      const inlineBody = mapBodyStatements(inlineNode, source, state);
      const optionsNode = findFirstChildByName(inlineNode, "OptionList");
      return {
        figure: {
          kind: "Figure",
          span: { from: inlineNode.from, to: inlineNode.to },
          options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
          body: inlineBody
        },
        figures: [],
        activeFigureId: null,
        diagnostics
      };
    }
  }
  if (!activeFigureEntry) {
    if (figureEntries.length === 0) {
      diagnostics.push({
        severity: "warning",
        message: "No TikZ figure command found.",
        span: { from: 0, to: source.length },
        code: "missing-tikzpicture"
      });
    }

    return {
      figure: {
        kind: "Figure",
        span: { from: 0, to: source.length },
        body: []
      },
      figures: figureEntries.map((entry) => entry.inventory),
      activeFigureId: null,
      diagnostics
    };
  }

  const state = { nextStatementIndex: 0 };
  const activeSyntax = resolveActiveSyntaxNode(source, activeFigureEntry);
  if (!activeSyntax) {
    return {
      figure: {
        kind: "Figure",
        span: activeFigureEntry.inventory.span,
        body: []
      },
      figures: figureEntries.map((entry) => entry.inventory),
      activeFigureId: activeFigureEntry.id,
      diagnostics
    };
  }
  const priorDefinitions = opts.includeContextDefinitions
    ? (opts.contextDefinitions ?? collectPriorDefinitions(tree, source, activeFigureEntry.inventory.span.from, state))
    : [];
  if (opts.includeContextDefinitions && opts.contextDefinitions) {
    state.nextStatementIndex = priorDefinitions.length;
  }
  const activeBody = mapBodyStatements(activeSyntax.node, activeSyntax.parseSource, state);
  const body = [...priorDefinitions, ...activeBody];
  const optionsNode = findFirstChildByName(activeSyntax.node, "OptionList");

  const structuralDiagnostics: Diagnostic[] = [];
  collectStructuralDiagnostics(activeSyntax.node, activeSyntax.parseSource, structuralDiagnostics);
  diagnostics.push(...structuralDiagnostics);

  return {
    figure: {
      kind: "Figure",
      span: activeFigureEntry.inventory.span,
      options: optionsNode
        ? parseOptionListRaw(activeSyntax.parseSource.slice(optionsNode.from, optionsNode.to), optionsNode.from)
        : undefined,
      body
    },
    figures: figureEntries.map((entry) => entry.inventory),
    activeFigureId: activeFigureEntry.id,
    diagnostics
  };
}

function collectFigureNodes(tree: Tree, source: string): FigureNodeEntry[] {
  const nodes: FigureNodeEntry[] = [];
  const parsedNodes = collectParsedFigureNodes(tree);
  const lineStarts = buildLineStarts(source);
  const scanned = scanFigureInventories(source, lineStarts);
  for (let index = 0; index < scanned.length; index += 1) {
    const inventory = scanned[index]!;
    const id = `figure:${index}`;
    const parsedNode = parsedNodes.find(
      (candidate) => candidate.from === inventory.span.from && candidate.to === inventory.span.to
    ) ?? null;
    nodes.push({
      id,
      node: parsedNode,
      inventory: {
        id,
        span: inventory.span,
        beginSpan: inventory.beginSpan,
        endSpan: inventory.endSpan,
        optionsSpan: inventory.optionsSpan,
        startLine: inventory.startLine,
        endLine: inventory.endLine
      }
    });
  }
  nodes.sort((left, right) => left.inventory.span.from - right.inventory.span.from);
  return nodes;
}

function resolveActiveFigureEntry(entries: FigureNodeEntry[], requestedId: string | null | undefined): FigureNodeEntry | null {
  if (entries.length === 0) {
    return null;
  }
  if (requestedId === null) {
    return null;
  }
  if (requestedId === undefined || requestedId.length === 0) {
    return entries[0] ?? null;
  }
  const directMatch = entries.find((entry) => entry.id === requestedId);
  if (directMatch) {
    return directMatch;
  }
  const requestedIndex = parseFigureIndexFromId(requestedId);
  if (requestedIndex == null || requestedIndex < 0 || requestedIndex >= entries.length) {
    return entries[0] ?? null;
  }
  return entries[requestedIndex] ?? (entries[0] ?? null);
}

function parseFigureIndexFromId(figureId: string): number | null {
  const match = /^figure:(\d+)(?::|$)/u.exec(figureId.trim());
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectPriorDefinitions(
  tree: Tree,
  source: string,
  activeFrom: number,
  state: { nextStatementIndex: number }
): Statement[] {
  const defs: Statement[] = [];
  const beginDocumentOffset = findBeginDocumentOffset(source);

  forEachChild(tree.topNode, (child) => {
    if (child.from >= activeFrom) {
      return;
    }
    if (child.type.name === "TikzEnvironment") {
      defs.push(...collectRelevantStatementsFromNode(child, source, state));
      return;
    }
    if (child.type.name === "TikzInline") {
      return;
    }
    if (child.to <= beginDocumentOffset || child.from < activeFrom) {
      const unwrapped = unwrapStatementLikeNode(child);
      if (!isRelevantDefinitionNode(unwrapped, source)) {
        return;
      }
      const mapped = mapStatementNode(unwrapped, source, state);
      if (mapped) {
        defs.push(mapped);
      }
    }
  });

  return defs;
}

export function collectContextDefinitions(source: string): Statement[] {
  if (source.length === 0) {
    return [];
  }
  const tree = parseSyntax(source);
  const state = { nextStatementIndex: 0 };
  const collected = collectPriorDefinitions(tree, source, source.length, state);
  const fallback = collectFallbackDefinitionCommands(source, collected.length);
  if (fallback.length === 0) {
    return collected;
  }
  const coveredSpans = collected.map((statement) => statement.span);
  for (const statement of fallback) {
    const alreadyCovered = coveredSpans.some((span) => span.from <= statement.span.from && span.to >= statement.span.to);
    if (!alreadyCovered) {
      collected.push(statement);
      coveredSpans.push(statement.span);
    }
  }
  return collected;
}

function collectParsedFigureNodes(tree: Tree): import("@lezer/common").SyntaxNode[] {
  const nodes: import("@lezer/common").SyntaxNode[] = [];
  walk(tree.topNode, (node) => {
    if (node.type.name === "TikzEnvironment") {
      nodes.push(node);
    }
  });
  return nodes;
}

function resolveActiveSyntaxNode(
  source: string,
  activeFigureEntry: FigureNodeEntry
): { node: import("@lezer/common").SyntaxNode; parseSource: string } | null {
  if (activeFigureEntry.node) {
    return { node: activeFigureEntry.node, parseSource: source };
  }
  const maskedSource = maskSourceToFigure(source, activeFigureEntry.inventory.span.from, activeFigureEntry.inventory.span.to);
  const tree = parseSyntax(maskedSource);
  const node = findFirstNodeByName(tree.topNode, "TikzEnvironment");
  if (!node) {
    return null;
  }
  return {
    node,
    parseSource: maskedSource
  };
}

function maskSourceToFigure(source: string, from: number, to: number): string {
  const safeFrom = Math.max(0, Math.min(source.length, from));
  const safeTo = Math.max(safeFrom, Math.min(source.length, to));
  const prefix = source
    .slice(0, safeFrom)
    .replace(/[^\n]/g, " ");
  const figure = source.slice(safeFrom, safeTo);
  return `${prefix}${figure}`;
}

function scanFigureInventories(
  source: string,
  lineStarts: number[]
): Array<Omit<TikzFigureInventoryItem, "id">> {
  const beginPattern = /\\begin\{tikzpicture\*?\}/g;
  const figures: Array<Omit<TikzFigureInventoryItem, "id">> = [];
  let match = beginPattern.exec(source);

  while (match) {
    const beginRaw = match[0] ?? "";
    const beginFrom = match.index;
    const beginTo = beginFrom + beginRaw.length;
    const endToken = beginRaw.endsWith("*}") ? "\\end{tikzpicture*}" : "\\end{tikzpicture}";
    const endFrom = source.indexOf(endToken, beginTo);
    if (endFrom < 0) {
      break;
    }
    const endTo = endFrom + endToken.length;
    const optionsSpan = scanFigureOptionsSpan(source, beginTo, endFrom);
    figures.push({
      span: { from: beginFrom, to: endTo },
      beginSpan: { from: beginFrom, to: beginTo },
      endSpan: { from: endFrom, to: endTo },
      optionsSpan,
      startLine: lineForOffset(beginFrom, lineStarts),
      endLine: lineForOffset(Math.max(beginFrom, endTo - 1), lineStarts)
    });
    beginPattern.lastIndex = endTo;
    match = beginPattern.exec(source);
  }

  return figures;
}

function scanFigureOptionsSpan(source: string, cursor: number, figureEnd: number): { from: number; to: number } | undefined {
  let index = cursor;
  while (index < figureEnd && /\s/u.test(source[index] ?? "")) {
    index += 1;
  }
  if ((source[index] ?? "") !== "[") {
    return undefined;
  }
  let depth = 0;
  for (let i = index; i < figureEnd; i += 1) {
    const ch = source[i] ?? "";
    if (ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return { from: index, to: i + 1 };
      }
    }
  }
  return undefined;
}

function collectRelevantStatementsFromNode(
  node: import("@lezer/common").SyntaxNode,
  source: string,
  state: { nextStatementIndex: number }
): Statement[] {
  const statements: Statement[] = [];
  forEachChild(node, (child) => {
    const unwrapped = unwrapStatementLikeNode(child);
    if (!isRelevantDefinitionNode(unwrapped, source)) {
      return;
    }
    const mapped = mapStatementNode(unwrapped, source, state);
    if (mapped) {
      statements.push(mapped);
    }
  });
  return statements;
}

function isRelevantDefinitionNode(node: import("@lezer/common").SyntaxNode, source: string): boolean {
  const typeName = node.type.name;
  if (
    typeName === "MacroDefinitionStatement" ||
    typeName === "MacroAliasStatement" ||
    typeName === "MacroCommandDefinitionStatement" ||
    typeName === "StyleDefinitionStatement" ||
    typeName === "TikzSetStatement" ||
    typeName === "TikzStyleStatement" ||
    typeName === "PgfkeysStatement" ||
    typeName === "TikzLibraryStatement" ||
    typeName === "ColorletStatement" ||
    typeName === "DefineColorStatement" ||
    typeName === "FontSizeStatement"
  ) {
    return true;
  }
  if (typeName !== "UnknownStatement") {
    return false;
  }
  const raw = source.slice(node.from, node.to).trimStart().toLowerCase();
  return raw.startsWith("\\tikzset") ||
    raw.startsWith("\\tikzstyle") ||
    raw.startsWith("\\pgfkeys") ||
    raw.startsWith("\\usetikzlibrary") ||
    raw.startsWith("\\definecolor") ||
    raw.startsWith("\\colorlet");
}

function findBeginDocumentOffset(source: string): number {
  const match = /\\begin\s*\{\s*document\s*\}/.exec(source);
  if (!match) {
    return source.length;
  }
  return match.index;
}

function collectFallbackDefinitionCommands(source: string, startIndex: number): Statement[] {
  const commands = /\\(tikzset|pgfkeys|usetikzlibrary|definecolor|colorlet|tikzstyle)\b/giu;
  const statements: Statement[] = [];
  let match = commands.exec(source);
  let index = startIndex;
  while (match) {
    const from = match.index;
    const command = (match[1] ?? "").toLowerCase();
    const to = resolveFallbackCommandEnd(source, from, command);
    if (to > from) {
      statements.push({
        kind: "UnknownStatement",
        id: unknownStatementId(index),
        span: { from, to },
        raw: source.slice(from, to)
      });
      index += 1;
      commands.lastIndex = to;
    }
    match = commands.exec(source);
  }
  return statements;
}

function resolveFallbackCommandEnd(source: string, from: number, command: string): number {
  let cursor = skipCommandName(source, from);
  if (command === "tikzstyle") {
    return findLineEnd(source, cursor);
  }
  if (command === "definecolor") {
    const afterThreeGroups = consumeBraceGroups(source, cursor, 3);
    return afterThreeGroups > cursor ? afterThreeGroups : findLineEnd(source, cursor);
  }
  if (command === "colorlet") {
    const afterTwoGroups = consumeBraceGroups(source, cursor, 2);
    return afterTwoGroups > cursor ? afterTwoGroups : findLineEnd(source, cursor);
  }
  const afterOneGroup = consumeBraceGroups(source, cursor, 1);
  return afterOneGroup > cursor ? afterOneGroup : findLineEnd(source, cursor);
}

function skipCommandName(source: string, from: number): number {
  let cursor = from + 1;
  while (cursor < source.length && /[A-Za-z@]/u.test(source[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function consumeBraceGroups(source: string, from: number, count: number): number {
  let cursor = from;
  for (let i = 0; i < count; i += 1) {
    while (cursor < source.length && /\s/u.test(source[cursor] ?? "")) {
      cursor += 1;
    }
    if ((source[cursor] ?? "") !== "{") {
      return from;
    }
    const groupEnd = findBalancedBraceEnd(source, cursor);
    if (groupEnd <= cursor) {
      return from;
    }
    cursor = groupEnd;
  }
  return cursor;
}

function findBalancedBraceEnd(source: string, openAt: number): number {
  let depth = 0;
  for (let i = openAt; i < source.length; i += 1) {
    const ch = source[i] ?? "";
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return openAt;
}

function findLineEnd(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length && source[cursor] !== "\n") {
    cursor += 1;
  }
  return cursor;
}

function buildLineStarts(source: string): number[] {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }
  return lineStarts;
}

function lineForOffset(offset: number, lineStarts: number[]): number {
  let low = 0;
  let high = lineStarts.length - 1;
  let answer = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid] <= offset) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer + 1;
}
