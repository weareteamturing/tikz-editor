import { describe, expect, it } from "vitest";

import { parseLength } from "../packages/core/src/semantic/coords/parse-length.js";
import { evaluateSemantic } from "./semantic/helpers.js";

describe("parseLength units", () => {
  it("treats px as equivalent to bp", () => {
    const bp = parseLength("1bp", "pt");
    const px = parseLength("1px", "pt");

    expect(bp).not.toBeNull();
    expect(px).not.toBeNull();
    if (bp == null || px == null) {
      return;
    }
    expect(px).toBeCloseTo(bp, 10);
  });

  it("accepts xshift lengths in px without invalid-length diagnostics", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[anchor=east, xshift=-5px] at (0,0) {$0$};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => (diagnostic.code ?? "").startsWith("invalid-xshift"))).toBe(false);
  });
});
