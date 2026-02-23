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

  it("supports naming controls, quoted node names, and node text overrides", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph [name=cluster, name separator=-] {
    "x,y" [as={X comma Y}] -> item;
    "x,y" -> item;
  };
  \path (cluster-x@u2C@y) edge (cluster-item);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-graph-syntax")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "graph-edge-without-start")).toBe(false);

    const texts = elementsOfKind(result.scene.elements, "Text").map((text) => text.text);
    const paths = elementsOfKind(result.scene.elements, "Path");

    expect(texts).toContain("X comma Y");
    expect(texts).toContain("item");
    expect(paths.length).toBeGreaterThanOrEqual(3);
  });

  it("supports fresh/use-existing/number-nodes controls", () => {
    const freshSource = String.raw`\begin{tikzpicture}
  \graph [fresh nodes] { a -> a -> a };
\end{tikzpicture}`;
    const freshResult = evaluateSemantic(freshSource);
    const freshTexts = elementsOfKind(freshResult.scene.elements, "Text").map((text) => text.text);
    expect(freshTexts.filter((text) => text === "a")).toHaveLength(3);

    const numberedSource = String.raw`\begin{tikzpicture}
  \graph [number nodes] { a -> a -> a };
\end{tikzpicture}`;
    const numberedResult = evaluateSemantic(numberedSource);
    const numberedTexts = elementsOfKind(numberedResult.scene.elements, "Text").map((text) => text.text);
    expect(numberedTexts.filter((text) => text === "a")).toHaveLength(3);

    const existingSource = String.raw`\begin{tikzpicture}
  \node (a) at (0,0) {A};
  \node (b) at (1,0) {B};
  \graph [use existing nodes] { a -> b };
\end{tikzpicture}`;
    const existingResult = evaluateSemantic(existingSource);
    const existingTexts = elementsOfKind(existingResult.scene.elements, "Text").map((text) => text.text);
    expect(existingResult.diagnostics.some((diagnostic) => diagnostic.code === "graph-edge-without-start")).toBe(false);
    expect(existingTexts.filter((text) => text === "a" || text === "b")).toHaveLength(0);
    expect(elementsOfKind(existingResult.scene.elements, "Path").length).toBeGreaterThanOrEqual(1);
  });

  it("handles simple-graph last-edge-wins semantics and edge removal with -!-", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph [simple] {
    a ->[red] b;
    a ->[blue] b;
    a -!- b;
    c -> d;
    d <-[green] c;
  };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-graph-syntax")).toBe(false);

    const edges = elementsOfKind(result.scene.elements, "Path");
    expect(edges).toHaveLength(1);
    expect(edges[0]?.style.stroke).toBe("#00ff00");
  });

  it("supports source/target edge style accumulation, clear shorthands, and directional edge labels", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph {
    a [source edge style=red] -> b [target edge style=blue];
    a -> b;
    b [clear >, clear <];
    a -> b;
    a -> c [>"into c"];
    c [<"from c"] -> d;
  };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-graph-syntax")).toBe(false);

    const edges = elementsOfKind(result.scene.elements, "Path");
    const edgeStrokes = edges.map((edge) => edge.style.stroke);
    expect(edgeStrokes).toContain("#0000ff");
    expect(edgeStrokes).toContain("#ff0000");

    const texts = elementsOfKind(result.scene.elements, "Text").map((text) => text.text);
    expect(texts).toContain("into c");
    expect(texts).toContain("from c");
  });

  it("supports put-node-text-on-incoming/outgoing-edges", () => {
    const incomingSource = String.raw`\begin{tikzpicture}
  \graph [put node text on incoming edges] { a -> b };
\end{tikzpicture}`;
    const incomingResult = evaluateSemantic(incomingSource);
    const incomingTexts = elementsOfKind(incomingResult.scene.elements, "Text").map((text) => text.text);
    expect(incomingTexts).toEqual(["b"]);

    const outgoingSource = String.raw`\begin{tikzpicture}
  \graph [put node text on outgoing edges] { a -> b };
\end{tikzpicture}`;
    const outgoingResult = evaluateSemantic(outgoingSource);
    const outgoingTexts = elementsOfKind(outgoingResult.scene.elements, "Text").map((text) => text.text);
    expect(outgoingTexts).toEqual(["a"]);
  });
});
