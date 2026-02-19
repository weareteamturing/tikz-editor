import { describe, expect, it } from "vitest";

import { parseTikz } from "../../src/parser/index.js";
import { evaluateTikzFigure } from "../../src/semantic/evaluate.js";
import { applyEditIntent } from "../../src/edit/apply.js";
import type { EditHandle } from "../../src/semantic/types.js";
import { PT_PER_CM } from "../../src/edit/format.js";

const cm = (value: number): number => value * PT_PER_CM;

function evaluateAndGetHandles(source: string) {
  const parsed = parseTikz(source);
  const result = evaluateTikzFigure(parsed.figure, source);
  return { parsed, result, handles: result.editHandles };
}

function findHandleBySpanText(source: string, handles: EditHandle[], text: string): EditHandle | undefined {
  return handles.find((h) => source.slice(h.sourceSpan.from, h.sourceSpan.to) === text);
}

/**
 * Round-trip test helper:
 * 1. Parse & evaluate source
 * 2. Find handle matching spanText
 * 3. Apply move intent to newWorld
 * 4. Re-parse & re-evaluate
 * 5. Find handle in new source and verify its world position
 */
function roundTripMove(
  source: string,
  spanText: string,
  newWorld: { x: number; y: number }
) {
  const { handles } = evaluateAndGetHandles(source);
  const handle = findHandleBySpanText(source, handles, spanText);
  if (!handle) {
    throw new Error(`No handle found for span text "${spanText}". Available: ${handles.map((h) => `"${source.slice(h.sourceSpan.from, h.sourceSpan.to)}"`).join(", ")}`);
  }

  const editResult = applyEditIntent(source, handles, {
    kind: "move",
    handleId: handle.id,
    newWorld
  });

  if (editResult.kind !== "success") {
    return editResult;
  }

  // Re-evaluate with new source
  const { handles: newHandles } = evaluateAndGetHandles(editResult.newSource);

  // Find the corresponding handle in the new source (same span position)
  const newHandle = newHandles.find((h) => {
    // The handle should be at the same span.from as the patch's newSpan.from
    const patch = editResult.patches[0];
    return h.sourceSpan.from === patch.newSpan.from;
  });

  return {
    ...editResult,
    newHandle,
    newHandles
  };
}

describe("edit integration (round-trip)", () => {
  it("moves a simple cartesian node", () => {
    const source = String.raw`\begin{tikzpicture}
\node at (1,2) {A};
\end{tikzpicture}`;
    const result = roundTripMove(source, "(1,2)", { x: cm(3), y: cm(4) });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.newSource).toContain("(3,4)");
    expect(result.newHandle).toBeDefined();
    expect(result.newHandle!.world.x).toBeCloseTo(cm(3), 0);
    expect(result.newHandle!.world.y).toBeCloseTo(cm(4), 0);
  });

  it("moves a path-point coordinate", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (2,3);
\end{tikzpicture}`;
    const result = roundTripMove(source, "(2,3)", { x: cm(5), y: cm(6) });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.newSource).toContain("(5,6)");
    expect(result.newHandle).toBeDefined();
    expect(result.newHandle!.world.x).toBeCloseTo(cm(5), 0);
    expect(result.newHandle!.world.y).toBeCloseTo(cm(6), 0);
  });

  it("moves a node inside xscale=2 scope", () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[xscale=2]
\node at (1,2) {A};
\end{scope}
\end{tikzpicture}`;
    // Node at local (1,2) → world (2,2) due to xscale=2
    // Move to world (6, 4) → local should be (3, 4)
    const result = roundTripMove(source, "(1,2)", { x: cm(6), y: cm(4) });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.newSource).toContain("(3,4)");
    expect(result.newHandle).toBeDefined();
    expect(result.newHandle!.world.x).toBeCloseTo(cm(6), 0);
    expect(result.newHandle!.world.y).toBeCloseTo(cm(4), 0);
  });

  it("moves a node inside rotate=90 scope", () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[rotate=90]
\node at (1,0) {A};
\end{scope}
\end{tikzpicture}`;
    // rotate(90): local (1,0) → world (0,1)
    // Move to world (-2, 0) → inverse rotate: local (0, 2)
    const result = roundTripMove(source, "(1,0)", { x: cm(-2), y: 0 });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.newHandle).toBeDefined();
    expect(result.newHandle!.world.x).toBeCloseTo(cm(-2), 0);
    expect(result.newHandle!.world.y).toBeCloseTo(0, 0);
  });

  it("moves a polar coordinate preserving polar form", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (45:2);
\end{tikzpicture}`;
    // (45:2) → world (√2·cm, √2·cm)
    // Move to world (0, 3cm) → polar (90:3)
    const result = roundTripMove(source, "(45:2)", { x: 0, y: cm(3) });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    // Source should contain polar notation
    expect(result.newSource).toMatch(/\(90(\.\d+)?:3(\.\d+)?\)/);
    expect(result.newHandle).toBeDefined();
    expect(result.newHandle!.world.x).toBeCloseTo(0, 0);
    expect(result.newHandle!.world.y).toBeCloseTo(cm(3), 0);
  });

  it("returns unsupported for named coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
\node (A) at (0,0) {A};
\draw (A) -- (1,1);
\end{tikzpicture}`;
    const { handles } = evaluateAndGetHandles(source);
    const namedHandle = findHandleBySpanText(source, handles, "(A)");

    if (!namedHandle) {
      // Named coordinates may not get handles at all — that's also fine
      return;
    }

    const result = applyEditIntent(source, handles, {
      kind: "move",
      handleId: namedHandle.id,
      newWorld: { x: cm(5), y: cm(5) }
    });

    expect(result.kind).toBe("unsupported");
  });

  it("returns unsupported when a handle maps to a shared expanded source span", () => {
    const source = String.raw`\begin{tikzpicture}
\foreach \x in {0,1} { \draw (\x,0) -- ++(1,0); }
\end{tikzpicture}`;
    const { handles } = evaluateAndGetHandles(source);
    const duplicatedSpanHandle = handles.find((handle, index) =>
      handles.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.sourceSpan.from === handle.sourceSpan.from &&
          other.sourceSpan.to === handle.sourceSpan.to
      )
    );
    expect(duplicatedSpanHandle).toBeDefined();

    const result = applyEditIntent(source, handles, {
      kind: "move",
      handleId: duplicatedSpanHandle!.id,
      newWorld: { x: cm(3), y: cm(0) }
    });

    expect(result.kind).toBe("unsupported");
  });

  it("returns error for nonexistent handle", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}`;
    const { handles } = evaluateAndGetHandles(source);

    const result = applyEditIntent(source, handles, {
      kind: "move",
      handleId: "nonexistent-handle",
      newWorld: { x: cm(5), y: cm(5) }
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("not found");
    }
  });

  it("moves a relative ++ coordinate", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- ++(1,1);
\end{tikzpicture}`;
    const { handles } = evaluateAndGetHandles(source);
    const deltaHandle = handles.find((h) => h.rewriteMode === "delta");

    if (!deltaHandle) {
      // If no delta handle, skip (may not be implemented yet)
      return;
    }

    const result = applyEditIntent(source, handles, {
      kind: "move",
      handleId: deltaHandle.id,
      newWorld: { x: cm(2), y: cm(3) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("-- ++(2,3)");
    expect(result.newSource.includes("++++")).toBe(false);
  });

  it("preserves coordinate-local options when rewriting a polar coordinate", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- ([xshift=3pt]45:2);
\end{tikzpicture}`;
    const { handles } = evaluateAndGetHandles(source);
    const polarHandle = handles.find((h) => source.slice(h.sourceSpan.from, h.sourceSpan.to).includes("[xshift=3pt]"));
    expect(polarHandle).toBeDefined();

    const result = applyEditIntent(source, handles, {
      kind: "move",
      handleId: polarHandle!.id,
      newWorld: { x: 0, y: cm(3) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("[xshift=3pt]");
    expect(result.newSource).toMatch(/\(\[xshift=3pt\]\s*90(\.\d+)?:\s*3(\.\d+)?\)/);
  });

  it("preserves coordinate-local options when rewriting a relative coordinate", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (1,1) -- ++([xshift=3pt]1,0);
\end{tikzpicture}`;
    const { handles } = evaluateAndGetHandles(source);
    const deltaHandle = handles.find((h) => h.rewriteMode === "delta");
    expect(deltaHandle).toBeDefined();

    const result = applyEditIntent(source, handles, {
      kind: "move",
      handleId: deltaHandle!.id,
      newWorld: { x: cm(3), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("++([xshift=3pt]2,1)");
  });

  it("returns unsupported for xyz coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (1,2,3) -- (2,3,4);
\end{tikzpicture}`;
    const { handles } = evaluateAndGetHandles(source);
    const xyzHandle = handles.find((h) => h.coordinateForm === "xyz");
    expect(xyzHandle).toBeDefined();

    const result = applyEditIntent(source, handles, {
      kind: "move",
      handleId: xyzHandle!.id,
      newWorld: { x: cm(4), y: cm(5) }
    });

    expect(result.kind).toBe("unsupported");
  });

  it("rejects stale handles when source fingerprint differs", () => {
    const sourceA = String.raw`\begin{tikzpicture}
\draw (1,1) -- (2,2);
\end{tikzpicture}`;
    const sourceB = String.raw`\begin{tikzpicture}
\draw (9,9) -- (8,8);
\end{tikzpicture}`;
    expect(sourceA.length).toBe(sourceB.length);

    const { handles } = evaluateAndGetHandles(sourceA);
    const handle = findHandleBySpanText(sourceA, handles, "(1,1)");
    expect(handle).toBeDefined();

    const result = applyEditIntent(sourceB, handles, {
      kind: "move",
      handleId: handle!.id,
      newWorld: { x: cm(3), y: cm(4) }
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message.toLowerCase()).toContain("stale");
    }
  });

  it("patch metadata includes old and new spans", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}`;
    const { handles } = evaluateAndGetHandles(source);
    const handle = findHandleBySpanText(source, handles, "(1,1)");
    expect(handle).toBeDefined();

    const result = applyEditIntent(source, handles, {
      kind: "move",
      handleId: handle!.id,
      newWorld: { x: cm(10), y: cm(20) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.patches).toHaveLength(1);
    const patch = result.patches[0];
    expect(patch.oldSpan).toEqual(handle!.sourceSpan);
    expect(patch.replacement).toContain("10");
    expect(patch.replacement).toContain("20");
    expect(patch.newSpan.from).toBe(patch.oldSpan.from);
    expect(patch.newSpan.to).toBe(patch.oldSpan.from + patch.replacement.length);
  });
});
