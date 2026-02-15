import { describe, expect, it } from "vitest";

import { parseTikz } from "../src/parser/index.js";
import { evaluateTikzFigure } from "../src/semantic/evaluate.js";
import { SHADOW_INHERIT_FILL, SHADOW_INHERIT_STROKE } from "../src/semantic/types.js";

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
      expect(path.style.stroke).toBe("#ff0000");
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

  it("uses named color flags as fill color for fill commands without enabling stroke", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill [green] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.fill).toBe("#00ff00");
      expect(path.style.stroke).toBeNull();
    }
  });

  it("uses xcolor mix flags as fill color for fill commands without enabling stroke", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill [green!50!white] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.fill).toBe("#80ff80");
      expect(path.style.stroke).toBeNull();
    }
  });

  it("supports lightgray named color flags", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill [lightgray] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:lightgray")).toBe(false);
    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.fill).toBe("#bfbfbf");
    }
  });

  it("resolves `. !` xcolor mixes against the current color", () => {
    const source = String.raw`\begin{tikzpicture}
  \filldraw[violet,fill=.!50] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.stroke).toBe("#800080");
      expect(path.style.fill).toBe("#c080c0");
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

  it("keeps `+` relative bases while advancing the drawn path cursor", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) +(0:1) -- +(90:1) -- +(180:1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const moves = path.commands.filter((command) => command.kind === "M");
      const originMoves = moves.filter((command) => Math.hypot(command.to.x, command.to.y) <= 1e-6);
      expect(originMoves).toHaveLength(1);
    }
  });

  it("supports `[turn]` polar coordinates using the previous segment direction", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- +(1,0) -- ([turn]90:1) -- ([turn]90:1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("invalid-turn-coordinate"))).toBe(false);
    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const lines = path.commands.filter((command) => command.kind === "L");
      expect(lines).toHaveLength(3);
      const uniqueTargets = new Set(lines.map((command) => `${command.to.x.toFixed(3)}:${command.to.y.toFixed(3)}`));
      expect(uniqueTargets.size).toBe(3);
    }
  });

  it("emits explicit diagnostics for currently unsupported path keywords", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) plot (1,1);
  \draw (0,0) bend (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const unsupportedKeywordDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-path-keyword");
    expect(unsupportedKeywordDiagnostics.length).toBeGreaterThanOrEqual(2);
  });

  it("evaluates edge operations as separate paths that do not advance the main current point", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (a) at (0,0) {A};
  \node (b) at (2,0) {B};
  \node (c) at (1,1.5) {C};
  \draw (a) edge (b) edge (c) -- (b);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-path-keyword")).toBe(false);

    const linePaths = result.scene.elements.filter((element) => {
      if (element.kind !== "Path") {
        return false;
      }
      return element.commands.length === 2 && element.commands[0]?.kind === "M" && element.commands[1]?.kind === "L";
    });

    expect(linePaths.length).toBe(3);
    const startKeys = linePaths.map((element) => {
      if (element.kind !== "Path") {
        return "";
      }
      const start = element.commands[0];
      if (start?.kind !== "M") {
        return "";
      }
      return `${start.to.x.toFixed(3)}:${start.to.y.toFixed(3)}`;
    });
    const startFrequencies = new Map<string, number>();
    for (const key of startKeys) {
      startFrequencies.set(key, (startFrequencies.get(key) ?? 0) + 1);
    }
    expect(Math.max(...startFrequencies.values())).toBeGreaterThanOrEqual(2);
  });

  it("draws edge paths from \\path and applies local edge styling", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) edge [->, dotted] (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.stroke).toBe("black");
      expect(path.style.markerEnd).toBeTruthy();
      expect(path.style.dashArray).toEqual([1, 3]);
    }
  });

  it("applies every edge styles when configured on the path scope", () => {
    const source = String.raw`\begin{tikzpicture}[every edge/.style={draw,red,dashed}]
  \path (0,0) edge (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.stroke === "red" || path.style.stroke === "#ff0000").toBe(true);
      expect(path.style.dashArray).toEqual([3, 3]);
    }
  });

  it("starts an edge directly after a named node at that node's border", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (b) at (2,0) {B};
  \path (0,0) node (c) {C} edge (b);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const c = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
    const edgePath = result.scene.elements.find((element) => element.kind === "Path");
    expect(c?.kind).toBe("Text");
    expect(edgePath?.kind).toBe("Path");
    if (c?.kind === "Text" && edgePath?.kind === "Path") {
      const start = edgePath.commands[0];
      expect(start?.kind).toBe("M");
      if (start?.kind === "M") {
        expect(start.to.x).toBeGreaterThan(c.position.x);
      }
    }
  });

  it("supports sin/cos path keywords as cubic segments", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) sin (1,1) cos (2,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-path-keyword")).toBe(false);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const commandKinds = path.commands.map((command) => command.kind);
      expect(commandKinds).toEqual(["M", "C", "C"]);
      const end = path.commands[path.commands.length - 1];
      expect(end?.kind).toBe("C");
      if (end?.kind === "C") {
        expect(end.to.x).toBeCloseTo(56.9055, 3);
        expect(end.to.y).toBeCloseTo(0, 3);
      }
    }
  });

  it("evaluates explicit and calc coordinate forms when possible", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (canvas cs:x=1cm,y=2cm) -- ($(1,1) + (2,0)$);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-coordinate-form:explicit")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-coordinate-form:calc")).toBe(false);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.commands.some((command) => command.kind === "L")).toBe(true);
    }
  });

  it("evaluates perpendicular coordinate syntax with |- and -|", () => {
    const source = String.raw`\begin{tikzpicture}
  \path coordinate (a) at (1,2) coordinate (b) at (3,4);
  \draw (a |- b) -- (a -| b);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    const drawPath = paths.find((element) => element.kind === "Path" && element.style.stroke != null);
    expect(drawPath?.kind).toBe("Path");
    if (drawPath?.kind !== "Path") {
      return;
    }

    const move = drawPath.commands[0];
    const line = drawPath.commands.find((command) => command.kind === "L");
    expect(move?.kind).toBe("M");
    expect(line?.kind).toBe("L");
    if (move?.kind === "M" && line?.kind === "L") {
      expect(move.to.x).toBeCloseTo(28.4528, 3);
      expect(move.to.y).toBeCloseTo(113.811, 3);
      expect(line.to.x).toBeCloseTo(85.3583, 3);
      expect(line.to.y).toBeCloseTo(56.9055, 3);
    }
  });

  it("evaluates perpendicular coordinates when calc operands are wrapped in braces", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (A) at (0,1)    {A};
  \node (B) at (1,1.5)  {B};
  \node (C) at (2,0)    {C};
  \node (D) at (2.5,-2) {D};
  \node at ({$(A)!.5!(B)$} -| {$(C)!.5!(D)$}) {X};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-perpendicular-coordinate")).toBe(false);

    const xLabel = result.scene.elements.find((element) => element.kind === "Text" && element.text === "X");
    expect(xLabel?.kind).toBe("Text");
    if (xLabel?.kind === "Text") {
      expect(xLabel.position.x).toBeCloseTo(64.0187, 3);
      expect(xLabel.position.y).toBeCloseTo(35.5659, 3);
    }
  });

  it("evaluates intersection-of and intersection cs coordinates for line pairs", () => {
    const source = String.raw`\begin{tikzpicture}
  \path coordinate (p) at (intersection cs:first line={(0,0)--(2,2)}, second line={(0,2)--(2,0)});
  \draw (intersection of 0,0--2,2 and 0,2--2,0) -- (p);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-coordinate-form:explicit")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-explicit-coordinate")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const drawPath = result.scene.elements.find((element) => element.kind === "Path" && element.style.stroke != null);
    expect(drawPath?.kind).toBe("Path");
    if (drawPath?.kind !== "Path") {
      return;
    }

    const move = drawPath.commands[0];
    const line = drawPath.commands.find((command) => command.kind === "L");
    expect(move?.kind).toBe("M");
    expect(line?.kind).toBe("L");
    if (move?.kind === "M" && line?.kind === "L") {
      expect(move.to.x).toBeCloseTo(28.4528, 3);
      expect(move.to.y).toBeCloseTo(28.4528, 3);
      expect(line.to.x).toBeCloseTo(28.4528, 3);
      expect(line.to.y).toBeCloseTo(28.4528, 3);
    }
  });

  it("supports name path and name intersections with alias naming", () => {
    const source = String.raw`\begin{tikzpicture}
  \path [name path=upward line] (1,0) -- (1,1);
  \path [name path=sloped line] (0,0) -- (30:1.5cm);
  \draw [name intersections={of=upward line and sloped line, by=x}] (1,0) -- (x);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:name path")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:name intersections")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:x"))).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-path:"))).toBe(false);

    const drawPath = result.scene.elements.find((element) => element.kind === "Path" && element.style.stroke != null);
    expect(drawPath?.kind).toBe("Path");
    if (drawPath?.kind !== "Path") {
      return;
    }

    const move = drawPath.commands[0];
    const line = drawPath.commands.find((command) => command.kind === "L");
    expect(move?.kind).toBe("M");
    expect(line?.kind).toBe("L");
    if (move?.kind === "M" && line?.kind === "L") {
      expect(move.to.x).toBeCloseTo(28.4528, 3);
      expect(move.to.y).toBeCloseTo(0, 3);
      expect(line.to.x).toBeCloseTo(28.4528, 3);
      expect(line.to.y).toBeCloseTo(16.427, 2);
    }
  });

  it("registers default intersection-n coordinates from name intersections", () => {
    const source = String.raw`\begin{tikzpicture}
  \path [name path=a] (0,0) -- (2,2);
  \path [name path=b] (0,2) -- (2,0);
  \draw [name intersections={of=a and b}] (intersection-1) -- (2,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:intersection-1"))).toBe(false);
    const drawPath = result.scene.elements.find((element) => element.kind === "Path" && element.style.stroke != null);
    expect(drawPath?.kind).toBe("Path");
    if (drawPath?.kind === "Path") {
      const move = drawPath.commands[0];
      expect(move?.kind).toBe("M");
      if (move?.kind === "M") {
        expect(move.to.x).toBeCloseTo(28.4528, 3);
        expect(move.to.y).toBeCloseTo(28.4528, 3);
      }
    }
  });

  it("orders cubic name intersections so by={a,b} assigns the center crossing to b", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw [name path=curve 1] (-2,-1) .. controls (8,-1) and (-8,1) .. (2,1);
  \draw [name path=curve 2] (-1,-2) .. controls (-1,8) and (1,-8) .. (1,2);
  \draw [name intersections={of=curve 1 and curve 2, by={a,b}}] (a) -- (b);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-path:"))).toBe(false);

    const intersectionSegment = result.scene.elements.find(
      (element) =>
        element.kind === "Path" &&
        element.style.stroke != null &&
        element.commands.some((command) => command.kind === "L") &&
        !element.commands.some((command) => command.kind === "C")
    );
    expect(intersectionSegment?.kind).toBe("Path");
    if (intersectionSegment?.kind !== "Path") {
      return;
    }

    const move = intersectionSegment.commands[0];
    const line = intersectionSegment.commands.find((command) => command.kind === "L");
    expect(move?.kind).toBe("M");
    expect(line?.kind).toBe("L");
    if (move?.kind === "M" && line?.kind === "L") {
      expect(move.to.x).toBeCloseTo(-28.2, 1);
      expect(move.to.y).toBeCloseTo(-28.2, 1);
      expect(line.to.x).toBeCloseTo(0, 1);
      expect(line.to.y).toBeCloseTo(0, 1);
    }
  });

  it("projects xyz coordinates onto 2d output and warns when z contributes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0,1) -- (1,1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-coordinate-form:xyz")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-coordinate-z-component")).toBe(true);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.commands.some((command) => command.kind === "L")).toBe(true);
    }
  });

  it("starts a new subpath when a coordinate appears without an operator", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) (0,1) -- (2,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.commands.map((command) => command.kind)).toEqual(["M", "L", "M", "L"]);
    }
  });

  it("does not carry operators across cycle into the next subpath", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1) -- (1,0) -- cycle (2,0) -- (3,1) -- (3,0) -- cycle;
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    expect(paths.length).toBe(2);
    const second = paths[1];
    expect(second?.kind).toBe("Path");
    if (second?.kind === "Path") {
      const move = second.commands[0];
      expect(move?.kind).toBe("M");
      if (move?.kind === "M") {
        expect(move.to.x).toBeCloseTo(56.9055, 3);
        expect(move.to.y).toBeCloseTo(0, 3);
      }
    }
  });

  it("supports the ultra thick line width preset", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[ultra thick] (0,0) -- (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.lineWidth).toBeCloseTo(1.6);
    }
  });

  it("supports the standard TikZ line width presets and explicit line width values", () => {
    const presets: Array<{ key: string; width: number }> = [
      { key: "ultra thin", width: 0.1 },
      { key: "very thin", width: 0.2 },
      { key: "thin", width: 0.4 },
      { key: "semithick", width: 0.6 },
      { key: "thick", width: 0.8 },
      { key: "very thick", width: 1.2 },
      { key: "ultra thick", width: 1.6 }
    ];

    for (const preset of presets) {
      const source = String.raw`\begin{tikzpicture}
  \draw[${preset.key}] (0,0) -- (1,0);
\end{tikzpicture}`;
      const parsed = parseTikz(source);
      const result = evaluateTikzFigure(parsed.figure, source);
      const path = result.scene.elements.find((element) => element.kind === "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.lineWidth).toBeCloseTo(preset.width);
      }
    }

    const explicitSource = String.raw`\begin{tikzpicture}
  \draw[line width=10pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const explicitParsed = parseTikz(explicitSource);
    const explicitResult = evaluateTikzFigure(explicitParsed.figure, explicitSource);
    const explicitPath = explicitResult.scene.elements.find((element) => element.kind === "Path");
    expect(explicitPath?.kind).toBe("Path");
    if (explicitPath?.kind === "Path") {
      expect(explicitPath.style.lineWidth).toBeCloseTo(10);
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
        expect(move.to.x).toBeCloseTo(28.4527, 3);
        expect(move.to.y).toBeCloseTo(56.9055, 3);
      }
    }
  });

  it("accepts braced shift vectors in scope options", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[shift={(0.2,0)}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("invalid-shift:"))).toBe(false);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const move = path.commands.find((command) => command.kind === "M");
      expect(move?.kind).toBe("M");
      if (move?.kind === "M") {
        expect(move.to.x).toBeCloseTo(5.6906, 3);
        expect(move.to.y).toBeCloseTo(0, 3);
      }
    }
  });

  it("expands foreach statements and attaches provenance metadata", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1}
    \node at (\x,0) {\x};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-foreach")).toBe(false);
    const labels = result.scene.elements.filter((element) => element.kind === "Text");
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      if (label.kind !== "Text") {
        continue;
      }
      expect(label.sourceId.startsWith("foreach:")).toBe(true);
      expect(label.origin?.foreachStack.length).toBeGreaterThan(0);
      expect(label.origin?.foreachStack[0]?.bindings["\\x"]).toBeDefined();
    }
  });

  it("supports directly-followed nested foreach loops", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1}
    \foreach \y in {0,1}
      \node at (\x,\y) {\x\y};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const labels = result.scene.elements.filter((element) => element.kind === "Text");
    expect(labels).toHaveLength(4);
    for (const label of labels) {
      if (label.kind !== "Text") {
        continue;
      }
      expect(label.origin?.foreachStack).toHaveLength(2);
      expect(label.origin?.foreachStack[0]?.bindings["\\x"]).toBeDefined();
      expect(label.origin?.foreachStack[1]?.bindings["\\y"]).toBeDefined();
    }
  });

  it("supports slash multi-variable bindings with repeat-last fallback", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x/\y in {1/a,2}
    \node at (\x,0) {\y};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const labels = result.scene.elements
      .filter((element) => element.kind === "Text")
      .map((element) => (element.kind === "Text" ? element.text : ""));
    expect(labels).toEqual(["a", "2"]);
  });

  it("supports grouped slash bindings in list entries", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \center/\r in {{(0,0)/2mm}, {(1,1)/3mm}, {(2,0)/1mm}}
    \draw[yshift=2.5cm] \center circle (\r);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate"))).toBe(false);

    const circles = result.scene.elements.filter((element) => element.kind === "Circle");
    expect(circles).toHaveLength(3);
    const maxRadius = circles.reduce((max, element) => {
      if (element.kind !== "Circle") {
        return max;
      }
      return Math.max(max, element.radius);
    }, 0);
    expect(maxRadius).toBeLessThan(10);
  });

  it("keeps single-anchor dots ranges as a single item", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {e,...,e}
    \node at (0,0) {\x};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const labels = result.scene.elements
      .filter((element) => element.kind === "Text")
      .map((element) => (element.kind === "Text" ? element.text : ""));
    expect(labels).toEqual(["e"]);
  });

  it("preserves TeX control sequence boundaries during foreach substitution", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {a}
    \foreach \y in {a}
      \node at (0,0) {$\mathstrut\x\y$};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const text = result.scene.elements.find((element) => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toBe(String.raw`$\mathstrut{}aa$`);
    }
  });

  it("expands dots lists for numeric, single-anchor, alphabetic, and contextual forms", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {1,2,...,4} \node at (\x,0) {\x};
  \foreach \x in {1,...,4} \node at (\x,1) {\x};
  \foreach \x in {a,...,d} \node at (0,0) {\x};
  \foreach \x in {2^1,2^...,2^4} \node at (0,0) {\x};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const labels = result.scene.elements
      .filter((element) => element.kind === "Text")
      .map((element) => (element.kind === "Text" ? element.text : ""));
    expect(labels).toEqual(
      expect.arrayContaining(["1", "2", "3", "4", "a", "b", "c", "d", "2^1", "2^2", "2^3", "2^4"])
    );
  });

  it("expands path foreach operations in-place", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2,3} { -- (\x,0) };
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path" && element.id.startsWith("scene-path:"));
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const lineCount = path.commands.filter((command) => command.kind === "L").length;
      expect(lineCount).toBe(3);
      expect(path.origin?.foreachStack.length).toBeGreaterThan(0);
      expect(path.origin?.foreachStack[0]?.bindings["\\x"]).toBe("1");
    }
  });

  it("expands node foreach clauses including chained clauses", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node foreach \p in {0.25,0.75} [pos=\p] {\p};
  \path (0,0) node foreach \x in {0,1} foreach \y in {a,b} {\x\y};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const labels = result.scene.elements.filter((element) => element.kind === "Text");
    expect(labels.length).toBeGreaterThanOrEqual(6);
    const chained = labels.filter((element) => element.kind === "Text" && /^(0|1)(a|b)$/.test(element.text));
    expect(chained).toHaveLength(4);
    for (const element of chained) {
      if (element.kind !== "Text") {
        continue;
      }
      expect(element.origin?.foreachStack).toHaveLength(2);
    }
  });

  it("supports core foreach options (var/evaluate/remember/count/parse/expand list)", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x [var=\v,count=\i from 1,remember=\x as \prev (initially 0),evaluate=\x as \dbl using \x*2,parse=true,expand list=true] in {1,2}
    \node at (\i,0) {\prev/\dbl/\v};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const unsupported = result.diagnostics.filter((diagnostic) => diagnostic.code.startsWith("foreach-unsupported-option:"));
    expect(unsupported).toHaveLength(0);

    const labels = result.scene.elements
      .filter((element) => element.kind === "Text")
      .map((element) => (element.kind === "Text" ? element.text : ""));
    expect(labels).toEqual(["0/2/1", "1/4/2"]);
  });

  it("enforces maxForeachExpansions with truncation warning", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1,2,3,4}
    \node at (\x,0) {\x};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source, { maxForeachExpansions: 2 });

    const labels = result.scene.elements.filter((element) => element.kind === "Text");
    expect(labels).toHaveLength(2);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "foreach-expansion-limit")).toBe(true);
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

  it("supports arc variants and grid step variants", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (1,0) arc (0:90:1cm);
  \draw (1,0) arc [start angle=0, delta angle=90, x radius=1cm, y radius=.5cm];
  \draw (0,0) grid [xstep=1cm, ystep=.5cm] (2,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-arc-parameters")).toBe(false);

    const arcPaths = result.scene.elements.filter((element) => element.kind === "Path");
    expect(arcPaths.length).toBeGreaterThanOrEqual(3);

    const arcCommands = arcPaths.flatMap((path) => (path.kind === "Path" ? path.commands : [])).filter((command) => command.kind === "A");
    expect(arcCommands.length).toBeGreaterThanOrEqual(2);
    for (const command of arcCommands) {
      if (command.kind === "A") {
        expect(command.rx).toBeGreaterThan(0);
        expect(command.ry).toBeGreaterThan(0);
      }
    }

    const gridElements = arcPaths.filter((path) => path.id.includes("scene-grid-"));
    expect(gridElements.length).toBe(6);
  });

  it("lets explicit x/y arc radii override inherited radius", () => {
    const source = String.raw`\begin{tikzpicture}[radius=1cm]
  \draw (8,0) arc [start angle=0, end angle=270, x radius=1cm, y radius=5mm];
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const arc = path.commands.find((command) => command.kind === "A");
      expect(arc?.kind).toBe("A");
      if (arc?.kind === "A") {
        expect(arc.rx).toBeCloseTo(28.4528, 3);
        expect(arc.ry).toBeCloseTo(14.2264, 3);
      }
    }
  });

  it("applies transform rotation to arc ellipse axes", () => {
    const source = String.raw`\begin{tikzpicture}[rotate=30]
  \draw (1,0) arc [start angle=0, end angle=90, x radius=1cm, y radius=.5cm];
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const arc = path.commands.find((command) => command.kind === "A");
      expect(arc?.kind).toBe("A");
      if (arc?.kind === "A") {
        const normalizedRotation = ((arc.xAxisRotation % 180) + 180) % 180;
        expect(normalizedRotation).toBeCloseTo(30, 3);
        expect(arc.rx).toBeCloseTo(28.4528, 3);
        expect(arc.ry).toBeCloseTo(14.2264, 3);
      }
    }
  });

  it("interprets unitless grid steps in axis units under transformed x vectors", () => {
    const source = String.raw`\begin{tikzpicture}[x=.5cm]
  \draw (0,0) grid [step=1] (3,2);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    const vertical = paths.filter((path) => path.id.includes("scene-grid-x:"));
    const horizontal = paths.filter((path) => path.id.includes("scene-grid-y:"));
    expect(vertical.length).toBe(4);
    expect(horizontal.length).toBe(3);
  });

  it("starts grid at the origin when no current point exists yet", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[help lines] grid (3,2);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "grid-without-start")).toBe(false);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    const vertical = paths.filter((path) => path.id.includes("scene-grid-x:"));
    const horizontal = paths.filter((path) => path.id.includes("scene-grid-y:"));
    expect(vertical.length).toBe(4);
    expect(horizontal.length).toBe(3);
  });

  it("scales default grid spacing with transformed coordinate systems", () => {
    const source = String.raw`\begin{tikzpicture}[scale=0.2]
  \draw (0,0) grid (10,10);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    const vertical = paths.filter((path) => path.id.includes("scene-grid-x:"));
    const horizontal = paths.filter((path) => path.id.includes("scene-grid-y:"));
    expect(vertical.length).toBe(11);
    expect(horizontal.length).toBe(11);
  });

  it("uses (0,0) as the default start for rectangle operations", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=orange] rectangle (3,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "rectangle-without-start")).toBe(false);
    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const move = path.commands[0];
      expect(move?.kind).toBe("M");
      if (move?.kind === "M") {
        expect(move.to.x).toBeCloseTo(0, 6);
        expect(move.to.y).toBeCloseTo(0, 6);
      }
    }
  });

  it("ignores empty node-name coordinates for node commands", () => {
    const source = String.raw`\begin{tikzpicture}
  \node () at (0,0) {Hi};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-coordinate-form:unknown")).toBe(false);
    const text = result.scene.elements.find((element) => element.kind === "Text" && element.text === "Hi");
    expect(text?.kind).toBe("Text");
  });

  it("applies rounded corners across cycle closure", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) [rounded corners=10pt] -- (1,1) -- (2,1)
                     [sharp corners] -- (2,0)
               [rounded corners=5pt] -- cycle;
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const cubicCount = path.commands.filter((command) => command.kind === "C").length;
      expect(cubicCount).toBeGreaterThanOrEqual(3);
      expect(path.commands.some((command) => command.kind === "Z")).toBe(true);
      const move = path.commands[0];
      expect(move?.kind).toBe("M");
      if (move?.kind === "M") {
        expect(move.to.x).toBeGreaterThan(0);
      }
    }
  });

  it("keeps named coordinates transformed at registration scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1cm,yshift=1cm]
    \path coordinate (p) at (1,2);
  \end{scope}
  \draw (p) -- ++(1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:p")).toBe(false);

    const path = result.scene.elements.find((element) => element.kind === "Path" && !element.id.includes("scene-grid-"));
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const move = path.commands.find((command) => command.kind === "M");
      expect(move?.kind).toBe("M");
      if (move?.kind === "M") {
        expect(move.to.x).toBeCloseTo(56.9055, 3);
        expect(move.to.y).toBeCloseTo(85.3582, 3);
      }
    }
  });

  it("evaluates matrix nodes, emits cell text, and registers generated matrix cell names", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,row sep=4mm,column sep=6mm] (m) {
    A & B \\
    C & D \\
  };
  \draw (m-1-1) -- (m-2-2);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.featureUsage.matrix_node).toBe("used-supported");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:m-1-1")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:m-2-2")).toBe(false);

    const matrixTexts = result.scene.elements
      .filter((element) => element.kind === "Text")
      .map((element) => (element.kind === "Text" ? element.text : ""))
      .sort();
    expect(matrixTexts).toEqual(["A", "B", "C", "D"]);

    const linePath = result.scene.elements.find(
      (element) =>
        element.kind === "Path" &&
        element.commands.length === 2 &&
        element.commands[0]?.kind === "M" &&
        element.commands[1]?.kind === "L"
    );
    expect(linePath?.kind).toBe("Path");
  });

  it("evaluates explicit \\node cell entries inside matrices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[row sep=3mm,column sep=5mm] (m) {
    \node(a) {1}; & \node {2}; \\
    \node {3}; & \node(b) {4}; \\
  };
  \draw (a) -- (b);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.featureUsage.matrix_node).toBe("used-supported");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:a")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:b")).toBe(false);

    const matrixTexts = result.scene.elements
      .filter((element) => element.kind === "Text")
      .map((element) => (element.kind === "Text" ? element.text : ""))
      .sort();
    expect(matrixTexts).toEqual(["1", "2", "3", "4"]);
  });

  it("resolves dash/cap/join and opacity style options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[opacity=0.8, draw opacity=0.6, fill opacity=0.3, dashed, line cap=round, line join=bevel] (0,0) -- (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.opacity).toBeCloseTo(1);
      expect(path.style.strokeOpacity).toBeCloseTo(0.6);
      expect(path.style.fillOpacity).toBeCloseTo(0.3);
      expect(path.style.lineCap).toBe("round");
      expect(path.style.lineJoin).toBe("bevel");
      expect(path.style.dashArray).toEqual([3, 3]);
    }
  });

  it("supports dash phase and dash shorthand while recognizing bar markers", () => {
    const source = String.raw`\begin{tikzpicture}[|-|, dash pattern=on 20pt off 10pt]
  \draw[dash phase=0pt] (0,0) -- (2,0);
  \draw[dash=on 20pt off 10pt phase 10pt] (0,1) -- (2,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:dash phase")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:dash")).toBe(false);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
    const topPath = paths[0];
    const bottomPath = paths[1];
    expect(topPath?.kind).toBe("Path");
    expect(bottomPath?.kind).toBe("Path");
    if (topPath?.kind === "Path" && bottomPath?.kind === "Path") {
      expect(topPath.style.markerStart?.tips.map((tip) => tip.kind)).toEqual(["bar"]);
      expect(topPath.style.markerEnd?.tips.map((tip) => tip.kind)).toEqual(["bar"]);
      expect(topPath.style.dashArray).toEqual([20, 10]);
      expect(topPath.style.dashOffset).toBeCloseTo(0);
      expect(bottomPath.style.dashArray).toEqual([20, 10]);
      expect(bottomPath.style.dashOffset).toBeCloseTo(10);
    }
  });

  it("resolves TikZ shading option keys into semantic shading state", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[top color=red,bottom color=blue,shading angle=30] (0,0) rectangle (1,1);
  \shade[left color=green,right color=yellow] (2,0) rectangle (3,1);
  \shade[inner color=white,outer color=black] (4,0) circle (0.5);
  \shade[ball color=red] (6,0) circle (0.5);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const unsupportedShadingOptions = result.diagnostics.filter((diagnostic) =>
      [
        "unsupported-option-key:top color",
        "unsupported-option-key:bottom color",
        "unsupported-option-key:left color",
        "unsupported-option-key:right color",
        "unsupported-option-key:inner color",
        "unsupported-option-key:outer color",
        "unsupported-option-key:ball color"
      ].includes(diagnostic.code)
    );
    expect(unsupportedShadingOptions).toHaveLength(0);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    expect(paths.length).toBeGreaterThanOrEqual(4);

    const axisPath = paths[0];
    expect(axisPath?.kind).toBe("Path");
    if (axisPath?.kind === "Path") {
      expect(axisPath.style.shadeEnabled).toBe(true);
      expect(axisPath.style.shading).toBe("axis");
      expect(axisPath.style.shadingAngle).toBeCloseTo(30);
      expect(axisPath.style.axisTopColor).toBe("#ff0000");
      expect(axisPath.style.axisBottomColor).toBe("#0000ff");
      expect(axisPath.style.axisMiddleColor).toBe("#800080");
    }

    const sideAxisPath = paths[1];
    expect(sideAxisPath?.kind).toBe("Path");
    if (sideAxisPath?.kind === "Path") {
      expect(sideAxisPath.style.shading).toBe("axis");
      expect(sideAxisPath.style.shadingAngle).toBeCloseTo(90);
      expect(sideAxisPath.style.axisTopColor).toBe("#00ff00");
      expect(sideAxisPath.style.axisBottomColor).toBe("#ffff00");
    }

    const radialPath = paths[2];
    expect(radialPath?.kind).toBe("Path");
    if (radialPath?.kind === "Path") {
      expect(radialPath.style.shading).toBe("radial");
      expect(radialPath.style.radialInnerColor).toBe("#ffffff");
      expect(radialPath.style.radialOuterColor).toBe("#000000");
    }

    const ballPath = paths[3];
    expect(ballPath?.kind).toBe("Path");
    if (ballPath?.kind === "Path") {
      expect(ballPath.style.shading).toBe("ball");
      expect(ballPath.style.ballColor).toBe("#ff0000");
    }
  });

  it("supports shade=false/none choices", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[shade,shade=false,fill=red] (0,0) rectangle (1,1);
  \draw[shade,shade=none,fill=blue] (2,0) rectangle (3,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    expect(paths.length).toBe(2);
    for (const path of paths) {
      if (path.kind === "Path") {
        expect(path.style.shadeEnabled).toBe(false);
      }
    }
  });

  it("resolves TikZ shadow option keys into semantic shadow layers", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[drop shadow] (0,0) rectangle (1,1);
  \draw[copy shadow={opacity=.4}] (2,0) rectangle (3,1);
  \draw[double copy shadow={shadow xshift=1ex,shadow yshift=1ex}] (4,0) rectangle (5,1);
  \draw[circular glow] (6,0) rectangle (7,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const unsupportedShadowDiagnostics = result.diagnostics.filter((diagnostic) =>
      [
        "unsupported-option-key:general shadow",
        "unsupported-option-key:drop shadow",
        "unsupported-option-key:copy shadow",
        "unsupported-option-key:double copy shadow",
        "unsupported-option-key:circular drop shadow",
        "unsupported-option-key:circular glow"
      ].includes(diagnostic.code)
    );
    expect(unsupportedShadowDiagnostics).toHaveLength(0);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    expect(paths.length).toBeGreaterThanOrEqual(4);

    const dropShadow = paths[0];
    expect(dropShadow?.kind).toBe("Path");
    if (dropShadow?.kind === "Path") {
      expect(dropShadow.style.shadowLayers).toHaveLength(1);
      expect(dropShadow.style.shadowLayers[0]?.scale).toBeCloseTo(1, 4);
      expect(dropShadow.style.shadowLayers[0]?.xshift).toBeCloseTo(2.15, 2);
      expect(dropShadow.style.shadowLayers[0]?.yshift).toBeCloseTo(-2.15, 2);
      expect(dropShadow.style.shadowLayers[0]?.style.stroke).toBeNull();
      expect(dropShadow.style.shadowLayers[0]?.style.fill).toBe("#808080");
      expect(dropShadow.style.shadowLayers[0]?.style.fillOpacity).toBeCloseTo(0.5, 4);
      expect(dropShadow.style.shadowLayers[0]?.style.strokeOpacity).toBeCloseTo(0.5, 4);
    }

    const copyShadow = paths[1];
    expect(copyShadow?.kind).toBe("Path");
    if (copyShadow?.kind === "Path") {
      expect(copyShadow.style.shadowLayers).toHaveLength(1);
      expect(copyShadow.style.shadowLayers[0]?.style.stroke).toBe(SHADOW_INHERIT_STROKE);
      expect(copyShadow.style.shadowLayers[0]?.style.fill).toBe(SHADOW_INHERIT_FILL);
      expect(copyShadow.style.shadowLayers[0]?.style.fillOpacity).toBeCloseTo(0.4, 4);
      expect(copyShadow.style.shadowLayers[0]?.style.strokeOpacity).toBeCloseTo(0.4, 4);
      expect(copyShadow.style.shadowLayers[0]?.style.shadeEnabled).toBe(false);
    }

    const doubleCopyShadow = paths[2];
    expect(doubleCopyShadow?.kind).toBe("Path");
    if (doubleCopyShadow?.kind === "Path") {
      expect(doubleCopyShadow.style.shadowLayers).toHaveLength(2);
      expect(doubleCopyShadow.style.shadowLayers[0]?.xshift).toBeCloseTo(8.6, 2);
      expect(doubleCopyShadow.style.shadowLayers[0]?.yshift).toBeCloseTo(8.6, 2);
      expect(doubleCopyShadow.style.shadowLayers[1]?.xshift).toBeCloseTo(4.3, 2);
      expect(doubleCopyShadow.style.shadowLayers[1]?.yshift).toBeCloseTo(4.3, 2);
    }

    const circularGlow = paths[3];
    expect(circularGlow?.kind).toBe("Path");
    if (circularGlow?.kind === "Path") {
      expect(circularGlow.style.shadowLayers).toHaveLength(1);
      expect(circularGlow.style.shadowLayers[0]?.fade).toBe("circle-fuzzy-edge-15");
      expect(circularGlow.style.shadowLayers[0]?.scale).toBeCloseTo(1.25, 4);
    }
  });

  it("keeps even-odd compound geometry for filled shadow preactions", () => {
    const source = String.raw`\begin{tikzpicture}[even odd rule]
  \draw[general shadow={fill=red}] (0,0) circle (.5) (0.5,0) circle (.5);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.shadowLayers).toHaveLength(1);
      expect(path.style.shadowLayers[0]?.style.fillRule).toBe("evenodd");
      expect(path.commands.filter((command) => command.kind === "Z")).toHaveLength(2);
    }
  });

  it("supports arrows and >/< shorthand keys used in tikz arrow specs", () => {
    const source = String.raw`\begin{tikzpicture}[>=Stealth]
  \draw[arrows={-Latex[open,length=10pt]}] (0,0) -- (2,0);
  \draw[>->] (0,1) -- (2,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:arrows")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:>")).toBe(false);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    expect(paths.length).toBeGreaterThanOrEqual(2);

    const explicitArrows = paths[0];
    const shorthandArrows = paths[1];
    expect(explicitArrows?.kind).toBe("Path");
    expect(shorthandArrows?.kind).toBe("Path");
    if (explicitArrows?.kind === "Path" && shorthandArrows?.kind === "Path") {
      expect(explicitArrows.style.markerStart).toBeNull();
      expect(explicitArrows.style.markerEnd?.tips[0]?.kind).toBe("latex");
      expect(explicitArrows.style.markerEnd?.tips[0]?.open).toBe(true);
      expect(explicitArrows.style.markerEnd?.tips[0]?.length).toBeCloseTo(10, 3);

      expect(shorthandArrows.style.markerStart?.tips[0]?.kind).toBe("stealth");
      expect(shorthandArrows.style.markerEnd?.tips[0]?.kind).toBe("stealth");
    }
  });

  it("uses computer modern rightarrow as the default > tip in arrows.meta-style specs", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->]        (0,0)   -- (1,0);
  \draw[>-Stealth] (0,0.3) -- (1,0.3);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);
    const paths = result.scene.elements.filter((element) => element.kind === "Path");

    expect(paths.length).toBeGreaterThanOrEqual(2);

    const first = paths[0];
    const second = paths[1];
    expect(first?.kind).toBe("Path");
    expect(second?.kind).toBe("Path");
    if (first?.kind === "Path" && second?.kind === "Path") {
      expect(first.style.markerStart).toBeNull();
      expect(first.style.markerEnd?.tips[0]?.kind).toBe("cm-rightarrow");
      expect(second.style.markerStart?.tips[0]?.kind).toBe("cm-rightarrow");
      expect(second.style.markerEnd?.tips[0]?.kind).toBe("stealth");
    }
  });

  it("treats double distance as enabling a double stroke", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[thin,double distance=2pt] (0,0) arc (180:90:1cm);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.doubleStroke).toBe(true);
      expect(path.style.doubleDistance).toBeCloseTo(2);
    }
  });

  it("registers node anchors used by |- and -| paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node(a) [draw] {A}  (1,1) node(b) [draw] {B};
  \draw (a.north) |- (b.west);
  \draw[color=red] (a.east) -| (2,1.5) -| (b.north);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);
    expect(result.scene.elements.some((element) => element.kind === "Text")).toBe(true);
    expect(result.scene.elements.some((element) => element.kind === "Path" && element.style.stroke === "#ff0000")).toBe(true);
  });

  it("applies scope/statement precedence and fill command defaults", () => {
    const source = String.raw`\begin{tikzpicture}[blue,line width=1pt]
  \begin{scope}[red,line width=2pt]
    \draw[green,line width=3pt] (0,0) -- (1,0);
  \end{scope}
  \draw (0,1) -- (1,1);
  \fill (0,2) -- (1,2) -- (1,3) -- cycle;
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    expect(paths.length).toBeGreaterThanOrEqual(3);

    const drawInScope = paths[0];
    expect(drawInScope?.kind).toBe("Path");
    if (drawInScope?.kind === "Path") {
      expect(drawInScope.style.stroke).toBe("#00ff00");
      expect(drawInScope.style.lineWidth).toBeCloseTo(3);
    }

    const drawOutsideScope = paths[1];
    expect(drawOutsideScope?.kind).toBe("Path");
    if (drawOutsideScope?.kind === "Path") {
      expect(drawOutsideScope.style.stroke).toBe("#0000ff");
      expect(drawOutsideScope.style.lineWidth).toBeCloseTo(1);
    }

    const fillPath = paths[2];
    expect(fillPath?.kind).toBe("Path");
    if (fillPath?.kind === "Path") {
      expect(fillPath.style.fill).toBe("black");
      expect(fillPath.style.stroke).toBeNull();
    }
  });

  it("supports cubic Bezier curves with controls/and", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,1) and (2,1) .. (3,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-path-operator")).toBe(false);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.commands.some((command) => command.kind === "C")).toBe(true);
    }
  });

  it("falls back with diagnostics for unsupported curve pattern variants", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. (2,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-path-operator")).toBe(true);
  });

  it("keeps connector segments when circles are interleaved in a draw path", () => {
    const source = String.raw`\begin{tikzpicture}[radius=2pt]
  \draw (0,0) circle -- (1,1) circle -- ++(0,1) circle;
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    const circles = result.scene.elements.filter((element) => element.kind === "Circle");
    expect(circles.length).toBe(3);
    expect(paths.length).toBe(2);

    const lineCounts = paths.map((path) => (path.kind === "Path" ? path.commands.filter((command) => command.kind === "L").length : 0));
    expect(lineCounts).toEqual([1, 1]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("supports node name scope prefixes/suffixes and aliases in coordinate lookups", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[name prefix=pre-,name suffix=-suf]
    \node[name=a,alias=b,node contents=A] at (0,0);
    \draw (a) -- (b.east);
  \end{scope}
  \draw (pre-a-suf) -- +(1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);
  });

  it("orders behind-path nodes before path geometry and front nodes after", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node[behind path,draw] {B} -- (1,0) node[draw] {F};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const mainPathIndex = result.scene.elements.findIndex(
      (element) => element.kind === "Path" && element.id.startsWith("scene-path:")
    );
    const behindNodeIndex = result.scene.elements.findIndex((element) => element.kind === "Text" && element.text === "B");
    const frontNodeIndex = result.scene.elements.findIndex((element) => element.kind === "Text" && element.text === "F");

    expect(mainPathIndex).toBeGreaterThanOrEqual(0);
    expect(behindNodeIndex).toBeLessThan(mainPathIndex);
    expect(frontNodeIndex).toBeGreaterThan(mainPathIndex);
  });

  it("supports circle-shaped nodes with anchor placement and named anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node[circle,draw,minimum size=1cm,anchor=west,name=n] {A};
  \draw (n.east) -- +(1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);
    expect(result.scene.elements.some((element) => element.kind === "Circle")).toBe(true);

    const text = result.scene.elements.find((element) => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.position.x).toBeGreaterThan(0);
    }
  });

  it("supports pos and midway placement on line and orthogonal segments", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[midway,name=m] {M};
  \draw (0,0) -| (2,2) node[pos=0.5,name=c] {C};
  \draw (m) -- (c);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const mText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "M");
    const cText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
    expect(mText?.kind).toBe("Text");
    expect(cText?.kind).toBe("Text");
    if (mText?.kind === "Text") {
      expect(mText.position.x).toBeCloseTo(28.4527, 3);
      expect(mText.position.y).toBeCloseTo(0, 3);
    }
    if (cText?.kind === "Text") {
      expect(cText.position.x).toBeCloseTo(56.9055, 3);
      expect(cText.position.y).toBeCloseTo(0, 3);
    }
  });

  it("does not let statement fill options implicitly paint node boxes", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill [fill=yellow!80!black]
       (0,0) node              {first node}
    -- (1,1) node[behind path] {second node}
    -- (2,0) node              {third node};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const nodeBoxes = result.scene.elements.filter((element) => element.kind === "Path" && element.id.startsWith("scene-node-box:"));
    expect(nodeBoxes).toHaveLength(0);
  });

  it("suppresses inherited stroke on fill-only nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill [fill=blue!50, draw=blue, very thick]
       (0,0)   node [behind path, fill=red!50]   {first node}
    -- (1.5,0) node [behind path, fill=green!50] {second node}
    -- (1.5,1) node [behind path, fill=brown!50] {third node}
    -- (0,1)   node [             fill=blue!30]  {fourth node};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const nodeBoxes = result.scene.elements.filter(
      (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
        element.kind === "Path" && element.id.startsWith("scene-node-box:")
    );
    expect(nodeBoxes.length).toBe(4);
    expect(nodeBoxes.every((nodeBox) => nodeBox.style.stroke == null)).toBe(true);
  });

  it("applies rounded corners options to rectangle node boxes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node[draw,rounded corners=4pt] {rounded};
  \draw (2,0) node[draw,sharp corners]       {sharp};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const nodeBoxes = result.scene.elements.filter(
      (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
        element.kind === "Path" && element.id.startsWith("scene-node-box:")
    );
    expect(nodeBoxes).toHaveLength(2);

    const rounded = nodeBoxes.find((nodeBox) => nodeBox.commands.some((command) => command.kind === "C"));
    const sharp = nodeBoxes.find((nodeBox) => nodeBox.commands.every((command) => command.kind !== "C"));
    expect(rounded).toBeDefined();
    expect(sharp).toBeDefined();
    expect(rounded?.commands.filter((command) => command.kind === "C").length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("applies node-local scale options to text and box metrics", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[line width=5pt]
    (0,0)  node[draw]         (d) {drawn}
    (1,-1) node[draw,scale=2] (s) {scaled};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const drawn = result.scene.elements.find((element) => element.kind === "Text" && element.text === "drawn");
    const scaled = result.scene.elements.find((element) => element.kind === "Text" && element.text === "scaled");
    expect(drawn?.kind).toBe("Text");
    expect(scaled?.kind).toBe("Text");
    if (drawn?.kind === "Text" && scaled?.kind === "Text") {
      expect(scaled.style.fontSize).toBeGreaterThan(drawn.style.fontSize * 1.9);
    }
  });

  it("supports ellipse-shaped nodes in path syntax", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill[fill=yellow!80!black]
        (0,0) node                            {first node}
     -- (1,1) node[ellipse,draw,behind path] {second node};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const ellipse = result.scene.elements.find((element) => element.kind === "Ellipse" && element.id.startsWith("scene-node-ellipse:"));
    expect(ellipse?.kind).toBe("Ellipse");
    if (ellipse?.kind === "Ellipse") {
      expect(ellipse.style.stroke).not.toBeNull();
      expect(ellipse.style.fill).toBeNull();
    }
  });

  it("supports diamond-shaped nodes with aspect control and named anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[diamond,draw,aspect=2,name=d] at (0,0) {D};
  \draw (d.east) -- +(8pt,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const text = result.scene.elements.find((element) => element.kind === "Text" && element.text === "D");
    const diamond = result.scene.elements.find((element) => element.kind === "Path" && element.id.startsWith("scene-node-box:"));
    expect(text?.kind).toBe("Text");
    expect(diamond?.kind).toBe("Path");

    if (diamond?.kind === "Path") {
      const points = diamond.commands
        .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to] : []));
      expect(points).toHaveLength(4);
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);
      expect(width).toBeGreaterThan(height);
    }
  });

  it("supports trapezium-shaped nodes with angle keys and side anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[trapezium,draw,trapezium left angle=75,trapezium right angle=45,name=t] at (0,0) {T};
  \draw (t.top side) -- +(0,8pt);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const trapezium = result.scene.elements.find((element) => element.kind === "Path" && element.id.startsWith("scene-node-box:"));
    expect(trapezium?.kind).toBe("Path");
    if (trapezium?.kind === "Path") {
      const points = trapezium.commands
        .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to] : []));
      expect(points).toHaveLength(4);
      const [bottomLeft, topLeft, topRight, bottomRight] = points;
      const topWidth = topRight.x - topLeft.x;
      const bottomWidth = bottomRight.x - bottomLeft.x;
      expect(bottomWidth).toBeGreaterThan(topWidth);
    }
  });

  it("applies trapezium stretch keys to minimum-size geometry", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[trapezium,draw,trapezium left angle=75,trapezium right angle=45,minimum width=3cm] at (0,0)  {A};
  \node[trapezium,draw,trapezium left angle=75,trapezium right angle=45,minimum width=3cm,trapezium stretches] at (4,0) {B};
  \node[trapezium,draw,trapezium left angle=75,trapezium right angle=45,minimum width=3cm,trapezium stretches body] at (8,0) {C};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const trapezia = result.scene.elements
      .filter(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.startsWith("scene-node-box:")
      )
      .map((path) => {
        const points = path.commands
          .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to] : []));
        const [bottomLeft, topLeft, topRight, bottomRight] = points;
        return {
          centerX: points.reduce((sum, point) => sum + point.x, 0) / Math.max(points.length, 1),
          topWidth: topRight && topLeft ? topRight.x - topLeft.x : 0,
          bottomWidth: bottomRight && bottomLeft ? bottomRight.x - bottomLeft.x : 0,
          height:
            points.length > 0
              ? Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y))
              : 0
        };
      })
      .sort((left, right) => left.centerX - right.centerX);

    expect(trapezia).toHaveLength(3);
    const [defaultShape, stretchesShape, stretchesBodyShape] = trapezia;
    const defaultDiff = defaultShape.bottomWidth - defaultShape.topWidth;
    const stretchesDiff = stretchesShape.bottomWidth - stretchesShape.topWidth;
    const stretchesBodyDiff = stretchesBodyShape.bottomWidth - stretchesBodyShape.topWidth;

    expect(defaultShape.height).toBeGreaterThan(stretchesShape.height);
    expect(stretchesDiff).toBeGreaterThan(stretchesBodyDiff);
    expect(defaultDiff).toBeCloseTo(stretchesDiff, 3);
  });

  it("rotates trapezium top-side anchor and keeps base-east distinct from east", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[trapezium,draw,name=a] at (0,0) {CenterA};
  \node[trapezium,draw,name=b,shape border rotate=90] at (4,0) {CenterB};
  \node at (a.top side) {TopA};
  \node at (b.top side) {TopB};
  \node at (b.east) {EastB};
  \node at (b.base east) {BaseEastB};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const centerA = result.scene.elements.find((element) => element.kind === "Text" && element.text === "CenterA");
    const centerB = result.scene.elements.find((element) => element.kind === "Text" && element.text === "CenterB");
    const topA = result.scene.elements.find((element) => element.kind === "Text" && element.text === "TopA");
    const topB = result.scene.elements.find((element) => element.kind === "Text" && element.text === "TopB");
    const eastB = result.scene.elements.find((element) => element.kind === "Text" && element.text === "EastB");
    const baseEastB = result.scene.elements.find((element) => element.kind === "Text" && element.text === "BaseEastB");

    expect(centerA?.kind).toBe("Text");
    expect(centerB?.kind).toBe("Text");
    expect(topA?.kind).toBe("Text");
    expect(topB?.kind).toBe("Text");
    expect(eastB?.kind).toBe("Text");
    expect(baseEastB?.kind).toBe("Text");

    if (
      centerA?.kind === "Text" &&
      centerB?.kind === "Text" &&
      topA?.kind === "Text" &&
      topB?.kind === "Text" &&
      eastB?.kind === "Text" &&
      baseEastB?.kind === "Text"
    ) {
      const topADx = Math.abs(topA.position.x - centerA.position.x);
      const topADy = Math.abs(topA.position.y - centerA.position.y);
      const topBDx = Math.abs(topB.position.x - centerB.position.x);
      const topBDy = Math.abs(topB.position.y - centerB.position.y);

      expect(topADy).toBeGreaterThan(topADx);
      expect(topBDx).toBeGreaterThan(topBDy);
      expect(Math.abs(baseEastB.position.y - eastB.position.y)).toBeGreaterThan(0.5);
    }
  });

  it("supports semicircle shape with special anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[semicircle,draw,name=s] at (0,0) {S};
  \node at (s.apex) {A};
  \node at (s.arc start) {B};
  \node at (s.arc end) {C};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "S");
    const apex = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
    const arcStart = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
    const arcEnd = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");

    expect(center?.kind).toBe("Text");
    expect(apex?.kind).toBe("Text");
    expect(arcStart?.kind).toBe("Text");
    expect(arcEnd?.kind).toBe("Text");
    if (center?.kind === "Text" && apex?.kind === "Text" && arcStart?.kind === "Text" && arcEnd?.kind === "Text") {
      expect(apex.position.y).toBeGreaterThan(center.position.y);
      expect(arcStart.position.x).toBeGreaterThan(center.position.x);
      expect(arcEnd.position.x).toBeLessThan(center.position.x);
    }
  });

  it("supports regular polygon shape with side/corner anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[regular polygon,regular polygon sides=6,shape border rotate=30,draw,name=p] at (0,0) {P};
  \node at (p.corner 1) {C1};
  \node at (p.side 1)   {S1};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "P");
    const corner = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C1");
    const side = result.scene.elements.find((element) => element.kind === "Text" && element.text === "S1");
    expect(center?.kind).toBe("Text");
    expect(corner?.kind).toBe("Text");
    expect(side?.kind).toBe("Text");
    if (center?.kind === "Text" && corner?.kind === "Text" && side?.kind === "Text") {
      const cornerDistance = Math.hypot(corner.position.x - center.position.x, corner.position.y - center.position.y);
      const sideDistance = Math.hypot(side.position.x - center.position.x, side.position.y - center.position.y);
      expect(cornerDistance).toBeGreaterThan(sideDistance);
    }
  });

  it("supports star shape with point anchors and height/ratio options", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[star,star points=5,star point ratio=1.7,draw,name=a] at (0,0) {A};
  \node[star,star points=5,star point height=.5cm,draw,name=b] at (4,0) {B};
  \node at (a.outer point 1) {O};
  \node at (a.inner point 1) {I};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
    const outer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "O");
    const inner = result.scene.elements.find((element) => element.kind === "Text" && element.text === "I");
    expect(center?.kind).toBe("Text");
    expect(outer?.kind).toBe("Text");
    expect(inner?.kind).toBe("Text");
    if (center?.kind === "Text" && outer?.kind === "Text" && inner?.kind === "Text") {
      const outerDistance = Math.hypot(outer.position.x - center.position.x, outer.position.y - center.position.y);
      const innerDistance = Math.hypot(inner.position.x - center.position.x, inner.position.y - center.position.y);
      expect(outerDistance).toBeGreaterThan(innerDistance);
    }
  });

  it("supports isosceles triangle shape with corner and side anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[isosceles triangle,draw,name=t] at (0,0) {T};
  \node at (t.apex)        {A};
  \node at (t.left corner) {L};
  \node at (t.lower side)  {B};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "T");
    const apex = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
    const leftCorner = result.scene.elements.find((element) => element.kind === "Text" && element.text === "L");
    const lowerSide = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
    expect(center?.kind).toBe("Text");
    expect(apex?.kind).toBe("Text");
    expect(leftCorner?.kind).toBe("Text");
    expect(lowerSide?.kind).toBe("Text");
    if (center?.kind === "Text" && apex?.kind === "Text" && leftCorner?.kind === "Text" && lowerSide?.kind === "Text") {
      expect(apex.position.y).toBeGreaterThan(center.position.y);
      expect(leftCorner.position.x).toBeLessThan(center.position.x);
      expect(lowerSide.position.y).toBeLessThan(center.position.y);
    }
  });

  it("supports kite shape with vertex and side anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[kite,draw,kite vertex angles=90 and 45,name=k] at (0,0) {K};
  \node at (k.upper vertex)     {U};
  \node at (k.lower right side) {R};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "K");
    const upper = result.scene.elements.find((element) => element.kind === "Text" && element.text === "U");
    const rightSide = result.scene.elements.find((element) => element.kind === "Text" && element.text === "R");
    expect(center?.kind).toBe("Text");
    expect(upper?.kind).toBe("Text");
    expect(rightSide?.kind).toBe("Text");
    if (center?.kind === "Text" && upper?.kind === "Text" && rightSide?.kind === "Text") {
      expect(upper.position.y).toBeGreaterThan(center.position.y);
      expect(rightSide.position.x).toBeGreaterThan(center.position.x);
    }
  });

  it("supports dart shape with tip and tail anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[dart,draw,dart tip angle=45,dart tail angle=135,name=d] at (0,0) {D};
  \node at (d.tip)         {T};
  \node at (d.tail center) {C};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "D");
    const tip = result.scene.elements.find((element) => element.kind === "Text" && element.text === "T");
    const tailCenter = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
    expect(center?.kind).toBe("Text");
    expect(tip?.kind).toBe("Text");
    expect(tailCenter?.kind).toBe("Text");
    if (center?.kind === "Text" && tip?.kind === "Text" && tailCenter?.kind === "Text") {
      expect(tip.position.x).toBeGreaterThan(center.position.x);
      expect(tailCenter.position.x).toBeLessThan(center.position.x);
    }
  });

  it("supports circular sector shape with arc anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[circular sector,draw,circular sector angle=80,name=c] at (0,0) {C};
  \node at (c.sector center) {S};
  \node at (c.arc center)    {A};
  \node at (c.arc start)     {B};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
    const sectorCenter = result.scene.elements.find((element) => element.kind === "Text" && element.text === "S");
    const arcCenter = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
    const arcStart = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
    expect(center?.kind).toBe("Text");
    expect(sectorCenter?.kind).toBe("Text");
    expect(arcCenter?.kind).toBe("Text");
    expect(arcStart?.kind).toBe("Text");
    if (
      center?.kind === "Text" &&
      sectorCenter?.kind === "Text" &&
      arcCenter?.kind === "Text" &&
      arcStart?.kind === "Text"
    ) {
      expect(sectorCenter.position.x).toBeGreaterThan(center.position.x);
      expect(arcCenter.position.x).toBeLessThan(center.position.x);
      expect(arcStart.position.y).toBeGreaterThan(center.position.y - 1);
    }
  });

  it("supports cylinder shape with top, bottom, and shape-center anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[cylinder,draw,aspect=.5,name=y] at (0,0) {Y};
  \node at (y.top)          {T};
  \node at (y.bottom)       {B};
  \node at (y.shape center) {S};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "Y");
    const top = result.scene.elements.find((element) => element.kind === "Text" && element.text === "T");
    const bottom = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
    const shapeCenter = result.scene.elements.find((element) => element.kind === "Text" && element.text === "S");
    expect(center?.kind).toBe("Text");
    expect(top?.kind).toBe("Text");
    expect(bottom?.kind).toBe("Text");
    expect(shapeCenter?.kind).toBe("Text");
    if (center?.kind === "Text" && top?.kind === "Text" && bottom?.kind === "Text" && shapeCenter?.kind === "Text") {
      expect(top.position.x).toBeGreaterThan(center.position.x);
      expect(bottom.position.x).toBeLessThan(center.position.x);
      expect(shapeCenter.position.x).toBeGreaterThan(center.position.x);
    }
  });

  it("supports cloud shape with puff anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[cloud,cloud puffs=9,cloud puff arc=140,draw,name=c] at (0,0) {C};
  \node at (c.puff 1) {P1};
  \node at (c.puff 4) {P4};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
    const puff1 = result.scene.elements.find((element) => element.kind === "Text" && element.text === "P1");
    const puff4 = result.scene.elements.find((element) => element.kind === "Text" && element.text === "P4");
    expect(center?.kind).toBe("Text");
    expect(puff1?.kind).toBe("Text");
    expect(puff4?.kind).toBe("Text");
    if (center?.kind === "Text" && puff1?.kind === "Text" && puff4?.kind === "Text") {
      const d1 = Math.hypot(puff1.position.x - center.position.x, puff1.position.y - center.position.y);
      const d4 = Math.hypot(puff4.position.x - center.position.x, puff4.position.y - center.position.y);
      expect(d1).toBeGreaterThan(5);
      expect(d4).toBeGreaterThan(5);
      expect(Math.abs(puff1.position.x - puff4.position.x) + Math.abs(puff1.position.y - puff4.position.y)).toBeGreaterThan(1);
    }
  });

  it("supports starburst shape with outer and inner point anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[starburst,starburst points=11,starburst point height=5pt,random starburst=0,draw,name=s] at (0,0) {S};
  \node at (s.outer point 1) {O};
  \node at (s.inner point 1) {I};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "S");
    const outer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "O");
    const inner = result.scene.elements.find((element) => element.kind === "Text" && element.text === "I");
    expect(center?.kind).toBe("Text");
    expect(outer?.kind).toBe("Text");
    expect(inner?.kind).toBe("Text");
    if (center?.kind === "Text" && outer?.kind === "Text" && inner?.kind === "Text") {
      const outerDistance = Math.hypot(outer.position.x - center.position.x, outer.position.y - center.position.y);
      const innerDistance = Math.hypot(inner.position.x - center.position.x, inner.position.y - center.position.y);
      expect(outerDistance).toBeGreaterThan(innerDistance);
    }
  });

  it("supports signal and tape symbol shapes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[signal,signal to=east and west,signal from=north and south,signal pointer angle=60,draw,name=g] at (0,0) {G};
  \node at (g.east) {E};
  \node at (g.west) {W};
  \node[tape,tape bend top=out and in,tape bend bottom=none,tape bend height=8pt,draw,name=t] at (4,0) {T};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const g = result.scene.elements.find((element) => element.kind === "Text" && element.text === "G");
    const east = result.scene.elements.find((element) => element.kind === "Text" && element.text === "E");
    const west = result.scene.elements.find((element) => element.kind === "Text" && element.text === "W");
    expect(g?.kind).toBe("Text");
    expect(east?.kind).toBe("Text");
    expect(west?.kind).toBe("Text");
    if (g?.kind === "Text" && east?.kind === "Text" && west?.kind === "Text") {
      expect(east.position.x).toBeGreaterThan(g.position.x);
      expect(west.position.x).toBeLessThan(g.position.x);
    }

    const tapePath = result.scene.elements.find(
      (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
        element.kind === "Path" && element.id.startsWith("scene-node-box:") && element.commands.length > 30
    );
    expect(tapePath).toBeDefined();
  });

  it("supports single and double arrow shapes with named arrow anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[single arrow,single arrow tip angle=60,single arrow head extend=5pt,draw,name=s] at (0,0) {S};
  \node at (s.tip)         {ST};
  \node at (s.before head) {SB};
  \node at (s.tail)        {SL};

  \node[double arrow,double arrow tip angle=70,double arrow head indent=2pt,draw,name=d] at (4,0) {D};
  \node at (d.tip 1)         {D1};
  \node at (d.tip 2)         {D2};
  \node at (d.before head 1) {DH1};
  \node at (d.before head 2) {DH2};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const single = result.scene.elements.find((element) => element.kind === "Text" && element.text === "S");
    const singleTip = result.scene.elements.find((element) => element.kind === "Text" && element.text === "ST");
    const singleBeforeHead = result.scene.elements.find((element) => element.kind === "Text" && element.text === "SB");
    const singleTail = result.scene.elements.find((element) => element.kind === "Text" && element.text === "SL");
    expect(single?.kind).toBe("Text");
    expect(singleTip?.kind).toBe("Text");
    expect(singleBeforeHead?.kind).toBe("Text");
    expect(singleTail?.kind).toBe("Text");
    if (
      single?.kind === "Text" &&
      singleTip?.kind === "Text" &&
      singleBeforeHead?.kind === "Text" &&
      singleTail?.kind === "Text"
    ) {
      expect(singleTip.position.x).toBeGreaterThan(single.position.x);
      expect(singleBeforeHead.position.x).toBeGreaterThan(single.position.x);
      expect(singleTail.position.x).toBeLessThan(single.position.x);
    }

    const double = result.scene.elements.find((element) => element.kind === "Text" && element.text === "D");
    const doubleTip1 = result.scene.elements.find((element) => element.kind === "Text" && element.text === "D1");
    const doubleTip2 = result.scene.elements.find((element) => element.kind === "Text" && element.text === "D2");
    const doubleBeforeHead1 = result.scene.elements.find((element) => element.kind === "Text" && element.text === "DH1");
    const doubleBeforeHead2 = result.scene.elements.find((element) => element.kind === "Text" && element.text === "DH2");
    expect(double?.kind).toBe("Text");
    expect(doubleTip1?.kind).toBe("Text");
    expect(doubleTip2?.kind).toBe("Text");
    expect(doubleBeforeHead1?.kind).toBe("Text");
    expect(doubleBeforeHead2?.kind).toBe("Text");
    if (
      double?.kind === "Text" &&
      doubleTip1?.kind === "Text" &&
      doubleTip2?.kind === "Text" &&
      doubleBeforeHead1?.kind === "Text" &&
      doubleBeforeHead2?.kind === "Text"
    ) {
      expect(doubleTip1.position.x).toBeGreaterThan(double.position.x);
      expect(doubleTip2.position.x).toBeLessThan(double.position.x);
      expect(doubleBeforeHead1.position.x).toBeGreaterThan(double.position.x);
      expect(doubleBeforeHead2.position.x).toBeLessThan(double.position.x);
    }
  });

  it("supports rectangle, ellipse, and cloud callout shapes with pointer anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[rectangle callout,callout relative pointer={(5mm,-4mm)},draw,name=r] at (0,0) {R};
  \node at (r.pointer) {RP};
  \node at (r.east) {RE};

  \node[ellipse callout,callout relative pointer={(315:6mm)},callout pointer arc=25,draw,name=e] at (3,0) {E};
  \node at (e.pointer) {EP};
  \node at (e.south) {ES};

  \node[cloud callout,cloud puffs=9,callout relative pointer={(300:7mm)},callout pointer segments=3,draw,name=c] at (6,0) {C};
  \node at (c.pointer) {CP};
  \node at (c.puff 1) {P1};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const rectangle = result.scene.elements.find((element) => element.kind === "Text" && element.text === "R");
    const rectanglePointer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "RP");
    const rectangleEast = result.scene.elements.find((element) => element.kind === "Text" && element.text === "RE");
    expect(rectangle?.kind).toBe("Text");
    expect(rectanglePointer?.kind).toBe("Text");
    expect(rectangleEast?.kind).toBe("Text");
    if (rectangle?.kind === "Text" && rectanglePointer?.kind === "Text" && rectangleEast?.kind === "Text") {
      const pointerDistance = Math.hypot(
        rectanglePointer.position.x - rectangle.position.x,
        rectanglePointer.position.y - rectangle.position.y
      );
      const eastDistance = Math.hypot(rectangleEast.position.x - rectangle.position.x, rectangleEast.position.y - rectangle.position.y);
      expect(pointerDistance).toBeGreaterThan(eastDistance);
      expect(rectanglePointer.position.y).toBeLessThan(rectangle.position.y);
    }

    const ellipse = result.scene.elements.find((element) => element.kind === "Text" && element.text === "E");
    const ellipsePointer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "EP");
    const ellipseSouth = result.scene.elements.find((element) => element.kind === "Text" && element.text === "ES");
    expect(ellipse?.kind).toBe("Text");
    expect(ellipsePointer?.kind).toBe("Text");
    expect(ellipseSouth?.kind).toBe("Text");
    if (ellipse?.kind === "Text" && ellipsePointer?.kind === "Text" && ellipseSouth?.kind === "Text") {
      const pointerDistance = Math.hypot(ellipsePointer.position.x - ellipse.position.x, ellipsePointer.position.y - ellipse.position.y);
      const southDistance = Math.hypot(ellipseSouth.position.x - ellipse.position.x, ellipseSouth.position.y - ellipse.position.y);
      expect(pointerDistance).toBeGreaterThan(southDistance);
      expect(ellipsePointer.position.y).toBeLessThan(ellipse.position.y);
    }

    const cloud = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
    const cloudPointer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "CP");
    const cloudPuff = result.scene.elements.find((element) => element.kind === "Text" && element.text === "P1");
    expect(cloud?.kind).toBe("Text");
    expect(cloudPointer?.kind).toBe("Text");
    expect(cloudPuff?.kind).toBe("Text");
    if (cloud?.kind === "Text" && cloudPointer?.kind === "Text" && cloudPuff?.kind === "Text") {
      expect(cloudPointer.position.y).toBeLessThan(cloud.position.y);
      const puffDistance = Math.hypot(cloudPuff.position.x - cloud.position.x, cloudPuff.position.y - cloud.position.y);
      expect(puffDistance).toBeGreaterThan(5);
    }
  });

  it("supports absolute callout pointers and pointer shortening", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[rectangle callout,callout absolute pointer={(3,0)},draw,name=a] at (0,0) {A};
  \node[rectangle callout,callout absolute pointer={(3,0)},callout pointer shorten=10pt,draw,name=b] at (0,-2) {B};
  \node at (a.pointer) {AP};
  \node at (b.pointer) {BP};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unknown-named-coordinate:"))).toBe(false);

    const absolutePointer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "AP");
    const shortenedPointer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "BP");
    expect(absolutePointer?.kind).toBe("Text");
    expect(shortenedPointer?.kind).toBe("Text");
    if (absolutePointer?.kind === "Text" && shortenedPointer?.kind === "Text") {
      expect(absolutePointer.position.x).toBeCloseTo(85.3583, 1);
      expect(absolutePointer.position.y).toBeCloseTo(0, 1);
      expect(shortenedPointer.position.x).toBeLessThan(absolutePointer.position.x);
      expect(shortenedPointer.position.y).toBeLessThan(absolutePointer.position.y);
    }
  });

  it("recovers trailing coordinates after node-contents nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) node [red]                    {A}
        (1,0) node [blue]                   {B}
        (2,0) node [green, node contents=C]
        (3,0) node [node contents=D]           ;
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const c = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
    const d = result.scene.elements.find((element) => element.kind === "Text" && element.text === "D");
    expect(c?.kind).toBe("Text");
    expect(d?.kind).toBe("Text");
    if (c?.kind === "Text" && d?.kind === "Text") {
      expect(d.position.x).toBeGreaterThan(c.position.x + 20);
      expect(d.position.y).toBeCloseTo(c.position.y, 3);
    }
  });

  it("targets unnamed node coordinates at the node border for line and to operations", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (a) at (2,2) {a};
  \draw[red] (10pt,10pt) to (a);
  \draw[blue] (3,2) -- (a);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const text = result.scene.elements.find((element) => element.kind === "Text" && element.text === "a");
    expect(text?.kind).toBe("Text");

    const redPath = result.scene.elements.find(
      (element) => element.kind === "Path" && (element.style.stroke === "red" || element.style.stroke === "#ff0000")
    );
    const bluePath = result.scene.elements.find(
      (element) => element.kind === "Path" && (element.style.stroke === "blue" || element.style.stroke === "#0000ff")
    );
    expect(redPath?.kind).toBe("Path");
    expect(bluePath?.kind).toBe("Path");

    if (text?.kind === "Text" && redPath?.kind === "Path" && bluePath?.kind === "Path") {
      const redEnd = redPath.commands[redPath.commands.length - 1];
      expect(redEnd?.kind).toBe("L");
      if (redEnd?.kind === "L") {
        expect(redEnd.to.x).toBeLessThan(text.position.x);
        expect(redEnd.to.y).toBeLessThan(text.position.y);
      }

      const blueEnd = bluePath.commands[bluePath.commands.length - 1];
      expect(blueEnd?.kind).toBe("L");
      if (blueEnd?.kind === "L") {
        expect(blueEnd.to.x).toBeGreaterThan(text.position.x);
        expect(blueEnd.to.x).toBeLessThan(85.3583);
      }
    }
  });

  it("restarts named-node line segments without inheriting prior border directions", () => {
    const source = String.raw`\begin{tikzpicture}[scale=0.9, transform shape]
  \node[draw, circle](1) at (0,0) {1};
  \node[draw, circle](2) at (1,0) {2};
  \node[draw, circle](3) at (2,1) {3};
  \node[draw, circle](4) at (2,0) {4};
  \node[draw, circle](5) at (2,-1) {5};
  \node[draw, circle](6) at (3,0) {6};
  \node[draw, circle](7) at (4,0) {7};
  \draw[-, >=latex,thick] (1)--(2) (2)--(3) (2)--(4) (2)--(5) (3)--(6) (4)--(6) (5)--(6) (6)--(7);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");

    if (path?.kind === "Path") {
      expect(path.commands.map((command) => command.kind)).toEqual([
        "M",
        "L",
        "M",
        "L",
        "M",
        "L",
        "M",
        "L",
        "M",
        "L",
        "M",
        "L",
        "M",
        "L",
        "M",
        "L"
      ]);

      const lastMove = path.commands[path.commands.length - 2];
      const previousLine = path.commands[path.commands.length - 3];
      const lastLine = path.commands[path.commands.length - 1];
      expect(lastMove?.kind).toBe("M");
      expect(previousLine?.kind).toBe("L");
      expect(lastLine?.kind).toBe("L");
      if (lastMove?.kind === "M" && previousLine?.kind === "L" && lastLine?.kind === "L") {
        expect(lastMove.to.y).toBeCloseTo(0, 3);
        expect(lastLine.to.y).toBeCloseTo(0, 3);
        expect(Math.abs(lastMove.to.y - previousLine.to.y)).toBeGreaterThan(1);
        expect(lastLine.to.x).toBeGreaterThan(lastMove.to.x);
      }
    }
  });

  it("supports basic placement offsets like above=... and right=...", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,name=a,node contents=A] at (0,0);
  \node[draw,above=4pt,right=2pt,name=b,node contents=B] at (0,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
    const bText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
    expect(aText?.kind).toBe("Text");
    expect(bText?.kind).toBe("Text");
    if (aText?.kind === "Text" && bText?.kind === "Text") {
      expect(bText.position.x).toBeGreaterThan(aText.position.x);
      expect(bText.position.y).toBeGreaterThan(aText.position.y);
    }
  });

  it("supports positioning library relative placement like right=of and above left=of", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,name=a,node contents=A] at (0,0);
  \node[draw,right=of a,name=b,node contents=B];
  \node[draw,above left=of a,name=c,node contents=C];
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:a")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("invalid-positioning"))).toBe(false);

    const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
    const bText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
    const cText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
    expect(aText?.kind).toBe("Text");
    expect(bText?.kind).toBe("Text");
    expect(cText?.kind).toBe("Text");
    if (aText?.kind === "Text" && bText?.kind === "Text" && cText?.kind === "Text") {
      expect(bText.position.x).toBeGreaterThan(aText.position.x + 10);
      expect(cText.position.x).toBeLessThan(aText.position.x - 10);
      expect(cText.position.y).toBeGreaterThan(aText.position.y + 10);
    }
  });

  it("supports positioning shift expressions like 2pt+3pt and .2 and 3mm", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,name=a,node contents=A] at (0,0);
  \node[draw,above=2pt+3pt,name=b,node contents=B] at (0,0);
  \node[draw,above=.2 and 3mm,name=c,node contents=C] at (0,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("invalid-positioning-shift"))).toBe(false);

    const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
    const bText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
    const cText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
    expect(aText?.kind).toBe("Text");
    expect(bText?.kind).toBe("Text");
    expect(cText?.kind).toBe("Text");
    if (aText?.kind === "Text" && bText?.kind === "Text" && cText?.kind === "Text") {
      expect(bText.position.y).toBeGreaterThan(aText.position.y + 4.5);
      expect(cText.position.y).toBeGreaterThan(bText.position.y + 0.5);
    }
  });

  it("resolves standalone node names for above=of chains", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style=draw]
  \node (a1) at (0,0) {A};
  \node (b1) [above=1cm of a1] {B};
  \node (c1) [above=1cm of b1] {C};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:a1")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:b1")).toBe(false);

    const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
    const bText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
    const cText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
    expect(aText?.kind).toBe("Text");
    expect(bText?.kind).toBe("Text");
    expect(cText?.kind).toBe("Text");
    if (aText?.kind === "Text" && bText?.kind === "Text" && cText?.kind === "Text") {
      expect(bText.position.y).toBeGreaterThan(aText.position.y + 10);
      expect(cText.position.y).toBeGreaterThan(bText.position.y + 10);
    }
  });

  it("treats unitless node distance as coordinate units under on-grid placement", () => {
    const source = String.raw`\begin{tikzpicture}[on grid,node distance=1]
  \node[draw,name=a,node contents=A] at (0,0);
  \node[draw,right=of a,name=b,node contents=B];
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
    const bText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
    expect(aText?.kind).toBe("Text");
    expect(bText?.kind).toBe("Text");
    if (aText?.kind === "Text" && bText?.kind === "Text") {
      expect(bText.position.x).toBeCloseTo(aText.position.x + 28.4528, 3);
      expect(bText.position.y).toBeCloseTo(aText.position.y, 3);
    }
  });

  it("supports deprecated placement keys like left of=... and below right of=...", () => {
    const source = String.raw`\begin{tikzpicture}[node distance=10pt]
  \node[draw,name=a,node contents=A] at (0,0);
  \node[draw,left of=a,name=l,node contents=L];
  \node[draw,below right of=a,name=r,node contents=R];
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
    const lText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "L");
    const rText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "R");
    expect(aText?.kind).toBe("Text");
    expect(lText?.kind).toBe("Text");
    expect(rText?.kind).toBe("Text");
    if (aText?.kind === "Text" && lText?.kind === "Text" && rText?.kind === "Text") {
      expect(lText.position.x).toBeCloseTo(aText.position.x - 10, 3);
      expect(rText.position.x).toBeCloseTo(aText.position.x + 10 / Math.sqrt(2), 3);
      expect(rText.position.y).toBeCloseTo(aText.position.y - 10 / Math.sqrt(2), 3);
    }
  });

  it("supports on-grid center-to-center relative placement", () => {
    const source = String.raw`\begin{tikzpicture}[on grid,node distance=12pt]
  \node[draw,name=a,node contents=A] at (0,0);
  \node[draw,above=of a,name=b,node contents=B];
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:on grid")).toBe(false);

    const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
    const bText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
    expect(aText?.kind).toBe("Text");
    expect(bText?.kind).toBe("Text");
    if (aText?.kind === "Text" && bText?.kind === "Text") {
      expect(bText.position.x).toBeCloseTo(aText.position.x, 3);
      expect(bText.position.y).toBeCloseTo(aText.position.y + 12, 3);
    }
  });

  it("applies standalone font-size commands like \\huge before subsequent nodes", () => {
    const source = String.raw`\begin{tikzpicture}[node distance=1ex]
  \huge
  \node (X) at (0,1) {X};
  \node (a) [right=of X] {a};
  \node (y) [base right=of a] {y};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-statement")).toBe(false);
    const texts = result.scene.elements.filter((element) => element.kind === "Text");
    expect(texts.length).toBe(3);

    const xText = texts.find((element) => element.kind === "Text" && element.text === "X");
    const aText = texts.find((element) => element.kind === "Text" && element.text === "a");
    const yText = texts.find((element) => element.kind === "Text" && element.text === "y");
    expect(xText?.kind).toBe("Text");
    expect(aText?.kind).toBe("Text");
    expect(yText?.kind).toBe("Text");
    if (xText?.kind === "Text" && aText?.kind === "Text" && yText?.kind === "Text") {
      expect(xText.style.fontSize).toBeGreaterThan(18);
      expect(aText.position.x).toBeGreaterThan(xText.position.x);
      expect(yText.position.x).toBeGreaterThan(aText.position.x);
    }
  });

  it("ignores standalone \\usetikzlibrary commands without emitting unsupported-statement diagnostics", () => {
    const source = String.raw`\begin{tikzpicture}
  \usetikzlibrary {shadows,shapes.symbols}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-statement")).toBe(false);
    expect(result.scene.elements.some((element) => element.kind === "Path")).toBe(true);
  });

  it("applies custom styles defined via \\tikzset, \\tikzstyle, and \\pgfkeys", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{
    base/.style={draw=red},
    base/.append style={ultra thick}
  }
  \tikzstyle{legacy}=[dashed]
  \pgfkeys{/tikz/.cd, helper/.style={line width=2pt}}
  \draw[base,legacy,helper] (0,0) -- (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:base")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:legacy")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:helper")).toBe(false);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.stroke).toBe("#ff0000");
      expect(path.style.lineWidth).toBeCloseTo(2, 6);
      expect(path.style.dashArray).toEqual([3, 3]);
    }
  });

  it("applies \\def macro bindings to coordinate expressions", () => {
    const source = String.raw`\begin{tikzpicture}
  \def\x{3}
  \draw (\x,2) -- (\x,3);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("invalid-cartesian-coordinate"))).toBe(false);
    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const move = path.commands.find((command) => command.kind === "M");
      const line = path.commands.find((command) => command.kind === "L");
      expect(move?.kind).toBe("M");
      expect(line?.kind).toBe("L");
      if (move?.kind === "M" && line?.kind === "L") {
        expect(move.to.x).toBeCloseTo(85.3583, 3);
        expect(move.to.y).toBeCloseTo(56.9055, 3);
        expect(line.to.x).toBeCloseTo(85.3583, 3);
        expect(line.to.y).toBeCloseTo(85.3583, 3);
      }
    }
  });

  it("applies \\let aliases by value at definition time", () => {
    const source = String.raw`\begin{tikzpicture}
  \def\x{1}
  \let\y=\x
  \def\x{2}
  \draw (\y,0) -- (\x,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const move = path.commands.find((command) => command.kind === "M");
      const line = path.commands.find((command) => command.kind === "L");
      expect(move?.kind).toBe("M");
      expect(line?.kind).toBe("L");
      if (move?.kind === "M" && line?.kind === "L") {
        expect(move.to.x).toBeCloseTo(28.4527, 3);
        expect(line.to.x).toBeCloseTo(56.9055, 3);
      }
    }
  });

  it("keeps macro definitions scoped inside nested scope statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \def\x{1}
  \begin{scope}
    \def\x{2}
    \draw (\x,0) -- (\x,1);
  \end{scope}
  \draw (\x,0) -- (\x,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    expect(paths).toHaveLength(2);
    const first = paths[0];
    const second = paths[1];
    expect(first?.kind).toBe("Path");
    expect(second?.kind).toBe("Path");
    if (first?.kind === "Path" && second?.kind === "Path") {
      const firstMove = first.commands.find((command) => command.kind === "M");
      const secondMove = second.commands.find((command) => command.kind === "M");
      expect(firstMove?.kind).toBe("M");
      expect(secondMove?.kind).toBe("M");
      if (firstMove?.kind === "M" && secondMove?.kind === "M") {
        expect(firstMove.to.x).toBeCloseTo(56.9055, 3);
        expect(secondMove.to.x).toBeCloseTo(28.4527, 3);
      }
    }
  });

  it("applies fixed-arity \\newcommand macros in coordinate expressions", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\xof}[1]{#1}
  \draw (\xof{3},0) -- (\xof{4},0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("invalid-cartesian-coordinate"))).toBe(false);
    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const move = path.commands.find((command) => command.kind === "M");
      const line = path.commands.find((command) => command.kind === "L");
      expect(move?.kind).toBe("M");
      expect(line?.kind).toBe("L");
      if (move?.kind === "M" && line?.kind === "L") {
        expect(move.to.x).toBeCloseTo(85.3583, 3);
        expect(line.to.x).toBeCloseTo(113.811, 3);
      }
    }
  });

  it("supports callable aliases via \\let for \\newcommand macros", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\pair}[2]{#1/#2}
  \let\alias=\pair
  \node at (0,0) {\alias{A}{B}};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const label = result.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.text).toBe("A/B");
    }
  });

  it("applies renewcommand overrides with normal scope rollback", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\xv}{1}
  \begin{scope}
    \renewcommand{\xv}{2}
    \draw (\xv,0) -- (\xv,1);
  \end{scope}
  \draw (\xv,0) -- (\xv,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    expect(paths).toHaveLength(2);
    const first = paths[0];
    const second = paths[1];
    expect(first?.kind).toBe("Path");
    expect(second?.kind).toBe("Path");
    if (first?.kind === "Path" && second?.kind === "Path") {
      const firstMove = first.commands.find((command) => command.kind === "M");
      const secondMove = second.commands.find((command) => command.kind === "M");
      expect(firstMove?.kind).toBe("M");
      expect(secondMove?.kind).toBe("M");
      if (firstMove?.kind === "M" && secondMove?.kind === "M") {
        expect(firstMove.to.x).toBeCloseTo(56.9055, 3);
        expect(secondMove.to.x).toBeCloseTo(28.4527, 3);
      }
    }
  });

  it("attaches macro provenance metadata to expanded elements", () => {
    const source = String.raw`\begin{tikzpicture}
  \def\x{A}
  \newcommand{\fmt}[1]{#1}
  \node at (0,0) {\fmt{\x}};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const label = result.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.origin?.foreachStack).toEqual([]);
      expect(label.origin?.macroStack?.map((entry) => entry.macroName)).toEqual(expect.arrayContaining(["\\x", "\\fmt"]));
      expect(label.origin?.macroStack?.some((entry) => entry.commandRaw === "\\newcommand")).toBe(true);
    }
  });

  it("expands fixed-arity \\newcommand macros in node text", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\pair}[2]{#1-#2}
  \node at (0,0) {\pair{A}{B}};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const label = result.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.text).toBe("A-B");
    }
  });

  it("caps recursive macro expansion depth during semantic evaluation", () => {
    const source = String.raw`\begin{tikzpicture}
  \def\loop{\loop x}
  \node at (0,0) {\loop};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const label = result.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      const growthCount = (label.text.match(/ x/g) ?? []).length;
      expect(growthCount).toBe(100);
      expect(label.text.startsWith(String.raw`\loop`)).toBe(true);
    }
  });

  it("supports newcommand optional/default arguments in semantic text expansion", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\pair}[2][left]{#1/#2}
  \node at (0,0) {\pair{R}};
  \node at (1,0) {\pair[right]{R}};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const labels = result.scene.elements
      .filter((element) => element.kind === "Text")
      .map((element) => (element.kind === "Text" ? element.text : ""));
    expect(labels).toContain("left/R");
    expect(labels).toContain("right/R");
  });

  it("supports newcommand optional/default arguments in coordinate expansion", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\xof}[2][2]{#1}
  \draw (\xof{Q},0) -- (\xof[3]{Q},0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("invalid-cartesian-coordinate"))).toBe(false);
    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const move = path.commands.find((command) => command.kind === "M");
      const line = path.commands.find((command) => command.kind === "L");
      expect(move?.kind).toBe("M");
      expect(line?.kind).toBe("L");
      if (move?.kind === "M" && line?.kind === "L") {
        expect(move.to.x).toBeCloseTo(56.9055, 3);
        expect(line.to.x).toBeCloseTo(85.3583, 3);
      }
    }
  });

  it("preserves optional/default behavior through callable let aliases", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\pair}[2][left]{#1/#2}
  \let\alias=\pair
  \node at (0,0) {\alias{R}};
  \node at (1,0) {\alias[right]{R}};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const labels = result.scene.elements
      .filter((element) => element.kind === "Text")
      .map((element) => (element.kind === "Text" ? element.text : ""));
    expect(labels).toContain("left/R");
    expect(labels).toContain("right/R");
  });

  it("expands macros in shift option coordinates after foreach substitution", () => {
    const source = String.raw`\begin{tikzpicture}
  \def\rulery{1}
  \foreach \x/\xtext in {-0.6/\frac12, 0/1, 0.6/\frac32, 1.2/2}
    \draw[shift={(\x,\rulery)}] (0pt,2.5pt) -- (0pt,-2.5pt) node[above=5.5pt] {$\strut\xtext$};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("invalid-shift:"))).toBe(false);
    const labels = result.scene.elements.filter((element) => element.kind === "Text");
    expect(labels).toHaveLength(4);
  });

  it("resolves custom style overwrite order left-to-right", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{
    style1/.style={draw=red,fill=blue},
    style2/.style={draw=green}
  }
  \draw[style1,style2] (0,0) rectangle (1,1);
  \draw[style2,style1] (2,0) rectangle (3,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const paths = result.scene.elements.filter((element) => element.kind === "Path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
    const first = paths[0];
    const second = paths[1];
    expect(first?.kind).toBe("Path");
    expect(second?.kind).toBe("Path");
    if (first?.kind === "Path" && second?.kind === "Path") {
      expect(first.style.fill).toBe("#0000ff");
      expect(first.style.stroke).toBe("#00ff00");
      expect(second.style.fill).toBe("#0000ff");
      expect(second.style.stroke).toBe("#ff0000");
    }
  });

  it("applies \\tikzset every-node style keys to subsequent nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{
    every node/.style={draw},
    every circle node/.style={double}
  }
  \draw (0,0) node {A} -- (1,1) node[circle] {B};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.includes("every node/.style"))).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.includes("every circle node/.style"))).toBe(false);

    const nodeBoxes = result.scene.elements.filter((element) => element.kind === "Path" && element.id.startsWith("scene-node-box:"));
    const circles = result.scene.elements.filter((element) => element.kind === "Circle");
    expect(nodeBoxes.length).toBe(1);
    expect(circles.length).toBe(1);
    const circle = circles[0];
    expect(circle?.kind).toBe("Circle");
    if (circle?.kind === "Circle") {
      expect(circle.style.doubleStroke).toBe(true);
    }
  });

  it("applies every-node style keys for rectangle and circle nodes", () => {
    const source = String.raw`\begin{tikzpicture}[
  every node/.style={draw},
  every circle node/.style={double}
]
  \draw (0,0) node {A} -- (1,1) node[circle] {B};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.includes("every node/.style"))).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.includes("every circle node/.style"))).toBe(false);

    const nodeBoxes = result.scene.elements.filter((element) => element.kind === "Path" && element.id.startsWith("scene-node-box:"));
    const circles = result.scene.elements.filter((element) => element.kind === "Circle");
    expect(nodeBoxes.length).toBe(1);
    expect(circles.length).toBe(1);
    const circle = circles[0];
    expect(circle?.kind).toBe("Circle");
    if (circle?.kind === "Circle") {
      expect(circle.style.doubleStroke).toBe(true);
    }
  });

  it("applies every-node style keys for diamond and trapezium nodes", () => {
    const source = String.raw`\begin{tikzpicture}[
  every node/.style={draw},
  every diamond node/.style={double},
  every trapezium node/.style={fill=red}
]
  \draw (0,0) node[diamond]   {D};
  \draw (2,0) node[trapezium] {T};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const nodeBoxes = result.scene.elements.filter(
      (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
        element.kind === "Path" && element.id.startsWith("scene-node-box:")
    );
    expect(nodeBoxes).toHaveLength(2);

    const byX = nodeBoxes
      .map((path) => ({
        path,
        centerX:
          path.commands
            .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to.x] : []))
            .reduce((sum, x) => sum + x, 0) /
          Math.max(path.commands.filter((command) => command.kind === "M" || command.kind === "L").length, 1)
      }))
      .sort((left, right) => left.centerX - right.centerX);

    const diamond = byX[0]?.path;
    const trapezium = byX[1]?.path;
    expect(diamond).toBeDefined();
    expect(trapezium).toBeDefined();
    if (diamond && trapezium) {
      expect(diamond.style.doubleStroke).toBe(true);
      expect(trapezium.style.fill).toBe("#ff0000");
    }
  });

  it("applies every-node style keys for isosceles triangle and cylinder nodes", () => {
    const source = String.raw`\begin{tikzpicture}[
  every node/.style={draw},
  every isosceles triangle node/.style={fill=blue},
  every cylinder node/.style={double}
]
  \draw (0,0) node[isosceles triangle] {I};
  \draw (2,0) node[cylinder] {C};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const nodeBoxes = result.scene.elements.filter(
      (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
        element.kind === "Path" && element.id.startsWith("scene-node-box:")
    );
    expect(nodeBoxes).toHaveLength(2);

    const byX = nodeBoxes
      .map((path) => ({
        path,
        centerX:
          path.commands
            .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to.x] : []))
            .reduce((sum, x) => sum + x, 0) /
          Math.max(path.commands.filter((command) => command.kind === "M" || command.kind === "L").length, 1)
      }))
      .sort((left, right) => left.centerX - right.centerX);

    const triangle = byX[0]?.path;
    const cylinder = byX[1]?.path;
    expect(triangle).toBeDefined();
    expect(cylinder).toBeDefined();
    if (triangle && cylinder) {
      expect(triangle.style.fill).toBe("#0000ff");
      expect(cylinder.style.doubleStroke).toBe(true);
    }
  });

  it("applies every-node style keys for cloud, starburst, signal, and tape nodes", () => {
    const source = String.raw`\begin{tikzpicture}[
  every node/.style={draw},
  every cloud node/.style={fill=green},
  every starburst node/.style={double},
  every signal node/.style={fill=red},
  every tape node/.style={double}
]
  \draw (0,0) node[cloud] {C};
  \draw (2,0) node[starburst] {B};
  \draw (4,0) node[signal] {S};
  \draw (6,0) node[tape] {T};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const nodeBoxes = result.scene.elements.filter(
      (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
        element.kind === "Path" && element.id.startsWith("scene-node-box:")
    );
    expect(nodeBoxes).toHaveLength(4);

    const byX = nodeBoxes
      .map((path) => ({
        path,
        centerX:
          path.commands
            .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to.x] : []))
            .reduce((sum, x) => sum + x, 0) /
          Math.max(path.commands.filter((command) => command.kind === "M" || command.kind === "L").length, 1)
      }))
      .sort((left, right) => left.centerX - right.centerX);

    const cloud = byX[0]?.path;
    const starburst = byX[1]?.path;
    const signal = byX[2]?.path;
    const tape = byX[3]?.path;
    expect(cloud).toBeDefined();
    expect(starburst).toBeDefined();
    expect(signal).toBeDefined();
    expect(tape).toBeDefined();
    if (cloud && starburst && signal && tape) {
      expect(cloud.style.fill).toBe("#00ff00");
      expect(starburst.style.doubleStroke).toBe(true);
      expect(signal.style.fill).toBe("#ff0000");
      expect(tape.style.doubleStroke).toBe(true);
    }
  });

  it("applies every-node style keys for single and double arrow nodes", () => {
    const source = String.raw`\begin{tikzpicture}[
  every node/.style={draw},
  every single arrow node/.style={fill=blue},
  every double arrow node/.style={double}
]
  \draw (0,0) node[single arrow] {S};
  \draw (2,0) node[double arrow] {D};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const nodeBoxes = result.scene.elements.filter(
      (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
        element.kind === "Path" && element.id.startsWith("scene-node-box:")
    );
    expect(nodeBoxes).toHaveLength(2);

    const byX = nodeBoxes
      .map((path) => ({
        path,
        centerX:
          path.commands
            .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to.x] : []))
            .reduce((sum, x) => sum + x, 0) /
          Math.max(path.commands.filter((command) => command.kind === "M" || command.kind === "L").length, 1)
      }))
      .sort((left, right) => left.centerX - right.centerX);

    const singleArrow = byX[0]?.path;
    const doubleArrow = byX[1]?.path;
    expect(singleArrow).toBeDefined();
    expect(doubleArrow).toBeDefined();
    if (singleArrow && doubleArrow) {
      expect(singleArrow.style.fill).toBe("#0000ff");
      expect(doubleArrow.style.doubleStroke).toBe(true);
    }
  });

  it("applies every-node style keys for rectangle, ellipse, and cloud callout nodes", () => {
    const source = String.raw`\begin{tikzpicture}[
  every node/.style={draw},
  every rectangle callout node/.style={fill=yellow},
  every ellipse callout node/.style={double},
  every cloud callout node/.style={fill=red}
]
  \draw (0,0) node[rectangle callout] {R};
  \draw (2,0) node[ellipse callout] {E};
  \draw (4,0) node[cloud callout] {C};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const nodeBoxes = result.scene.elements.filter(
      (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
        element.kind === "Path" && element.id.startsWith("scene-node-box:")
    );
    expect(nodeBoxes).toHaveLength(3);

    const byX = nodeBoxes
      .map((path) => ({
        path,
        centerX:
          path.commands
            .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to.x] : []))
            .reduce((sum, x) => sum + x, 0) /
          Math.max(path.commands.filter((command) => command.kind === "M" || command.kind === "L").length, 1)
      }))
      .sort((left, right) => left.centerX - right.centerX);

    const rectangleCallout = byX[0]?.path;
    const ellipseCallout = byX[1]?.path;
    const cloudCallout = byX[2]?.path;
    expect(rectangleCallout).toBeDefined();
    expect(ellipseCallout).toBeDefined();
    expect(cloudCallout).toBeDefined();
    if (rectangleCallout && ellipseCallout && cloudCallout) {
      expect(rectangleCallout.style.fill).toBe("#ffff00");
      expect(ellipseCallout.style.doubleStroke).toBe(true);
      expect(cloudCallout.style.fill).toBe("#ff0000");
    }
  });

  it("places trailing nodes at the end of +(...) segments", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- +(1,1) node[above] {N};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const text = result.scene.elements.find((element) => element.kind === "Text" && element.text === "N");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.position.x).toBeGreaterThan(20);
      expect(text.position.y).toBeGreaterThan(20);
    }
  });

  it("inherits anchor options from draw statements and scales node text for transform shape", () => {
    const source = String.raw`\begin{tikzpicture}[scale=3,transform shape]
  \draw[anchor=center] (0,0) node {C};
  \draw[anchor=base]   (0,0) node {B};
  \draw[anchor=mid]    (0,0) node {M};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:transform shape")).toBe(false);

    const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
    const base = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
    const mid = result.scene.elements.find((element) => element.kind === "Text" && element.text === "M");
    expect(center?.kind).toBe("Text");
    expect(base?.kind).toBe("Text");
    expect(mid?.kind).toBe("Text");
    if (center?.kind === "Text" && base?.kind === "Text" && mid?.kind === "Text") {
      expect(base.position.y).toBeGreaterThan(mid.position.y);
      expect(mid.position.y).toBeGreaterThan(center.position.y);
      expect(base.style.fontSize).toBeCloseTo(29.8879, 3);
    }
  });

  it("scales circle radii with the active transform so polar spokes still reach the boundary", () => {
    const source = String.raw`\begin{tikzpicture}[transform shape, scale=0.9]
    \draw [thick] (0,0) circle (5);
    \foreach \x in {45,135,225,-45}
      \draw [thick] (\x:0) -- (\x:5);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const circle = result.scene.elements.find((element) => element.kind === "Circle");
    expect(circle?.kind).toBe("Circle");

    const endpoints = result.scene.elements
      .filter((element) => element.kind === "Path")
      .flatMap((element) =>
        element.commands.flatMap((command) => (command.kind === "L" ? [command.to] : []))
      );
    expect(endpoints).toHaveLength(4);

    if (circle?.kind === "Circle") {
      for (const endpoint of endpoints) {
        const radialDistance = Math.hypot(endpoint.x - circle.center.x, endpoint.y - circle.center.y);
        expect(radialDistance).toBeCloseTo(circle.radius, 3);
      }
    }
  });

  it("applies transform rotation to ellipse geometry", () => {
    const source = String.raw`\begin{tikzpicture}[rotate=30]
  \draw (0,0) ellipse [x radius=2cm, y radius=1cm];
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const ellipse = result.scene.elements.find((element) => element.kind === "Ellipse");
    expect(ellipse?.kind).toBe("Ellipse");
    if (ellipse?.kind === "Ellipse") {
      const normalized = ((ellipse.rotation ?? 0) % 180 + 180) % 180;
      expect(normalized).toBeCloseTo(30, 3);
      expect(ellipse.rx).toBeGreaterThan(ellipse.ry);
    }
  });

  it("maps circles to ellipses under non-uniform scaling transforms", () => {
    const source = String.raw`\begin{tikzpicture}[xscale=2, yscale=1]
  \draw (0,0) circle (1cm);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const ellipse = result.scene.elements.find((element) => element.kind === "Ellipse");
    expect(ellipse?.kind).toBe("Ellipse");
    if (ellipse?.kind === "Ellipse") {
      expect(ellipse.rx).toBeGreaterThan(ellipse.ry * 1.9);
      expect(ellipse.rotation ?? 0).toBeCloseTo(0, 3);
    }
  });

  it("supports node font option for italic text", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[node font=\itshape] (1,0) -- +(1,1) node[above] {italic};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const text = result.scene.elements.find((element) => element.kind === "Text" && element.text === "italic");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.style.fontStyle).toBe("italic");
    }
  });

  it("supports font option with TeX size and shape commands", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {base};
  \node[font=\footnotesize] at (1,0) {small};
  \node[font=\Large\itshape] at (2,0) {large};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const base = result.scene.elements.find((element) => element.kind === "Text" && element.text === "base");
    const small = result.scene.elements.find((element) => element.kind === "Text" && element.text === "small");
    const large = result.scene.elements.find((element) => element.kind === "Text" && element.text === "large");
    expect(base?.kind).toBe("Text");
    expect(small?.kind).toBe("Text");
    expect(large?.kind).toBe("Text");
    if (base?.kind === "Text" && small?.kind === "Text" && large?.kind === "Text") {
      expect(small.style.fontSize).toBeCloseTo(base.style.fontSize * 0.8, 3);
      expect(large.style.fontSize).toBeCloseTo(base.style.fontSize * 1.44, 3);
      expect(large.style.fontStyle).toBe("italic");
    }
  });

  it("lets later `font=` assignments override earlier style-provided font commands", () => {
    const source = String.raw`\begin{tikzpicture}[nd/.style={font=\bfseries}]
  \node at (0,0) {base};
  \node[nd,font=\footnotesize] at (1,0) {override};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const base = result.scene.elements.find((element) => element.kind === "Text" && element.text === "base");
    const override = result.scene.elements.find((element) => element.kind === "Text" && element.text === "override");
    expect(base?.kind).toBe("Text");
    expect(override?.kind).toBe("Text");
    if (base?.kind === "Text" && override?.kind === "Text") {
      expect(override.style.fontWeight).toBe("normal");
      expect(override.style.fontSize).toBeCloseTo(base.style.fontSize * 0.8, 3);
    }
  });

  it("supports pgfutil font aliases and explicit \\fontsize commands in font options", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {base};
  \node[font=\pgfutil@font@footnotesize\pgfutil@font@itshape] at (1,0) {alias};
  \node[font=\fontsize{6}{7}\selectfont] at (2,0) {custom};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const base = result.scene.elements.find((element) => element.kind === "Text" && element.text === "base");
    const alias = result.scene.elements.find((element) => element.kind === "Text" && element.text === "alias");
    const custom = result.scene.elements.find((element) => element.kind === "Text" && element.text === "custom");
    expect(base?.kind).toBe("Text");
    expect(alias?.kind).toBe("Text");
    expect(custom?.kind).toBe("Text");
    if (base?.kind === "Text" && alias?.kind === "Text" && custom?.kind === "Text") {
      expect(alias.style.fontSize).toBeCloseTo(base.style.fontSize * 0.8, 3);
      expect(alias.style.fontStyle).toBe("italic");
      expect(custom.style.fontSize).toBeCloseTo(6, 3);
    }
  });

  it("supports weight/family font commands and mixed command sequences in font options", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {base};
  \node[font=\sffamily] at (0,1) {sans};
  \node[font=\bf] at (0,2) {bf};
  \node[font=\bfseries] at (0,3) {bfseries};
  \node[font=\sffamily\bfseries] at (0,4) {sansbold};
  \node[font=\small\bf] at (0,5) {smallbold};
  \node[font=\ttfamily\mdseries\upshape] at (0,6) {mono};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const byText = new Map(
      result.scene.elements
        .filter((element) => element.kind === "Text")
        .map((element) => [element.text, element] as const)
    );

    const base = byText.get("base");
    const sans = byText.get("sans");
    const bf = byText.get("bf");
    const bfseries = byText.get("bfseries");
    const sansbold = byText.get("sansbold");
    const smallbold = byText.get("smallbold");
    const mono = byText.get("mono");

    expect(base?.kind).toBe("Text");
    expect(sans?.kind).toBe("Text");
    expect(bf?.kind).toBe("Text");
    expect(bfseries?.kind).toBe("Text");
    expect(sansbold?.kind).toBe("Text");
    expect(smallbold?.kind).toBe("Text");
    expect(mono?.kind).toBe("Text");
    if (
      base?.kind === "Text" &&
      sans?.kind === "Text" &&
      bf?.kind === "Text" &&
      bfseries?.kind === "Text" &&
      sansbold?.kind === "Text" &&
      smallbold?.kind === "Text" &&
      mono?.kind === "Text"
    ) {
      expect(sans.style.fontFamily).toBe("sans");
      expect(bf.style.fontWeight).toBe("bold");
      expect(bfseries.style.fontWeight).toBe("bold");
      expect(sansbold.style.fontFamily).toBe("sans");
      expect(sansbold.style.fontWeight).toBe("bold");
      expect(smallbold.style.fontWeight).toBe("bold");
      expect(smallbold.style.fontSize).toBeCloseTo(base.style.fontSize * 0.9, 3);
      expect(mono.style.fontFamily).toBe("monospace");
      expect(mono.style.fontWeight).toBe("normal");
      expect(mono.style.fontStyle).toBe("normal");
    }
  });

  it("applies colorlet aliases to both style options and node text colors", () => {
    const source = String.raw`\begin{tikzpicture}
  \colorlet{mycolor}{blue}
  \fill[mycolor] (0,0) rectangle (1,1);
  \node at (0, -1) {My favorite color is \textcolor{mycolor}{this}!};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:mycolor")).toBe(false);

    const filledPath = result.scene.elements.find((element) => element.kind === "Path" && element.style.fill != null);
    expect(filledPath?.kind).toBe("Path");
    if (filledPath?.kind === "Path") {
      expect(filledPath.style.fill).toBe("#0000ff");
    }

    const label = result.scene.elements.find((element) => element.kind === "Text" && element.text.includes("favorite color"));
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.text).toContain(String.raw`\textcolor{blue}{this}`);
    }
  });

  it("applies dimensionless rounded corners values to rectangle path geometry", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rounded corners=0.5] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("invalid-rounded-corners"))).toBe(false);
    const rectangle = result.scene.elements.find((element) => element.kind === "Path");
    expect(rectangle?.kind).toBe("Path");
    if (rectangle?.kind === "Path") {
      expect(rectangle.commands.some((command) => command.kind === "C")).toBe(true);
    }
  });

  it("accepts comments in tikzset styles and foreach headers", () => {
    const styleSource = String.raw`\begin{tikzpicture}[box/.style={rectangle,
  % this comment should not break style parsing
  draw=red}]
  \node [box] {test};
\end{tikzpicture}`;
    const styleParsed = parseTikz(styleSource);
    const styleResult = evaluateTikzFigure(styleParsed.figure, styleSource);
    expect(styleParsed.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    const styledBox = styleResult.scene.elements.find((element) => element.kind === "Path" && element.id.startsWith("scene-node-box:"));
    expect(styledBox?.kind).toBe("Path");
    if (styledBox?.kind === "Path") {
      expect(styledBox.style.stroke).toBe("#ff0000");
    }

    const foreachSource = String.raw`\begin{tikzpicture}
  \foreach \x [count=\i, % in-comment token should be ignored
               var=\v] in {1,2}
    \node at (\x,0) {\v};
\end{tikzpicture}`;
    const foreachParsed = parseTikz(foreachSource);
    const foreachResult = evaluateTikzFigure(foreachParsed.figure, foreachSource);
    expect(foreachParsed.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(foreachResult.diagnostics.some((diagnostic) => diagnostic.code === "foreach-body-parse-error")).toBe(false);
    const textLabels = foreachResult.scene.elements.filter((element) => element.kind === "Text");
    expect(textLabels).toHaveLength(2);
  });
});
