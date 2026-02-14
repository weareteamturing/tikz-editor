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
    expect(emitted.svg).toContain('opacity="0.8"');
    expect(emitted.svg).not.toContain("vector-effect=");
  });

  it("emits dash offsets and bar markers for |-| paths", () => {
    const source = String.raw`\begin{tikzpicture}[|-|,dash pattern=on 4pt off 2pt]
  \draw[dash phase=2pt] (0,0) -- (2,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const emitted = emitSvg(semantic.scene);

    expect(emitted.svg).toContain('stroke-dasharray="4 2"');
    expect(emitted.svg).toContain('stroke-dashoffset="2"');
    expect(emitted.svg).toContain('marker-start="url(#tikz-bar)"');
    expect(emitted.svg).toContain('marker-end="url(#tikz-bar)"');
    expect(emitted.svg).toContain('id="tikz-bar"');
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
});
