import type { SyntaxNode, Tree } from "@lezer/common";

import type { Diagnostic } from "../diagnostics/types.js";
import type { Statement, TikzFigure } from "../ast/types.js";
import { mapPathStatement } from "../domains/paths/parse.js";
import { mapUnknownStatement } from "./unknown.js";
import { findFirstNodeByName, walk } from "../syntax/cursor.js";
import { collectParseErrorDiagnostics, collectStructuralDiagnostics } from "../diagnostics/collect.js";

export type CstToAstResult = {
  figure: TikzFigure;
  diagnostics: Diagnostic[];
};

export type CstToIrResult = CstToAstResult;

export function fromCst(tree: Tree, source: string): CstToAstResult {
  const diagnostics: Diagnostic[] = [];
  collectParseErrorDiagnostics(tree.topNode, diagnostics);

  const envNode = findFirstNodeByName(tree.topNode, "TikzEnvironment");
  if (!envNode) {
    diagnostics.push({
      severity: "warning",
      message: "No tikzpicture environment found.",
      span: { from: 0, to: source.length },
      code: "missing-tikzpicture"
    });

    return {
      figure: {
        kind: "Figure",
        span: { from: 0, to: source.length },
        body: []
      },
      diagnostics
    };
  }

  const body: Statement[] = [];
  const statementNodes: SyntaxNode[] = [];

  walk(envNode, (node) => {
    if (node.type.name === "PathStatement" || node.type.name === "UnknownStatement") {
      statementNodes.push(node);
    }
  });

  statementNodes.sort((a, b) => a.from - b.from);
  statementNodes.forEach((statementNode, statementIndex) => {
    if (statementNode.type.name === "PathStatement") {
      body.push(mapPathStatement(statementNode, source, statementIndex));
      return;
    }

    body.push(mapUnknownStatement(statementNode, source, statementIndex));
  });

  collectStructuralDiagnostics(envNode, source, diagnostics);

  return {
    figure: {
      kind: "Figure",
      span: { from: envNode.from, to: envNode.to },
      body
    },
    diagnostics
  };
}
