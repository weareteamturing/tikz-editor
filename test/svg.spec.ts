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

  it("emits matrix cell text and matrix-referenced paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,row sep=4mm,column sep=6mm] (m) {
    A & B \\
    C & D \\
  };
  \draw (m-1-1) -- (m-2-2);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    const textCount = emitted.svg.match(/<text /g)?.length ?? 0;
    expect(textCount).toBe(4);
    expect(emitted.svg).toContain("A");
    expect(emitted.svg).toContain("B");
    expect(emitted.svg).toContain("C");
    expect(emitted.svg).toContain("D");
    expect(emitted.svg).toContain("<path");
    expect(emitted.viewBox.width).toBeLessThan(400);
    expect(emitted.viewBox.height).toBeLessThan(250);
  });

  it("keeps foreach-expanded instances mapped to authored template source IDs", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1}
    \draw (\x,0) -- ++(1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    const sourceIds = [...emitted.svg.matchAll(/data-source-id="([^"]+)"/g)].map((match) => match[1]);
    expect(sourceIds.length).toBeGreaterThan(0);
    expect(sourceIds.every((id) => id.startsWith("foreach:"))).toBe(true);
  });

  it("emits positioned nodes placed using `...=of` syntax at distinct coordinates", () => {
    const source = String.raw`\begin{tikzpicture}[on grid,node distance=12pt]
  \node[draw,name=a,node contents=A] at (0,0);
  \node[draw,above=of a,name=b,node contents=B];
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    const textPoints = [...emitted.svg.matchAll(/<text[^>]* x="([^"]+)" y="([^"]+)"/g)].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2])
    }));

    expect(textPoints.length).toBe(2);
    expect(textPoints[0]?.x).toBeCloseTo(textPoints[1]?.x ?? Number.NaN, 3);
    expect(textPoints[0]?.y).not.toBeCloseTo(textPoints[1]?.y ?? Number.NaN, 3);
  });

  it("emits cubic Bezier path commands", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,1) and (2,1) .. (3,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain("<path");
    expect(emitted.svg).toContain(" C ");
  });

  it("emits grid and arc geometry as SVG paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid [step=1cm] (2,1);
  \draw (0,0) arc [start angle=0, end angle=90, radius=1cm];
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg.match(/<path /g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(semantic.diagnostics.some((diagnostic) => diagnostic.code === "invalid-arc-parameters")).toBe(false);
  });

  it("emits true SVG arc commands for supported arc variants", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (1,0) arc (0:90:1cm);
  \draw (1,0) arc [start angle=0, delta angle=90, x radius=1cm, y radius=.5cm];
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(semantic.diagnostics.some((diagnostic) => diagnostic.code === "invalid-arc-parameters")).toBe(false);
    expect(emitted.svg).toContain(" A ");
  });

  it("emits SVG path geometry for coordinate and expression plot operations", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw plot coordinates {(0,0) (1,1) (2,0)};
  \draw[domain=0:2,samples=5] plot (\x,{sin(\x r)});
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(semantic.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unsupported-plot-mode:"))).toBe(false);
    expect(emitted.svg.match(/<path /g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("emits smooth and bar plot handler geometries as SVG paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw plot[smooth] coordinates {(0,0) (1,1) (2,0)};
  \draw[fill=blue!30,bar width=6pt] plot[ybar] coordinates {(0,1) (1,2) (2,1)};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(semantic.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unsupported-option-flag:"))).toBe(false);
    expect(emitted.svg).toContain("<path");
    expect(emitted.svg).toContain(" C ");
    expect(emitted.svg).toContain(" Z");
  });

  it("emits `mark=+` and `mark=*` plot markers as SVG path geometry", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw plot[mark=+] coordinates {(0,0) (1,1) (2,0)};
  \draw plot[mark=*] coordinates {(0,1) (1,2) (2,1)};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(semantic.diagnostics.some((diagnostic) => diagnostic.code === "invalid-plot-coordinates")).toBe(false);
    expect(emitted.svg.match(/<path /g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(emitted.svg).toContain(" A ");
  });

  it("includes arc extrema in bounds so the viewBox does not clip half-circle arcs", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (1,0) arc (0:180:1cm);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain(" A ");
    expect(emitted.viewBox.height).toBeGreaterThan(40);
  });

  it("emits dash and stroke-join/cap/opacity style attributes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[opacity=0.8,draw opacity=0.6,fill opacity=0.3,dashed,line cap=round,line join=bevel] (0,0) -- (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('stroke-dasharray="3 3"');
    expect(emitted.svg).toContain('stroke-linecap="round"');
    expect(emitted.svg).toContain('stroke-linejoin="bevel"');
    expect(emitted.svg).toContain('stroke-opacity="0.6"');
    expect(emitted.svg).toContain('fill-opacity="0.3"');
    expect(emitted.svg).not.toContain('opacity="0.8"');
    expect(emitted.svg).not.toContain("vector-effect=");
  });

  it("emits dash offsets and explicit bar tip paths for |-| paths", () => {
    const source = String.raw`\begin{tikzpicture}[|-|,dash pattern=on 4pt off 2pt]
  \draw[dash phase=2pt] (0,0) -- (2,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('stroke-dasharray="4 2"');
    expect(emitted.svg).toContain('stroke-dashoffset="2"');
    const barTipPaths = emitted.svg.match(/data-arrow-tip-kind="bar"/g) ?? [];
    expect(barTipPaths.length).toBe(2);
    expect(emitted.svg).not.toContain("marker-start=");
    expect(emitted.svg).not.toContain("marker-end=");
  });

  it("emits SVG gradients for axis/radial/ball shading options", () => {
    const source = String.raw`\begin{tikzpicture}
  \shade[top color=red,bottom color=blue,shading angle=45] (0,0) rectangle (1,1);
  \shade[inner color=white,outer color=black] (2,0) circle (0.5);
  \shade[ball color=red] (3,0) circle (0.5);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain("<defs>");
    expect(emitted.svg).toContain("<linearGradient");
    expect(emitted.svg).toContain('id="tikz-shading-axis-');
    expect(emitted.svg).toContain('gradientUnits="userSpaceOnUse"');
    expect(emitted.svg).toContain("rotate(-45)");
    expect(emitted.svg).toContain("<radialGradient");
    expect(emitted.svg).toContain('id="tikz-shading-radial-');
    expect(emitted.svg).toContain('id="tikz-shading-ball-');
    expect(emitted.diagnostics.some((diagnostic) => diagnostic.code.startsWith("unsupported-shading:"))).toBe(false);
  });

  it("emits SVG pattern defs and url() fills for pattern styles", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[pattern=grid,pattern color=red] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain("<defs>");
    expect(emitted.svg).toContain("<pattern");
    expect(emitted.svg).toContain('id="tikz-pattern-');
    expect(emitted.svg).toContain('fill="url(#tikz-pattern-');
  });

  it("deduplicates equal patterns and splits defs for different color/params", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[pattern=grid,pattern color=red] (0,0) rectangle (1,1);
  \draw[pattern=grid,pattern color=red] (2,0) rectangle (3,1);
  \draw[pattern=grid,pattern color=blue] (4,0) rectangle (5,1);
  \draw[pattern={Lines[angle=45]},pattern color=red] (6,0) rectangle (7,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    const patternDefs = emitted.svg.match(/<pattern id="tikz-pattern-[^"]+"/g) ?? [];
    expect(patternDefs.length).toBe(3);
    expect(emitted.svg.match(/fill="url\(#tikz-pattern-[^"]+\)"/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("renders representative legacy and meta pattern geometry", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[pattern=bricks,pattern color=black] (0,0) rectangle (1,1);
  \draw[pattern={Hatch[angle=30,distance=4pt,line width=.6pt]},pattern color=green] (2,0) rectangle (3,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('stroke-width="0.8"');
    expect(emitted.svg).toContain('rotate(-30)');
    expect(emitted.svg).toContain('stroke-width="0.6"');
  });

  it("keeps shading precedence over pattern fills", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[pattern=grid,pattern color=red,top color=blue,bottom color=white] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('fill="url(#tikz-shading-axis-');
    expect(emitted.svg).not.toContain('id="tikz-pattern-');
  });

  it("ignores pattern color for inherently colored predefined patterns", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[pattern={checkerboard light gray},pattern color=red] (0,0) rectangle (1,1);
  \draw[pattern={checkerboard light gray},pattern color=blue] (2,0) rectangle (3,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    const patternDefs = emitted.svg.match(/<pattern id="tikz-pattern-[^"]+"/g) ?? [];
    expect(patternDefs.length).toBe(1);
  });

  it("reports unsupported shading names while falling back to fill color", () => {
    const source = String.raw`\begin{tikzpicture}
  \shade[shading=color wheel] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-shading:color wheel")).toBe(true);
    expect(emitted.svg).toContain('fill="black"');
  });

  it("emits SVG shadow layers for drop/copy/circular shadow styles", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[drop shadow,fill=white] (0,0) rectangle (1,1);
  \draw[double copy shadow={shadow xshift=1ex,shadow yshift=1ex},fill=white] (2,0) rectangle (3,1);
  \draw[circular glow,fill=white] (4,0) rectangle (5,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    const shadowLayerMatches = emitted.svg.match(/data-shadow-layer="/g) ?? [];
    expect(shadowLayerMatches.length).toBeGreaterThanOrEqual(4);
    expect(emitted.svg).toContain('data-shadow-fade="circle-fuzzy-edge-15"');
    expect(emitted.svg).toContain('id="tikz-shadow-mask-circle-fuzzy-15"');
    expect(emitted.svg).toContain('mask="url(#tikz-shadow-mask-circle-fuzzy-15)"');
    expect(emitted.svg).toContain("<g data-source-id=");
  });

  it("emits node shadow geometry even when the node has no normal fill/draw", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[circle,circular glow={fill=red!40}] at (0,0) {Glow};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('data-shadow-layer="1"');
    expect(emitted.svg).toContain("<circle");
    expect(emitted.svg).toContain("<text");
  });

  it("renders general-shadow fills without stroke and preserves even-odd shadow fill rule", () => {
    const source = String.raw`\begin{tikzpicture}[even odd rule]
  \draw[general shadow={fill=red}] (0,0) circle (.5) (0.5,0) circle (.5);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('data-shadow-layer="1"');
    expect(emitted.svg).toContain('stroke="none" fill="#ff0000" fill-rule="evenodd"');
    expect(emitted.svg).toContain(" Z M ");
  });

  it("emits explicit arrow tip paths from arrows= specifications and > shorthand defaults", () => {
    const source = String.raw`\begin{tikzpicture}[>=Stealth]
  \draw[arrows={-Latex[open,length=10pt,color=blue]}] (0,0) -- (2,0);
  \draw[>->] (0,1) -- (2,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('data-arrow-tip-kind="latex"');
    expect(emitted.svg).toContain('data-arrow-tip-kind="stealth"');
    expect(emitted.svg).toContain('data-arrow-side="start"');
    expect(emitted.svg).toContain('data-arrow-side="end"');
    expect(emitted.svg).toContain('data-arrow-bend="false"');
    expect(emitted.svg).not.toContain("<marker");
    expect(emitted.svg).not.toContain("marker-start=");
    expect(emitted.svg).not.toContain("marker-end=");
    expect(emitted.svg).toContain('stroke="#0000ff"');
  });

  it("avoids collapsing mixed >-Stealth tips and draws computer modern rightarrow as curved geometry", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->]        (0,0)   -- (1,0);
  \draw[>-Stealth] (0,0.3) -- (1,0.3);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    const secondPath = emitted.svg.match(/data-source-id="path:1" d="M ([0-9.\-]+) [0-9.\-]+ L ([0-9.\-]+) [0-9.\-]+"/);
    expect(secondPath).not.toBeNull();
    if (!secondPath) {
      return;
    }

    const startX = Number(secondPath[1]);
    const endX = Number(secondPath[2]);
    expect(endX - startX).toBeGreaterThan(20);
    expect(emitted.svg).toContain('data-arrow-tip-kind="cm-rightarrow"');
    expect(emitted.svg).toContain('data-arrow-tip-kind="stealth"');
    expect(emitted.svg).toContain('data-arrow-index="0"');
  });

  it("suppresses tip geometry on closed paths and when tips=never", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[<->] (0,0) -- (1,0) -- cycle;
  \draw[<->,tips=never] (0,1) -- (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).not.toContain("data-arrow-tip-kind=");
  });

  it("applies tips only to the last open subpath", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[<->] (0,0) -- (1,0) (2,0) -- (3,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    const tipPaths = emitted.svg.match(/data-arrow-tip-kind="[^"]+"/g) ?? [];
    const source0TipPaths = emitted.svg.match(/data-source-id="path:0" data-arrow-tip-kind=/g) ?? [];
    const startTips = emitted.svg.match(/data-arrow-side="start"/g) ?? [];
    const endTips = emitted.svg.match(/data-arrow-side="end"/g) ?? [];
    expect(tipPaths.length).toBe(2);
    expect(source0TipPaths.length).toBe(2);
    expect(startTips.length).toBe(1);
    expect(endTips.length).toBe(1);
  });

  it("shortens path geometry to accommodate arrow tips", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[arrows={Stealth-Stealth}] (0,0) -- (2,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    const linePath = emitted.svg.match(/data-source-id="path:0" d="M ([0-9.\-]+) [0-9.\-]+ L ([0-9.\-]+) [0-9.\-]+"/);
    expect(linePath).not.toBeNull();
    if (!linePath) {
      return;
    }

    const startX = Number(linePath[1]);
    const endX = Number(linePath[2]);
    expect(startX).toBeGreaterThan(0.5);
    expect(endX).toBeLessThan(55);
  });

  it("emits even-odd fill rule on compound fill paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill[even odd rule] (0,0) circle (.5cm) (0.5,0) circle (.5cm);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(semantic.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:even odd rule")).toBe(false);
    expect(emitted.svg).toContain('fill-rule="evenodd"');
    expect(emitted.svg).toContain("<path");
    expect(emitted.svg).toContain(" A ");
    expect(emitted.svg).not.toContain("<circle");
  });

  it("renders fill paths with named color flags as fill-only paint", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill [green] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('fill="#00ff00"');
    expect(emitted.svg).toContain('stroke="none"');
  });

  it("renders fill paths with xcolor mix flags as fill-only paint", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill [green!50!white] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('fill="#80ff80"');
    expect(emitted.svg).toContain('stroke="none"');
  });

  it("does not emit empty move-only path elements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm, y radius=.5cm];
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain("<ellipse");
    expect(emitted.svg).not.toContain('d="M ');
    expect(emitted.diagnostics).toHaveLength(0);
  });

  it("emits text color/opacity/alignment and multiline tspans for node text options", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[text=blue,text opacity=0.5,align=right,node contents={A\\B},draw] at (0,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain("<text");
    expect(emitted.svg).toContain('fill="#0000ff"');
    expect(emitted.svg).toContain('fill-opacity="0.5"');
    expect(emitted.svg).toContain('text-anchor="end"');
    expect(emitted.svg).toContain("<tspan");

    const semanticText = semantic.scene.elements.find((element) => element.kind === "Text");
    expect(semanticText?.kind).toBe("Text");
    const emittedTextX = Number(emitted.svg.match(/<text[^>]* x="([^"]+)"/)?.[1] ?? Number.NaN);
    expect(Number.isFinite(emittedTextX)).toBe(true);
    if (semanticText?.kind === "Text" && Number.isFinite(emittedTextX)) {
      expect(emittedTextX).toBeGreaterThan(semanticText.position.x);
    }
  });

  it("shifts multiline align-left text anchors to the left edge of the text block", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[align=left,node contents={This is a\\demonstration.},draw] at (0,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('text-anchor="start"');
    const semanticText = semantic.scene.elements.find((element) => element.kind === "Text");
    expect(semanticText?.kind).toBe("Text");
    const emittedTextX = Number(emitted.svg.match(/<text[^>]* x="([^"]+)"/)?.[1] ?? Number.NaN);
    expect(Number.isFinite(emittedTextX)).toBe(true);
    if (semanticText?.kind === "Text" && Number.isFinite(emittedTextX)) {
      expect(emittedTextX).toBeLessThan(semanticText.position.x);
    }
  });

  it("keeps node text black when only draw color is inherited", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill [fill=blue!50, draw=blue] (0,0) node [fill=red!50] {first node};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(semantic.scene.elements.some((element) => element.kind === "Text" && element.text === "first node")).toBe(true);
    expect(emitted.svg).toContain('fill="#000000"');
  });

  it("emits circle primitives for circle-shaped nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[circle,draw,minimum size=1cm] at (0,0) {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain("<circle");
  });

  it("wraps node text into multiple tspans when text width is set", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=1cm] at (0,0) {alpha beta gamma};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    const tspanCount = emitted.svg.match(/<tspan /g)?.length ?? 0;
    expect(tspanCount).toBeGreaterThan(1);
  });

  it("emits double-stroked circles as two layered SVG circles", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[circle,draw,double] at (0,0) {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    const circleCount = emitted.svg.match(/<circle /g)?.length ?? 0;
    expect(circleCount).toBe(2);
    expect(emitted.svg).toContain('stroke="#ffffff"');
  });

  it("emits italic font style and scaled font size for transform-shaped nodes", () => {
    const source = String.raw`\begin{tikzpicture}[scale=3,transform shape]
  \draw[node font=\itshape] (1,0) -- +(1,1) node[above] {italic};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('font-style="italic"');
    expect(emitted.svg).toContain('font-size="29.8879"');
  });

  it("emits rotated node text for scope rotation with transform shape", () => {
    const source = String.raw`\begin{tikzpicture}[rotate=40, transform shape]
  \draw (-0.5,3) rectangle (3.5,-0.5);
  \node at (0,2) {test};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toMatch(/<text[^>]*transform="rotate\(-40 [^\"]+\)"/);
  });

  it("rotates drawn node geometry together with node text", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,rotate=30] at (0,0) {C};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    const box = semantic.scene.elements.find(
      (element): element is Extract<(typeof semantic.scene.elements)[number], { kind: "Path" }> =>
        element.kind === "Path" && element.id.startsWith("scene-node-box:")
    );
    expect(box?.kind).toBe("Path");
    if (box?.kind === "Path") {
      const move = box.commands[0];
      const line = box.commands[1];
      expect(move?.kind).toBe("M");
      expect(line?.kind).toBe("L");
      if (move?.kind === "M" && line?.kind === "L") {
        expect(Math.abs(line.to.y - move.to.y)).toBeGreaterThan(1e-3);
      }
    }

    expect(emitted.svg).toMatch(/<text[^>]*transform="rotate\(-30 [^\"]+\)"/);
  });

  it("emits scaled font-size attributes for node font commands", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[font=\footnotesize] at (0,0) {small};
  \node[font=\pgfutil@font@Large\itshape] at (1,0) {large};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('font-size="7.9701"');
    expect(emitted.svg).toContain('font-size="14.3462"');
    expect(emitted.svg).toContain('font-style="italic"');
  });

  it("emits font family and weight attributes for extended font commands", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[font=\sffamily\bfseries] at (0,0) {sans bold};
  \node[font=\ttfamily\mdseries\upshape] at (1,0) {mono normal};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('font-family="CMU Sans Serif, Latin Modern Sans, Helvetica, Arial, sans-serif"');
    expect(emitted.svg).toContain('font-weight="700"');
    expect(emitted.svg).toContain('font-family="Latin Modern Mono, CMU Typewriter Text, Courier New, monospace"');
  });
});
