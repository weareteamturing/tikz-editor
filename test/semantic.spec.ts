import { describe, expect, it } from "vitest";

import { parseTikz } from "../src/parser/index.js";
import { evaluateTikzFigure } from "../src/semantic/evaluate.js";

describe("semantic evaluator", () => {
  it("applies style cascade with statement options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red, line width=2pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.stroke).toBe("red");
      expect(path.style.lineWidth).toBeCloseTo(2);
    }
  });

  it("uses black stroke as default for draw command", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.stroke).toBe("black");
    }
  });

  it("supports relative and polar coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- ++(1,0) -- +(90:1cm);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.commands.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("composes scope transforms", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1cm,yshift=2cm]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const move = path.commands.find((command) => command.kind === "M");
      expect(move?.kind).toBe("M");
      if (move?.kind === "M") {
        expect(move.to.x).toBeCloseTo(28.3464, 3);
        expect(move.to.y).toBeCloseTo(56.6929, 3);
      }
    }
  });

  it("emits warning for unsupported foreach semantics", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1} \draw (\x,0) -- ++(1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-foreach")).toBe(true);
  });

  it("supports basic to/ellipse/arc/grid semantics without unsupported diagnostics", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) to (1,1);
  \draw (0,0) ellipse [x radius=1cm, y radius=.5cm];
  \draw (0,0) arc [start angle=0, end angle=90, radius=1cm];
  \draw (0,0) grid [step=1cm] (2,2);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-to-operation")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-path-keyword")).toBe(false);
    expect(result.scene.elements.some((element) => element.kind === "Ellipse")).toBe(true);
    expect(result.scene.elements.some((element) => element.kind === "Path")).toBe(true);
  });
});
