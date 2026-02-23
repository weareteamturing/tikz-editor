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

  it("expands predefined subgraph forms (I_n, K_n, K_nm, P_n, C_n, Grid_n)", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph {
    subgraph I_n [n=4, name=I];
    subgraph K_n [n=4, name=K];
    subgraph K_nm [V={u,v}, W={x,y,z}, name=B];
    subgraph P_n [n=4, name=P];
    subgraph C_n [n=4, name=C];
    subgraph Grid_n [n=4, wrap after=2, name=G];
  };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-graph-syntax")).toBe(false);

    const texts = elementsOfKind(result.scene.elements, "Text");
    const edges = elementsOfKind(result.scene.elements, "Path");
    expect(texts.length).toBeGreaterThanOrEqual(4 + 4 + 5 + 4 + 4 + 4);
    expect(edges.length).toBeGreaterThanOrEqual(6 + 6 + 3 + 4 + 4);
  });

  it("supports join-operator keys on edge specifications", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph {
    {a,b} ->[complete bipartite] {c,d,e};
    {m,n,o} ->[matching] {p,q};
    {r,s,t} ->[matching and star] {u,v};
  };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-graph-syntax")).toBe(false);
    const edges = elementsOfKind(result.scene.elements, "Path");
    expect(edges.length).toBeGreaterThanOrEqual(6 + 2 + 3);
  });

  it("supports color classes and source/target color controls for operators", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph [color class=red, color class=green] {
    [complete bipartite={red}{green}]
    a [red], b [red], c [green], d [green, not green];
  };
  \graph { a0 -> { b [not source], c, d [not target] } -> e0 };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-graph-syntax")).toBe(false);

    const texts = elementsOfKind(result.scene.elements, "Text").map((text) => text.text);
    expect(texts).toContain("a");
    expect(texts).toContain("e0");

    const edges = elementsOfKind(result.scene.elements, "Path");
    expect(edges.length).toBeGreaterThanOrEqual(2 + 4);
  });

  it("supports I_nm numeric shorthands with shore naming", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph { subgraph I_nm [n=2, m=2] };
  \path (V 1) edge (W 2);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "graph-edge-without-start")).toBe(false);
    const edges = elementsOfKind(result.scene.elements, "Path");
    expect(edges.length).toBeGreaterThanOrEqual(1);
  });

  it("reports unsupported subgraph macros without creating fallback nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph { subgraph Unknown_n [n=3] };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-graph-syntax")).toBe(true);
    const texts = elementsOfKind(result.scene.elements, "Text").map((text) => text.text);
    expect(texts).not.toContain("subgraph Unknown_n");
  });

  it("keeps graph edge paint order before node paint output", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph [nodes={draw,circle}] { a -> b };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const kinds = result.scene.elements.map((element) => element.kind);
    const firstPathIndex = kinds.indexOf("Path");
    const firstCircleIndex = kinds.indexOf("Circle");
    const firstTextIndex = kinds.indexOf("Text");

    expect(firstPathIndex).toBeGreaterThanOrEqual(0);
    expect(firstCircleIndex).toBeGreaterThan(firstPathIndex);
    expect(firstTextIndex).toBeGreaterThan(firstPathIndex);
  });

  it("keeps edge-label placement stable for repeated same-geometry graph edges", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph {
    a -> b [>"L1"];
    b [clear >];
    a -> b [>"L2"];
  };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const labels = elementsOfKind(result.scene.elements, "Text").filter((text) => text.text === "L1" || text.text === "L2");
    expect(labels).toHaveLength(2);
    const first = labels[0];
    const second = labels[1];
    if (!first || !second) {
      return;
    }

    expect(first.position.x).toBeCloseTo(second.position.x, 3);
    expect(first.position.y).toBeCloseTo(second.position.y, 3);
  });

  it("supports no-placement with graph-local x/y coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph [no placement] {
    a [x=0, y=0] -> b [x=1, y=0] -> c [x=1, y=1]
  };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const textByLabel = new Map(elementsOfKind(result.scene.elements, "Text").map((text) => [text.text, text]));

    const a = textByLabel.get("a");
    const b = textByLabel.get("b");
    const c = textByLabel.get("c");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    if (!a || !b || !c) {
      return;
    }

    expect(b.position.x).toBeGreaterThan(a.position.x + 20);
    expect(Math.abs(b.position.y - a.position.y)).toBeLessThan(1);
    expect(c.position.y).toBeGreaterThan(b.position.y + 20);
  });

  it("supports cartesian grow/branch placement controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph [grow right=5mm, branch down=4mm] { a -> { b, c } };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const textByLabel = new Map(elementsOfKind(result.scene.elements, "Text").map((text) => [text.text, text]));

    const a = textByLabel.get("a");
    const b = textByLabel.get("b");
    const c = textByLabel.get("c");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    if (!a || !b || !c) {
      return;
    }

    expect(b.position.x).toBeGreaterThan(a.position.x + 5);
    expect(Math.abs(c.position.x - b.position.x)).toBeLessThan(1);
    expect(c.position.y).toBeLessThan(b.position.y - 5);
  });

  it("supports grid placement with wrap-after columns", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph [grid placement, n=6, wrap after=3] { a, b, c, d, e, f };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const textByLabel = new Map(elementsOfKind(result.scene.elements, "Text").map((text) => [text.text, text]));

    const a = textByLabel.get("a");
    const d = textByLabel.get("d");
    expect(a).toBeDefined();
    expect(d).toBeDefined();
    if (!a || !d) {
      return;
    }

    expect(Math.abs(d.position.x - a.position.x)).toBeLessThan(1);
    expect(d.position.y).toBeLessThan(a.position.y - 5);
  });

  it("supports clockwise and counterclockwise circular placement", () => {
    const clockwiseSource = String.raw`\begin{tikzpicture}
  \graph [clockwise=4, radius=1cm] { a, b, c, d };
\end{tikzpicture}`;
    const clockwiseResult = evaluateSemantic(clockwiseSource);
    const clockwiseText = new Map(elementsOfKind(clockwiseResult.scene.elements, "Text").map((text) => [text.text, text]));
    const clockwiseA = clockwiseText.get("a");
    const clockwiseB = clockwiseText.get("b");
    expect(clockwiseA).toBeDefined();
    expect(clockwiseB).toBeDefined();
    if (!clockwiseA || !clockwiseB) {
      return;
    }
    expect(clockwiseB.position.x).toBeGreaterThan(clockwiseA.position.x + 5);

    const counterSource = String.raw`\begin{tikzpicture}
  \graph [counterclockwise=4, radius=1cm] { a, b, c, d };
\end{tikzpicture}`;
    const counterResult = evaluateSemantic(counterSource);
    const counterText = new Map(elementsOfKind(counterResult.scene.elements, "Text").map((text) => [text.text, text]));
    const counterA = counterText.get("a");
    const counterB = counterText.get("b");
    expect(counterA).toBeDefined();
    expect(counterB).toBeDefined();
    if (!counterA || !counterB) {
      return;
    }
    expect(counterB.position.x).toBeLessThan(counterA.position.x - 5);
  });

  it("supports level style keys for placement controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph [no placement, level 2/.style={x=1}] { a -> { b, c } };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const textByLabel = new Map(elementsOfKind(result.scene.elements, "Text").map((text) => [text.text, text]));

    const a = textByLabel.get("a");
    const b = textByLabel.get("b");
    const c = textByLabel.get("c");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    if (!a || !b || !c) {
      return;
    }

    expect(b.position.x).toBeGreaterThan(a.position.x + 20);
    expect(c.position.x).toBeGreaterThan(a.position.x + 20);
  });

  it("supports grow/branch sep spacing refinement controls", () => {
    const regularSource = String.raw`\begin{tikzpicture}
  \graph [grow right] { a -> b -> c };
\end{tikzpicture}`;
    const regular = evaluateSemantic(regularSource);
    const regularText = new Map(elementsOfKind(regular.scene.elements, "Text").map((text) => [text.text, text]));
    const regularA = regularText.get("a");
    const regularB = regularText.get("b");
    expect(regularA).toBeDefined();
    expect(regularB).toBeDefined();
    if (!regularA || !regularB) {
      return;
    }
    const regularDx = regularB.position.x - regularA.position.x;

    const sepSource = String.raw`\begin{tikzpicture}
  \graph [grow right sep=2cm] { a -> b -> c };
\end{tikzpicture}`;
    const sep = evaluateSemantic(sepSource);
    const sepText = new Map(elementsOfKind(sep.scene.elements, "Text").map((text) => [text.text, text]));
    const sepA = sepText.get("a");
    const sepB = sepText.get("b");
    expect(sepA).toBeDefined();
    expect(sepB).toBeDefined();
    if (!sepA || !sepB) {
      return;
    }
    const sepDx = sepB.position.x - sepA.position.x;

    expect(sepDx).toBeGreaterThan(regularDx + 10);
  });

  it("makes sep spacing depend on measured node size", () => {
    const shortSource = String.raw`\begin{tikzpicture}
  \graph [grow right sep] { a -> b };
\end{tikzpicture}`;
    const shortResult = evaluateSemantic(shortSource);
    const shortText = new Map(elementsOfKind(shortResult.scene.elements, "Text").map((text) => [text.text, text]));
    const shortA = shortText.get("a");
    const shortB = shortText.get("b");
    expect(shortA).toBeDefined();
    expect(shortB).toBeDefined();
    if (!shortA || !shortB) {
      return;
    }
    const shortDx = shortB.position.x - shortA.position.x;

    const longSource = String.raw`\begin{tikzpicture}
  \graph [grow right sep] { veryverylonglabel -> b };
\end{tikzpicture}`;
    const longResult = evaluateSemantic(longSource);
    const longText = new Map(elementsOfKind(longResult.scene.elements, "Text").map((text) => [text.text, text]));
    const longA = longText.get("veryverylonglabel");
    const longB = longText.get("b");
    expect(longA).toBeDefined();
    expect(longB).toBeDefined();
    if (!longA || !longB) {
      return;
    }
    const longDx = longB.position.x - longA.position.x;

    expect(longDx).toBeGreaterThan(shortDx + 20);
  });
});
