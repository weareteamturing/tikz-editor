import { describe, expect, it } from "vitest";

import { parseTikz } from "../src/parser/index.js";
import { evaluateTikzFigure } from "../src/semantic/evaluate.js";

const PT_PER_CM = 72.27 / 2.54;
const cm = (value: number): number => value * PT_PER_CM;

function evaluate(source: string) {
  const parsed = parseTikz(source);
  return evaluateTikzFigure(parsed.figure, source);
}

describe("edit handles", () => {
  it("basic cartesian: two handles with direct rewrite mode", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (1,2) -- (3,4);
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.editHandles).toHaveLength(2);

    const [h0, h1] = result.editHandles;
    expect(h0.kind).toBe("path-point");
    expect(h0.rewriteMode).toBe("direct");
    expect(h0.coordinateForm).toBe("cartesian");
    expect(h0.world.x).toBeCloseTo(cm(1));
    expect(h0.world.y).toBeCloseTo(cm(2));
    expect(h0.local?.x).toBeCloseTo(cm(1));
    expect(h0.local?.y).toBeCloseTo(cm(2));

    expect(h1.kind).toBe("path-point");
    expect(h1.rewriteMode).toBe("direct");
    expect(h1.world.x).toBeCloseTo(cm(3));
    expect(h1.world.y).toBeCloseTo(cm(4));
  });

  it("to operation target emits a path-point handle", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) to (1,1);
\end{tikzpicture}`;
    const result = evaluate(source);
    const pathHandles = result.editHandles.filter((h) => h.kind === "path-point");
    expect(pathHandles).toHaveLength(2);

    const target = pathHandles.find((h) => source.slice(h.sourceSpan.from, h.sourceSpan.to) === "(1,1)");
    expect(target).toBeDefined();
    expect(target?.rewriteMode).toBe("direct");
    expect(target?.world.x).toBeCloseTo(cm(1));
    expect(target?.world.y).toBeCloseTo(cm(1));
  });

  it("with transform: local is pre-transform, world is rotated", () => {
    const source = String.raw`\begin{tikzpicture}
\draw[rotate=90] (1,0) -- (0,1);
\end{tikzpicture}`;
    const result = evaluate(source);
    // Two path-point handles
    expect(result.editHandles).toHaveLength(2);

    const [h0, h1] = result.editHandles;

    // (1,0) rotated 90° → (0,1)
    expect(h0.local?.x).toBeCloseTo(cm(1));
    expect(h0.local?.y).toBeCloseTo(0);
    expect(h0.world.x).toBeCloseTo(0);
    expect(h0.world.y).toBeCloseTo(cm(1));
    expect(h0.rewriteMode).toBe("direct");

    // (0,1) rotated 90° → (-1,0)
    expect(h1.local?.x).toBeCloseTo(0);
    expect(h1.local?.y).toBeCloseTo(cm(1));
    expect(h1.world.x).toBeCloseTo(cm(-1));
    expect(h1.world.y).toBeCloseTo(0);
  });

  it("relative: second handle has delta rewrite mode with relativePrefix", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (1,2) -- ++(1,0);
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.editHandles).toHaveLength(2);

    const [h0, h1] = result.editHandles;
    expect(h0.rewriteMode).toBe("direct");
    expect(h0.relativePrefix).toBeUndefined();

    expect(h1.rewriteMode).toBe("delta");
    expect(h1.relativePrefix).toBe("++");
    // world is (1,2) + (1,0) = (2,2)
    expect(h1.world.x).toBeCloseTo(cm(2));
    expect(h1.world.y).toBeCloseTo(cm(2));
    // local is the delta vector (1,0)
    expect(h1.local?.x).toBeCloseTo(cm(1));
    expect(h1.local?.y).toBeCloseTo(0);
    // relativeBaseWorld is the current point at time of evaluation = (1,2)
    expect(h1.relativeBaseWorld?.x).toBeCloseTo(cm(1));
    expect(h1.relativeBaseWorld?.y).toBeCloseTo(cm(2));
  });

  it("named: handles with unsupported rewrite mode", () => {
    const source = String.raw`\begin{tikzpicture}
\path coordinate (A) at (2,3);
\draw (A) -- (B);
\end{tikzpicture}`;
    const result = evaluate(source);
    // (A) resolves, (B) does not — only one path-point handle for (A)
    const pathHandles = result.editHandles.filter((h) => h.kind === "path-point");
    expect(pathHandles.length).toBeGreaterThanOrEqual(1);
    const namedHandle = pathHandles.find((h) => h.coordinateForm === "named");
    expect(namedHandle).toBeDefined();
    expect(namedHandle?.rewriteMode).toBe("unsupported");
    expect(namedHandle?.world.x).toBeCloseTo(cm(2));
    expect(namedHandle?.world.y).toBeCloseTo(cm(3));
  });

  it("node position: handle with node-position kind", () => {
    const source = String.raw`\begin{tikzpicture}
\node at (2,3) {text};
\end{tikzpicture}`;
    const result = evaluate(source);
    const nodeHandles = result.editHandles.filter((h) => h.kind === "node-position");
    expect(nodeHandles).toHaveLength(1);
    const h = nodeHandles[0];
    expect(h.rewriteMode).toBe("direct");
    expect(h.world.x).toBeCloseTo(cm(2));
    expect(h.world.y).toBeCloseTo(cm(3));
  });

  it("polar: handle with polar coordinateForm and direct rewrite", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (45:2);
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.editHandles).toHaveLength(2);
    const polarHandle = result.editHandles.find((h) => h.coordinateForm === "polar");
    expect(polarHandle).toBeDefined();
    expect(polarHandle?.rewriteMode).toBe("direct");
    // 45° at radius 2 → (√2, √2) ≈ (1.414, 1.414)
    expect(polarHandle?.world.x).toBeCloseTo(cm(Math.SQRT2));
    expect(polarHandle?.world.y).toBeCloseTo(cm(Math.SQRT2));
  });

  it("source span accuracy: spans point to correct positions", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (1,2) -- (3,4);
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.editHandles).toHaveLength(2);

    for (const handle of result.editHandles) {
      // Span from/to should be within the source string
      expect(handle.sourceSpan.from).toBeGreaterThanOrEqual(0);
      expect(handle.sourceSpan.to).toBeGreaterThan(handle.sourceSpan.from);
      expect(handle.sourceSpan.to).toBeLessThanOrEqual(source.length);

      // The text within the span should be a coordinate like "(1,2)"
      const spanText = source.slice(handle.sourceSpan.from, handle.sourceSpan.to);
      expect(spanText).toMatch(/\(\s*[\d.,]+\s*,\s*[\d.,]+\s*\)/);
    }
  });

  it("nested scope transforms: transform is composed from scope and draw options", () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[xshift=1cm]
\draw[rotate=90] (1,0);
\end{scope}
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.editHandles).toHaveLength(1);
    const h = result.editHandles[0];
    // local is (1,0), rotated 90° → (0,1), then xshift=1cm → (1,1) in world coords
    // 1cm in the coordinate system units
    expect(h.local?.x).toBeCloseTo(cm(1));
    expect(h.local?.y).toBeCloseTo(0);
    expect(h.world.x).toBeCloseTo(cm(1)); // 0 + xshift(1cm)
    expect(h.world.y).toBeCloseTo(cm(1)); // 1cm from rotation
    expect(h.rewriteMode).toBe("direct");
  });

  it("assigns unique handle ids for repeated source spans (e.g. foreach expansion)", () => {
    const source = String.raw`\begin{tikzpicture}
\foreach \x in {0,1,2} { \draw (\x,0) -- ++(1,0); }
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.editHandles.length).toBeGreaterThan(1);
    const ids = result.editHandles.map((handle) => handle.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
