import { describe, expect, it } from "vitest";
import {
  generateElementSource,
  insertElementIntoSource
} from "../src/edit/element-templates.js";
import { PT_PER_CM } from "../src/edit/format.js";

const cm = (value: number) => value * PT_PER_CM;

describe("element templates", () => {
  it("generates a node snippet at a world-space position", () => {
    const snippet = generateElementSource(
      { kind: "node", text: "Hello" },
      { x: cm(1.5), y: cm(-2) }
    );
    expect(snippet).toBe("\\node at (1.5,-2) {Hello};");
  });

  it("generates a drag-aware arrow line snippet", () => {
    const snippet = generateElementSource(
      { kind: "line", hasArrow: true, to: { x: cm(3), y: cm(4) } },
      { x: cm(1), y: cm(2) }
    );
    expect(snippet).toBe("\\draw[->] (1,2) -- (3,4);");
  });

  it("generates a circle snippet with explicit cm radius", () => {
    const snippet = generateElementSource(
      { kind: "circle", edge: { x: cm(1.5), y: cm(1) } },
      { x: cm(1), y: cm(1) }
    );
    expect(snippet).toBe("\\draw (1,1) circle (0.5cm);");
  });
});

describe("insertElementIntoSource", () => {
  it("inserts a snippet before \\end{tikzpicture} using body indentation", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const next = insertElementIntoSource(source, "\\node at (2,2) {A};");

    expect(next).toBe(String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \node at (2,2) {A};
\end{tikzpicture}`);
  });

  it("appends when source has no tikzpicture environment", () => {
    const source = "\\draw (0,0) -- (1,0);";
    const next = insertElementIntoSource(source, "\\node at (0,0) {n};");
    expect(next).toBe("\\draw (0,0) -- (1,0);\n\\node at (0,0) {n};");
  });
});
