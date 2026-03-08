import type { Tree } from "@lezer/common";

import type { Diagnostic } from "../diagnostics/types.js";
import type { TikzFigure } from "../ast/types.js";
import { mapBodyStatements } from "../domains/statements/parse.js";
import { parseOptionListRaw } from "../options/parse.js";
import { findFirstChildByName, findFirstNodeByName } from "../syntax/cursor.js";
import { collectParseErrorDiagnostics, collectStructuralDiagnostics } from "../diagnostics/collect.js";

export type CstToAstResult = {
  figure: TikzFigure;
  diagnostics: Diagnostic[];
};

export type CstToIrResult = CstToAstResult;

export function fromCst(tree: Tree, source: string): CstToAstResult {
  const diagnostics: Diagnostic[] = [];
  collectParseErrorDiagnostics(tree.topNode, diagnostics);

  const figureNode =
    findFirstNodeByName(tree.topNode, "TikzEnvironment") ?? findFirstNodeByName(tree.topNode, "TikzInline");
  if (!figureNode) {
    diagnostics.push({
      severity: "warning",
      message: "No TikZ figure command found.",
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

  const state = { nextStatementIndex: 0 };
  const body = mapBodyStatements(figureNode, source, state);
  const optionsNode = findFirstChildByName(figureNode, "OptionList");

  collectStructuralDiagnostics(figureNode, source, diagnostics);

  return {
    figure: {
      kind: "Figure",
      span: { from: figureNode.from, to: figureNode.to },
      options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
      body
    },
    diagnostics
  };
}
