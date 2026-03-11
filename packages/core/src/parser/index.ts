import type { Tree } from "@lezer/common";

import type { Diagnostic } from "../diagnostics/types.js";
import type { NodeItem, Statement } from "../ast/types.js";
import { FeatureFlags } from "../ast/features.js";
import { walkStatements } from "../ast/walk.js";
import { collectContextDefinitions, fromCst } from "../transform/cst-to-ast.js";
import type { TikzFigure, TikzFigureInventoryItem } from "../ast/types.js";
import { parseSyntax } from "../syntax/parse.js";

export type NodeTextValidationContext = {
  node: NodeItem;
  source: string;
};

export type NodeTextValidationIssue = {
  code?: string;
  message: string;
};

export type ParseTikzOptions = {
  recover?: boolean;
  activeFigureId?: string | null;
  includeContextDefinitions?: boolean;
  nodeTextValidator?: (context: NodeTextValidationContext) => NodeTextValidationIssue | null;
};

export type ParseTikzResult = {
  source: string;
  tree: Tree;
  figure: TikzFigure;
  figures: TikzFigureInventoryItem[];
  activeFigureId: string | null;
  diagnostics: Diagnostic[];
  features: typeof FeatureFlags;
};

type ContextDefinitionCacheEntry = {
  prefix: string;
  definitions: Statement[];
};

let contextDefinitionCache: ContextDefinitionCacheEntry | null = null;

export function parseTikz(input: string, opts: ParseTikzOptions = {}): ParseTikzResult {
  const recover = opts.recover ?? true;
  const figureSpans = scanFigureSpans(input);
  const activeFigureSpan = resolveActiveFigureSpan(figureSpans, opts.activeFigureId);
  const parseSource = resolveParseWindowSource(input, activeFigureSpan);
  const contextDefinitions =
    opts.includeContextDefinitions && activeFigureSpan
      ? getCachedContextDefinitions(input.slice(0, activeFigureSpan.from))
      : undefined;
  const tree = parseSyntax(parseSource);

  const mapped = fromCst(tree, input, {
    activeFigureId: opts.activeFigureId,
    includeContextDefinitions: opts.includeContextDefinitions ?? false,
    contextDefinitions
  });
  const diagnostics = [...mapped.diagnostics];

  const nodeTextValidator = opts.nodeTextValidator;
  if (nodeTextValidator) {
    const allNodes = collectNodeItems(mapped.figure.body);
    for (const node of allNodes) {
      const issue = nodeTextValidator({ node, source: input });
      if (!issue) {
        continue;
      }
      diagnostics.push({
        severity: "error",
        code: issue.code ?? "invalid-node-tex",
        message: issue.message,
        span: node.textSpan
      });
    }
  }

  if (!recover) {
    const firstError = diagnostics.find((diagnostic) => diagnostic.severity === "error");
    if (firstError) {
      throw new Error(`TikZ parse failed at ${firstError.span.from}-${firstError.span.to}: ${firstError.message}`);
    }
  }

  return {
    source: input,
    tree,
    figure: mapped.figure,
    figures: mapped.figures,
    activeFigureId: mapped.activeFigureId,
    diagnostics,
    features: FeatureFlags
  };
}

function resolveParseWindowSource(source: string, activeFigureSpan: { from: number; to: number } | null): string {
  if (!activeFigureSpan) {
    return source;
  }
  const safeFrom = Math.max(0, Math.min(source.length, activeFigureSpan.from));
  const safeTo = Math.max(safeFrom, Math.min(source.length, activeFigureSpan.to));
  const prefix = source.slice(0, safeFrom).replace(/[^\n]/g, " ");
  const figure = source.slice(safeFrom, safeTo);
  return `${prefix}${figure}`;
}

function resolveActiveFigureSpan(
  spans: readonly { from: number; to: number }[],
  activeFigureId: string | null | undefined
): { from: number; to: number } | null {
  if (activeFigureId === null) {
    return null;
  }
  if (spans.length === 0) {
    return null;
  }
  const requestedIndex = activeFigureId ? parseFigureIndexFromId(activeFigureId) : 0;
  const index =
    requestedIndex != null && requestedIndex >= 0 && requestedIndex < spans.length
      ? requestedIndex
      : 0;
  return spans[index] ?? null;
}

function getCachedContextDefinitions(prefix: string): Statement[] {
  const cache = contextDefinitionCache;
  if (cache && cache.prefix === prefix) {
    return cache.definitions;
  }
  const definitions = collectContextDefinitions(prefix);
  contextDefinitionCache = { prefix, definitions };
  return definitions;
}

function scanFigureSpans(source: string): Array<{ from: number; to: number }> {
  const beginPattern = /\\begin\{tikzpicture\*?\}/g;
  const spans: Array<{ from: number; to: number }> = [];
  let match = beginPattern.exec(source);
  while (match) {
    const beginRaw = match[0] ?? "";
    const from = match.index;
    const beginTo = from + beginRaw.length;
    const endToken = beginRaw.endsWith("*}") ? "\\end{tikzpicture*}" : "\\end{tikzpicture}";
    const endFrom = source.indexOf(endToken, beginTo);
    if (endFrom < 0) {
      break;
    }
    spans.push({ from, to: endFrom + endToken.length });
    beginPattern.lastIndex = endFrom + endToken.length;
    match = beginPattern.exec(source);
  }
  return spans;
}

function parseFigureIndexFromId(figureId: string): number | null {
  const match = /^figure:(\d+)(?::|$)/u.exec(figureId.trim());
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectNodeItems(statements: Statement[]): NodeItem[] {
  const nodes: NodeItem[] = [];
  walkStatements(statements, {
    onNode: (node) => {
      nodes.push(node);
    }
  });
  return nodes;
}

export type { Diagnostic } from "../diagnostics/types.js";
export type * from "../ast/types.js";
