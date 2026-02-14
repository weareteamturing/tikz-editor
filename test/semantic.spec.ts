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
      expect(sideAxisPath.style.axisTopColor).toBe("#008000");
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
      expect(first.style.stroke).toBe("#008000");
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
