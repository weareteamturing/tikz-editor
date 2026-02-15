import type { Tree } from "@lezer/common";

import type { Diagnostic } from "../diagnostics/types.js";
import type { NodeItem, PathItem, Statement } from "../ast/types.js";
import { FeatureFlags } from "../ast/features.js";
import { fromCst } from "../transform/cst-to-ast.js";
import type { TikzFigure } from "../ast/types.js";
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
  nodeTextValidator?: (context: NodeTextValidationContext) => NodeTextValidationIssue | null;
};

export type ParseTikzResult = {
  source: string;
  tree: Tree;
  figure: TikzFigure;
  diagnostics: Diagnostic[];
  features: typeof FeatureFlags;
};

export function parseTikz(input: string, opts: ParseTikzOptions = {}): ParseTikzResult {
  const recover = opts.recover ?? true;
  const tree = parseSyntax(input);

  const mapped = fromCst(tree, input);
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
    diagnostics,
    features: FeatureFlags
  };
}

function collectNodeItems(statements: Statement[]): NodeItem[] {
  const nodes: NodeItem[] = [];
  for (const statement of statements) {
    if (statement.kind === "Path") {
      collectPathNodes(statement.items, nodes);
      continue;
    }
    if (statement.kind === "Scope") {
      nodes.push(...collectNodeItems(statement.body));
    }
  }
  return nodes;
}

function collectPathNodes(items: PathItem[], target: NodeItem[]): void {
  for (const item of items) {
    if (item.kind === "Node") {
      target.push(item);
      continue;
    }
    if ((item.kind === "ToOperation" || item.kind === "EdgeOperation") && item.nodes) {
      target.push(...item.nodes);
    }
  }
}

export type { Diagnostic } from "../diagnostics/types.js";
export type * from "../ast/types.js";
