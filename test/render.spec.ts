import { describe, expect, it } from "vitest";

import { renderTikzToSvg, renderTikzToSvgAsync } from "../src/render/index.js";

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

  it("renders node text through MathJax in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm] at (0,0) {Hello \textit{World}};
\end{tikzpicture}`;

    const result = await renderTikzToSvgAsync(source);

    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
  });

  it("reports invalid node TeX as parser errors while preserving rendering", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A_};
\end{tikzpicture}`;

    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(true);
    expect(result.svg.svg).toContain("<svg");
    expect(result.semantic.scene.elements.length).toBeGreaterThan(0);
  });

  it("uses measured parbox heights for text width wrapping in async mode", async () => {
    const narrow = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=1cm] at (0,0) {alpha beta gamma delta epsilon};
\end{tikzpicture}`);
    const wide = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=3cm] at (0,0) {alpha beta gamma delta epsilon};
\end{tikzpicture}`);

    const narrowText = narrow.semantic.scene.elements.find((element) => element.kind === "Text");
    const wideText = wide.semantic.scene.elements.find((element) => element.kind === "Text");
    expect(narrowText?.kind).toBe("Text");
    expect(wideText?.kind).toBe("Text");
    if (narrowText?.kind === "Text" && wideText?.kind === "Text") {
      expect((narrowText.textBlockHeight ?? 0)).toBeGreaterThan(wideText.textBlockHeight ?? 0);
    }
  });

  it("preserves node font italic styling through MathJax wrappers in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[node font=\itshape] (0,0) -- +(1,0) node[above] {italic};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    expect(result.svg.svg).toContain("\\textit");
  });

  it("renders foreach \\textsf labels through MathJax in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \label in {1,2,3}
    \node at (\label,0) {\textsf{\label}};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    expect(result.svg.svg.includes('xml:space="preserve">\\textsf{')).toBe(false);
    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
  });

  it("expands user-defined text macros before MathJax rendering in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \def\labelmacro{\textsf{A}}
  \node at (0,0) {$\labelmacro$};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    const label = result.semantic.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.text).toBe(String.raw`$\textsf{A}$`);
    }
  });

  it("expands fixed-arity newcommand macros before MathJax rendering in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\vect}[1]{\mathbf{#1}}
  \node at (0,0) {$\vect{x}$};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    const label = result.semantic.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.text).toBe(String.raw`$\mathbf{x}$`);
    }
  });

  it("expands newcommand optional/default arguments before MathJax rendering in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\pair}[2][\alpha]{#1+#2}
  \node at (0,0) {$\pair{x}$};
  \node at (1,0) {$\pair[\beta]{x}$};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    const labels = result.semantic.scene.elements
      .filter((element) => element.kind === "Text")
      .map((element) => (element.kind === "Text" ? element.text : ""));
    expect(labels).toContain(String.raw`$\alpha+x$`);
    expect(labels).toContain(String.raw`$\beta+x$`);
  });

  it("keeps math control sequence boundaries after foreach substitution in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {a}
    \foreach \y in {b}
      \node at (0,0) {$\mathstrut\x\y$};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    expect(result.svg.svg.includes('xml:space="preserve">$\\mathstrut')).toBe(false);
    const label = result.semantic.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.text).toBe(String.raw`$\mathstrut{}ab$`);
    }
  });
});
