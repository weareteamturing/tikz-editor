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

  const state = { nextStatementIndex: 0 };
  const body = mapBodyStatements(envNode, source, state);
  const optionsNode = findFirstChildByName(envNode, "OptionList");

  collectStructuralDiagnostics(envNode, source, diagnostics);

  return {
    figure: {
      kind: "Figure",
      span: { from: envNode.from, to: envNode.to },
      options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
      body
    },
    diagnostics
  };
}
