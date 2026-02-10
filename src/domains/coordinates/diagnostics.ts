import type { SyntaxNode } from "@lezer/common";

import type { Diagnostic } from "../../diagnostics/types.js";
import { walk } from "../../syntax/cursor.js";
import { parseCoordinate } from "./parse.js";

export function collectCoordinateDiagnostics(root: SyntaxNode, source: string, diagnostics: Diagnostic[]): void {
  walk(root, (node) => {
    if (node.type.name !== "Coordinate") {
      return;
    }

    const raw = source.slice(node.from, node.to);
    if (!parseCoordinate(raw).isWellFormed) {
      diagnostics.push({
        severity: "warning",
        message: "Malformed coordinate.",
        span: { from: node.from, to: node.to },
        code: "malformed-coordinate"
      });
    }
  });
}
