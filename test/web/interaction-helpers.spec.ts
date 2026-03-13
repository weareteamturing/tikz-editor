import { describe, expect, it } from "vitest";
import { PT_PER_CM } from "../../packages/core/src/edit/format.js";
import type { EditHandle } from "../../packages/core/src/semantic/types.js";
import { identityMatrix } from "../../packages/core/src/semantic/transform.js";
import {
  createBezierTemplateFromBend,
  resolveHandleIdForDrag,
  resolveBezierControlsFromBend,
  snapPointDeltaToAxisStepMultiples
} from "../../packages/app/src/ui/canvas-panel/interaction-helpers.js";

const cm = (value: number): number => value * PT_PER_CM;

type Point = { x: number; y: number };

function cubicMidpoint(p0: Point, p1: Point, p2: Point, p3: Point): Point {
  return {
    x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8,
    y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8
  };
}

function makePathPointHandle(
  id: string,
  sourceId: string,
  world: Point
): EditHandle {
  return {
    id,
    runtimeId: `runtime:${id}`,
    sourceRef: {
      sourceId,
      sourceSpan: { from: 0, to: 0 },
      sourceFingerprint: "fp"
    },
    kind: "path-point",
    world,
    transform: identityMatrix(),
    sourceText: "",
    coordinateForm: "cartesian",
    rewriteMode: "direct"
  };
}

describe("interaction-helpers bezier math", () => {
  it("yields straight one-third/two-third controls for zero bend", () => {
    const start = { x: cm(0), y: cm(0) };
    const end = { x: cm(3), y: cm(0) };
    const bend = { x: cm(1.5), y: cm(0) };

    const result = resolveBezierControlsFromBend(start, end, bend);
    expect(result.control1.x).toBeCloseTo(cm(1), 6);
    expect(result.control1.y).toBeCloseTo(cm(0), 6);
    expect(result.control2.x).toBeCloseTo(cm(2), 6);
    expect(result.control2.y).toBeCloseTo(cm(0), 6);
  });

  it("mirrors control offsets for opposite bend directions", () => {
    const start = { x: cm(0), y: cm(0) };
    const end = { x: cm(3), y: cm(0) };
    const bendUp = { x: cm(1.5), y: cm(1) };
    const bendDown = { x: cm(1.5), y: cm(-1) };

    const up = resolveBezierControlsFromBend(start, end, bendUp);
    const down = resolveBezierControlsFromBend(start, end, bendDown);

    expect(up.control1.x).toBeCloseTo(down.control1.x, 6);
    expect(up.control2.x).toBeCloseTo(down.control2.x, 6);
    expect(up.control1.y).toBeCloseTo(-down.control1.y, 6);
    expect(up.control2.y).toBeCloseTo(-down.control2.y, 6);
  });

  it("produces controls whose cubic midpoint matches the bend point", () => {
    const start = { x: cm(0), y: cm(0) };
    const end = { x: cm(4), y: cm(0) };
    const bend = { x: cm(2), y: cm(1.25) };

    const result = resolveBezierControlsFromBend(start, end, bend);
    const midpoint = cubicMidpoint(start, result.control1, result.control2, result.endWorld);

    expect(midpoint.x).toBeCloseTo(bend.x, 6);
    expect(midpoint.y).toBeCloseTo(bend.y, 6);
  });

  it("creates a bezier template with explicit controls", () => {
    const template = createBezierTemplateFromBend(
      { x: cm(0), y: cm(0) },
      { x: cm(3), y: cm(0) },
      { x: cm(1.5), y: cm(1) }
    );

    expect(template.kind).toBe("bezier");
    if (template.kind !== "bezier") {
      throw new Error("Expected bezier template.");
    }
    expect(template.control1).toBeDefined();
    expect(template.control2).toBeDefined();
    expect(template.to).toBeDefined();
  });
});

describe("interaction-helpers step snapping", () => {
  it("snaps point deltas to integer multiples per axis", () => {
    const snapped = snapPointDeltaToAxisStepMultiples(
      { x: 10, y: 20 },
      { x: 13.2, y: 26.1 },
      2,
      5
    );
    expect(snapped).toEqual({ x: 14, y: 25 });
  });

  it("keeps axis unchanged when step is non-positive", () => {
    const snapped = snapPointDeltaToAxisStepMultiples(
      { x: 10, y: 20 },
      { x: 13.2, y: 26.1 },
      0,
      -1
    );
    expect(snapped).toEqual({ x: 13.2, y: 26.1 });
  });
});

describe("resolveHandleIdForDrag", () => {
  it("rebinds to nearest same-kind handle when source ids are renumbered", () => {
    const drag: any = {
      kind: "handle",
      handleId: "old-handle",
      sourceId: "path:0",
      handleKind: "path-point",
      lastKnownWorld: { x: 10, y: 10 }
    };
    const handles: EditHandle[] = [
      makePathPointHandle("node-h", "path:0", { x: 200, y: 200 }),
      makePathPointHandle("line-h", "path:1", { x: 10.2, y: 9.8 })
    ];

    const resolved = resolveHandleIdForDrag(drag, handles);

    expect(resolved).toBe("line-h");
    expect(drag.handleId).toBe("line-h");
    expect(drag.sourceId).toBe("path:1");
  });
});
