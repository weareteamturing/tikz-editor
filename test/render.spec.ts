import { describe, expect, it } from "vitest";

import { renderTikzToSvg } from "../src/render/index.js";

describe("render pipeline", () => {
  it("renders basic source end-to-end", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->,red] (0,0) -- (2,1);
  \node at (2,1) {A};
\end{tikzpicture}`;

    const result = renderTikzToSvg(source);

    expect(result.parse.figure.body.length).toBeGreaterThan(0);
    expect(result.semantic.scene.elements.length).toBeGreaterThan(0);
    expect(result.svg.svg).toContain("<svg");
    expect(result.svg.svg).toContain("<path");
    expect(result.svg.svg).toContain("<text");
  });

  it("keeps recoverable flow on partial input", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,
\end{tikzpicture}`;
    const result = renderTikzToSvg(source, {
      parse: { recover: true }
    });

    expect(result.parse.diagnostics.length).toBeGreaterThan(0);
    expect(result.semantic.scene.kind).toBe("SceneFigure");
  });
});

