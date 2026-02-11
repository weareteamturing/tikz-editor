import { describe, expect, it } from "vitest";

import { parseTikz } from "../src/parser/index.js";
import { evaluateTikzFigure } from "../src/semantic/evaluate.js";
import { emitSvg } from "../src/svg/emit.js";

describe("svg emitter", () => {
  it("emits deterministic SVG for path, circle, and ellipse", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- cycle;
  \draw (0,0) circle [radius=1cm];
  \draw (0,0) ellipse [x radius=1cm, y radius=.5cm];
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene, { padding: 5 });

    expect(emitted.svg).toContain("<svg");
    expect(emitted.svg).toContain("<path");
    expect(emitted.svg).toContain("<circle");
    expect(emitted.svg).toContain("<ellipse");
    expect(emitted.svg).toContain(`stroke="black"`);
    expect(emitted.viewBox.width).toBeGreaterThan(0);
    expect(emitted.diagnostics.length).toBeGreaterThanOrEqual(0);
  });

  it("emits text nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (1,1) {Hello};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain("<text");
    expect(emitted.svg).toContain("Hello");
  });
});
