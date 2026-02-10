import type { Tree } from "@lezer/common";

import { parser } from "../grammar/tikz-parser.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { FeatureFlags } from "../features.js";
import { fromCst } from "../ir/from-cst.js";
import type { TikzFigure } from "../ir/types.js";

export type ParseTikzOptions = {
  recover?: boolean;
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
  const tree = parser.parse(input);

  const mapped = fromCst(tree, input);

  if (!recover) {
    const firstError = mapped.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    if (firstError) {
      throw new Error(`TikZ parse failed at ${firstError.span.from}-${firstError.span.to}: ${firstError.message}`);
    }
  }

  return {
    source: input,
    tree,
    figure: mapped.figure,
    diagnostics: mapped.diagnostics,
    features: FeatureFlags
  };
}

export type { Diagnostic } from "../diagnostics/types.js";
export type * from "../ir/types.js";
