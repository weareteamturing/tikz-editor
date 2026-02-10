import type { SyntaxNode } from "@lezer/common";

import type { Diagnostic } from "./types.js";
import { walk } from "../syntax/cursor.js";
import { collectCoordinateDiagnostics } from "../domains/coordinates/diagnostics.js";

export function collectParseErrorDiagnostics(node: SyntaxNode, diagnostics: Diagnostic[]): void {
  const seen = new Set<string>();

  walk(node, (current) => {
    if (current.type.isError || current.type.name === "⚠") {
      const key = `${current.from}:${current.to}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);

      diagnostics.push({
        severity: "error",
        message: "Syntax error while parsing TikZ input.",
        span: { from: current.from, to: current.to },
        code: "parse-error"
      });
    }
  });
}

export function collectStructuralDiagnostics(envNode: SyntaxNode, source: string, diagnostics: Diagnostic[]): void {
  walk(envNode, (node) => {
    if (node.type.name === "OptionList" && source[node.to - 1] !== "]") {
      diagnostics.push({
        severity: "warning",
        message: "Unclosed option list.",
        span: { from: node.from, to: node.to },
        code: "missing-option-close"
      });
    }

    if (node.type.name === "Group" && source[node.to - 1] !== "}") {
      diagnostics.push({
        severity: "warning",
        message: "Unclosed group.",
        span: { from: node.from, to: node.to },
        code: "missing-group-close"
      });
    }
  });

  collectCoordinateDiagnostics(envNode, source, diagnostics);
}
