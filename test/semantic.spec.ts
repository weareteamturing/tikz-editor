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

  it("emits explicit diagnostics for currently unsupported path keywords", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) plot (1,1);
  \draw (0,0) edge (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const unsupportedKeywordDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-path-keyword");
    expect(unsupportedKeywordDiagnostics.length).toBeGreaterThanOrEqual(2);
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

  it("resolves dash/cap/join and opacity style options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[opacity=0.8, draw opacity=0.6, fill opacity=0.3, dashed, line cap=round, line join=bevel] (0,0) -- (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const result = evaluateTikzFigure(parsed.figure, source);

    const path = result.scene.elements.find((element) => element.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      expect(path.style.opacity).toBeCloseTo(0.8);
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
      expect(topPath.style.markerStart).toBe("bar");
      expect(topPath.style.markerEnd).toBe("bar");
      expect(topPath.style.dashArray).toEqual([20, 10]);
      expect(topPath.style.dashOffset).toBeCloseTo(0);
      expect(bottomPath.style.dashArray).toEqual([20, 10]);
      expect(bottomPath.style.dashOffset).toBeCloseTo(10);
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
      expect(drawInScope.style.stroke).toBe("green");
      expect(drawInScope.style.lineWidth).toBeCloseTo(3);
    }

    const drawOutsideScope = paths[1];
    expect(drawOutsideScope?.kind).toBe("Path");
    if (drawOutsideScope?.kind === "Path") {
      expect(drawOutsideScope.style.stroke).toBe("blue");
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
});
