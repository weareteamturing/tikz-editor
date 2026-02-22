import { describe, expect, it } from "vitest";
import type { SceneCircle, SceneElement, ScenePath, ScenePathCommand } from "../src/semantic/types.js";
import {
  boundsFromPoints,
  buildSnapContext,
  pickGridStepPt,
  selectionSnapPointsFromBounds,
  snapHandlePosition,
  snapKeyboardNudge,
  snapSelectionTranslation,
  snapToNextMultiple
} from "../src/edit/snapping/index.js";
import type { SelectionGeometry } from "../src/edit/snapping/types.js";

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

function makePath(sourceId: string, commands: ScenePathCommand[]): SceneElement {
  const path: ScenePath = {
    kind: "Path",
    id: `path:${sourceId}`,
    sourceId,
    sourceSpan: { from: 0, to: 0 },
    style: {} as ScenePath["style"],
    styleChain: [],
    commands
  };

  return path;
}

function selectionFromBounds(minX: number, minY: number, maxX: number, maxY: number): SelectionGeometry {
  const bounds = { minX, minY, maxX, maxY };
  return {
    bounds,
    snapPoints: selectionSnapPointsFromBounds(bounds)
  };
}

describe("edit snapping core", () => {
  it("snaps to nearest point on both axes", () => {
    const scene = [makeCircle("ref", 100, 100, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const snapped = snapHandlePosition({
      context,
      point: { x: 99, y: 101 }
    });

    expect(snapped.snappedPoint?.x).toBeCloseTo(100, 6);
    expect(snapped.snappedPoint?.y).toBeCloseTo(100, 6);
    expect(snapped.lines.length).toBeGreaterThan(0);
  });

  it("uses zoom-scaled threshold", () => {
    const scene = [makeCircle("ref", 100, 100, 5)];

    const zoom1 = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const zoom2 = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 2,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const snappedAtZoom1 = snapHandlePosition({
      context: zoom1,
      point: { x: 111, y: 100 }
    });

    const snappedAtZoom2 = snapHandlePosition({
      context: zoom2,
      point: { x: 111, y: 100 }
    });

    expect(snappedAtZoom1.snappedPoint?.x).toBeCloseTo(105, 6);
    expect(snappedAtZoom2.snappedPoint?.x).toBeCloseTo(111, 6);
  });

  it("bypasses snapping when ctrl/cmd modifier is active", () => {
    const scene = [makeCircle("ref", 100, 100, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const raw = { x: 99, y: 101 };
    const snapped = snapHandlePosition({
      context,
      point: raw,
      modifiers: { ctrlOrMeta: true }
    });

    expect(snapped.snappedPoint).toEqual(raw);
    expect(snapped.lines).toEqual([]);
  });

  it("recomputes exact guide lines after snapping", () => {
    const scene = [makeCircle("ref", 100, 100, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const selection = selectionFromBounds(90, 90, 94, 94);
    const snapped = snapSelectionTranslation({
      context,
      selection,
      rawDelta: { x: 7, y: 7 }
    });

    expect(snapped.snappedDelta?.x).toBeCloseTo(6, 6);
    expect(snapped.snappedDelta?.y).toBeCloseTo(6, 6);
    expect(snapped.lines.some((line) => line.type === "points")).toBe(true);
  });

  it("supports grid step selection and next-multiple snapping", () => {
    const gridStep = pickGridStepPt(1, 22);
    expect(gridStep).toBeGreaterThan(0);

    expect(snapToNextMultiple(10, 2, 1)).toBe(12);
    expect(snapToNextMultiple(10, 2, -1)).toBe(8);
    expect(snapToNextMultiple(10.1, 2, 1)).toBe(12);
    expect(snapToNextMultiple(10.1, 2, -1)).toBe(10);

    const context = buildSnapContext({
      sceneElements: [],
      selectedSourceIds: [],
      zoom: 1
    });

    const snapped = snapHandlePosition({
      context,
      point: { x: gridStep + 3, y: 0 }
    });

    expect(snapped.snappedPoint?.x).toBeCloseTo(gridStep, 6);
    expect(snapped.lines).toEqual([]);
  });

  it("supports gap center snapping", () => {
    const scene = [
      makeCircle("a", 5, 5, 5),   // bounds x=[0,10]
      makeCircle("b", 45, 5, 5)   // bounds x=[40,50]
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { points: { enabled: false }, grid: { enabled: false } }
    });

    const selection = selectionFromBounds(13, 0, 23, 10);
    const snapped = snapSelectionTranslation({
      context,
      selection,
      rawDelta: { x: 0, y: 0 }
    });

    expect(snapped.snappedDelta?.x).toBeCloseTo(7, 6);
    expect(snapped.lines.some((line) => line.type === "gap")).toBe(true);
  });

  it("supports gap duplicate-spacing snapping", () => {
    const scene = [
      makeCircle("a", 5, 5, 5),    // bounds x=[0,10]
      makeCircle("b", 25, 5, 5)    // bounds x=[20,30], gap=10
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { points: { enabled: false }, grid: { enabled: false } }
    });

    const selection = selectionFromBounds(37, 0, 47, 10);
    const snapped = snapSelectionTranslation({
      context,
      selection,
      rawDelta: { x: 0, y: 0 }
    });

    expect(snapped.snappedDelta?.x).toBeCloseTo(3, 6);
    expect(snapped.lines.some((line) => line.type === "gap")).toBe(true);
  });

  it("dedupes gap guide segments", () => {
    const scene = [
      makeCircle("a", 5, 5, 5),
      makeCircle("b", 25, 5, 5),
      makeCircle("c", 45, 5, 5)
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { points: { enabled: false }, grid: { enabled: false } }
    });

    const selection = selectionFromBounds(37, 0, 47, 10);
    const snapped = snapSelectionTranslation({
      context,
      selection,
      rawDelta: { x: 0, y: 0 }
    });

    const keys = new Set<string>();
    for (const line of snapped.lines) {
      if (line.type !== "gap") continue;
      for (const segment of line.segments) {
        const a = `${segment[0].x.toFixed(4)},${segment[0].y.toFixed(4)}`;
        const b = `${segment[1].x.toFixed(4)},${segment[1].y.toFixed(4)}`;
        const key = a <= b ? `${a}|${b}` : `${b}|${a}`;
        keys.add(key);
      }
    }

    const segmentCount = snapped.lines
      .filter((line) => line.type === "gap")
      .reduce((sum, line) => sum + line.segments.length, 0);

    expect(keys.size).toBe(segmentCount);
  });

  it("excludes self-source handle snapping by default", () => {
    const scene = [
      makeCircle("self", 0, 0, 5),
      makeCircle("other", 100, 0, 5)
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const withoutSelf = snapHandlePosition({
      context,
      point: { x: 4, y: 0 },
      sourceId: "self"
    });

    const withSelf = snapHandlePosition({
      context,
      point: { x: 4, y: 0 },
      sourceId: "self",
      allowSelfSnap: true
    });

    expect(withoutSelf.snappedPoint?.x).toBeCloseTo(4, 6);
    expect(withSelf.snappedPoint?.x).toBeCloseTo(5, 6);
  });

  it("keeps keyboard nudge directional intent", () => {
    const scene = [
      makeCircle("ref", 30, 12, 5)
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: ["moving"],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const selection = {
      bounds: boundsFromPoints({ x: 0, y: 0 }, { x: 10, y: 10 }),
      snapPoints: selectionSnapPointsFromBounds(boundsFromPoints({ x: 0, y: 0 }, { x: 10, y: 10 }))
    };

    const snapped = snapKeyboardNudge({
      context,
      selection,
      anchor: { x: 0, y: 0 },
      axis: "x",
      direction: 1,
      step: 2
    });

    expect((snapped.snappedDelta?.x ?? 0) > 0).toBe(true);
    expect(snapped.snappedDelta?.y ?? 0).toBe(0);
  });

  it("does not suggest snap targets when only selected-source geometry exists", () => {
    const scene = [makeCircle("self", 10, 10, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: ["self"],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const selection = selectionFromBounds(5, 5, 15, 15);
    const rawDelta = { x: 1.25, y: -0.75 };
    const snapped = snapSelectionTranslation({
      context,
      selection,
      rawDelta
    });

    expect(snapped.snappedDelta).toEqual(rawDelta);
    expect(snapped.lines).toEqual([]);
  });

  it("excludes selected sources from all reference targets", () => {
    const scene = [
      makeCircle("a", 0, 0, 5),
      makeCircle("b", 20, 0, 5),
      makeCircle("c", 40, 0, 5)
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: ["b"],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    expect(context.referencePoints.every((point) => point.sourceId !== "b")).toBe(true);
    expect(context.referenceBounds.every((bounds) => bounds.sourceId !== "b")).toBe(true);
  });

  it("excludes open paths from reference snap targets", () => {
    const scene = [
      makePath("open", [
        { kind: "M", to: { x: -20, y: 0 } },
        { kind: "L", to: { x: 20, y: 0 } }
      ]),
      makePath("closed", [
        { kind: "M", to: { x: 30, y: 30 } },
        { kind: "L", to: { x: 50, y: 30 } },
        { kind: "L", to: { x: 50, y: 50 } },
        { kind: "L", to: { x: 30, y: 50 } },
        { kind: "Z" }
      ])
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    expect(context.referenceBounds.map((bounds) => bounds.sourceId)).toEqual(["closed"]);
    expect(context.referencePoints.every((point) => point.sourceId !== "open")).toBe(true);
  });

  it("is stateless across calls and only depends on current input", () => {
    const scene = [makeCircle("ref", 0, 0, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: ["moving"],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const moving = selectionFromBounds(-12.5, -54.1, 11.1, -13.6);

    const near = snapSelectionTranslation({
      context,
      selection: moving,
      rawDelta: { x: 0, y: 0 }
    });
    const far = snapSelectionTranslation({
      context,
      selection: moving,
      rawDelta: { x: 200, y: 200 }
    });
    const nearAgain = snapSelectionTranslation({
      context,
      selection: moving,
      rawDelta: { x: 0, y: 0 }
    });

    expect(nearAgain).toEqual(near);
    expect(far.lines).toEqual([]);
  });

  it("emits point guides only from current snapped points and current references", () => {
    const scene = [makeCircle("ref", 0, 0, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: ["moving"],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const moving = selectionFromBounds(-12.5, -54.1, 11.1, -13.6);
    const snapped = snapSelectionTranslation({
      context,
      selection: moving,
      rawDelta: { x: 0, y: 0 }
    });
    const delta = snapped.snappedDelta ?? { x: 0, y: 0 };

    const toKey = (x: number, y: number) => `${x.toFixed(6)},${y.toFixed(6)}`;
    const snappedSelectionPoints = moving.snapPoints.map((point) => toKey(point.x + delta.x, point.y + delta.y));
    const referencePoints = context.referencePoints.map((point) => toKey(point.x, point.y));
    const allowedPointKeys = new Set([...snappedSelectionPoints, ...referencePoints]);

    const pointLines = snapped.lines.filter((line) => line.type === "points");
    expect(pointLines.length).toBeGreaterThan(0);

    for (const line of pointLines) {
      for (const point of line.points) {
        expect(allowedPointKeys.has(toKey(point.x, point.y))).toBe(true);
      }
    }
  });
});
