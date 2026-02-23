import { describe, expect, it } from "vitest";

import { evaluateSemantic, elementsOfKind } from "./helpers.js";

describe("semantic evaluator / graph operations", () => {
  it("renders graph command nodes and matching-and-star edges", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph [nodes={draw,circle}] { a -> b -> {c, d} };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-graph-syntax")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "graph-edge-without-start")).toBe(false);

    const labels = elementsOfKind(result.scene.elements, "Text");
    const edges = elementsOfKind(result.scene.elements, "Path");
    expect(labels.length).toBeGreaterThanOrEqual(4);
    expect(edges.length).toBeGreaterThanOrEqual(3);
  });

  it("supports graph as a path operation (`\\path graph ...`)", () => {
    const source = String.raw`\begin{tikzpicture}
  \path graph [nodes={draw}] { x -- y <- z };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-graph-syntax")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "graph-edge-without-start")).toBe(false);
    const labels = elementsOfKind(result.scene.elements, "Text");
    const edges = elementsOfKind(result.scene.elements, "Path");
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(edges.length).toBeGreaterThanOrEqual(2);
  });
});

