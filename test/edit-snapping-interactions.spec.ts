import { describe, expect, it } from "vitest";
import type { SceneCircle, SceneElement } from "../src/semantic/types.js";
import {
  buildSnapContext,
  selectionSnapPointsFromBounds,
  snapHandlePosition,
  snapSelectionTranslation,
  snapToolPointer
} from "../src/edit/snapping/index.js";

function makeCircle(sourceId: string, centerX: number, centerY: number, radius: number): SceneElement {
  const circle: SceneCircle = {
    kind: "Circle",
    id: `circle:${sourceId}`,
    sourceId,
    sourceSpan: { from: 0, to: 0 },
    style: {} as SceneCircle["style"],
    styleChain: [],
    center: { x: centerX, y: centerY },
    radius
  };

  return circle;
}

function selection(minX: number, minY: number, maxX: number, maxY: number) {
  const bounds = { minX, minY, maxX, maxY };
  return {
    bounds,
    snapPoints: selectionSnapPointsFromBounds(bounds)
  };
}

describe("snapping interaction wrappers", () => {
  it("returns snapped selection delta for element drag", () => {
    const scene = [makeCircle("ref", 30, 30, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: ["moving"],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const result = snapSelectionTranslation({
      context,
      selection: selection(15, 15, 25, 25),
      rawDelta: { x: 4, y: 4 }
    });

    expect(result.snappedDelta).toEqual({ x: 5, y: 5 });
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it("returns snapped world position for handle drag", () => {
    const scene = [makeCircle("ref", 20, 20, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const result = snapHandlePosition({
      context,
      point: { x: 19.5, y: 20.5 }
    });

    expect(result.snappedPoint?.x).toBeCloseTo(20, 6);
    expect(result.snappedPoint?.y).toBeCloseTo(20, 6);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it("snaps add-node pointer placement", () => {
    const scene = [makeCircle("ref", 12, 9, 3)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const result = snapToolPointer({
      context,
      pointer: { x: 11.4, y: 9.3 },
      kind: "node"
    });

    expect(result.snappedPoint?.x).toBeCloseTo(12, 6);
    expect(result.snappedPoint?.y).toBeCloseTo(9, 6);
  });

  it("snaps rectangle and circle creation drag pointers", () => {
    const scene = [makeCircle("ref", 20, 5, 5)]; // bounds corner around (15,0) and (25,10)
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false } }
    });

    const rect = snapToolPointer({
      context,
      pointer: { x: 14, y: 9 },
      kind: "rect-corner",
      anchor: { x: 0, y: 0 }
    });
    const circle = snapToolPointer({
      context,
      pointer: { x: 14, y: 9 },
      kind: "circle-edge",
      anchor: { x: 0, y: 0 }
    });

    expect(rect.snappedPoint?.x).toBeCloseTo(15, 6);
    expect(rect.snappedPoint?.y).toBeCloseTo(10, 6);
    expect(circle.snappedPoint?.x).toBeCloseTo(15, 6);
    expect(circle.snappedPoint?.y).toBeCloseTo(10, 6);
  });

  it("snaps anchored shape pointer even when anchor is already aligned", () => {
    const scene = [makeCircle("ref", 0, 0, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const rect = snapToolPointer({
      context,
      pointer: { x: 4.2, y: -1.6 },
      kind: "rect-corner",
      anchor: { x: 0, y: 0 }
    });

    expect(rect.snappedPoint?.x).toBeCloseTo(5, 6);
    expect(rect.lines.some((line) => line.type === "points" && line.axis === "x")).toBe(true);
  });

  it("snaps line endpoint pointers", () => {
    const scene = [makeCircle("ref", 40, 10, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const result = snapToolPointer({
      context,
      pointer: { x: 44.2, y: 9.6 },
      kind: "line-end",
      anchor: { x: 0, y: 0 }
    });

    expect(result.snappedPoint?.x).toBeCloseTo(45, 6);
    expect(result.snappedPoint?.y).toBeCloseTo(10, 6);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it("does not suggest handle snap targets from itself when no other references exist", () => {
    const scene = [makeCircle("self", 0, 0, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: ["self"],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const result = snapHandlePosition({
      context,
      point: { x: 4.4, y: 0.2 },
      sourceId: "self"
    });

    expect(result.snappedPoint).toEqual({ x: 4.4, y: 0.2 });
    expect(result.lines).toEqual([]);
  });
});
