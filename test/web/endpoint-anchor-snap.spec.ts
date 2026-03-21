import { describe, expect, it } from "vitest";

import type { NodeAnchorTarget } from "../../packages/core/src/semantic/types.js";
import { resolveEndpointAnchorSnap, type MatrixCellAnchorHint } from "../../packages/app/src/ui/canvas-panel/endpoint-anchor-snap";

const TARGETS: NodeAnchorTarget[] = [
  { nodeName: "A", anchor: "center", world: { x: 0, y: 0 }, tier: "basic" },
  { nodeName: "A", anchor: "east", world: { x: 10, y: 0 }, tier: "basic" },
  { nodeName: "A", anchor: "base", world: { x: 0, y: -10 }, tier: "special" },
  { nodeName: "B", anchor: "center", world: { x: 80, y: 0 }, tier: "basic" },
  { nodeName: "B", anchor: "west", world: { x: 70, y: 0 }, tier: "basic" }
];

describe("resolveEndpointAnchorSnap", () => {
  it("reveals anchors only for the nearest node within reveal radius", () => {
    const result = resolveEndpointAnchorSnap({
      pointerWorld: { x: 4, y: 0 },
      zoom: 1,
      nodeAnchorTargets: TARGETS
    });

    expect(result.visibleAnchors.length).toBeGreaterThan(0);
    expect(result.visibleAnchors.every((target) => target.nodeName === "A")).toBe(true);
  });

  it("reveals only basic anchors when cursor is near node but not very close", () => {
    const result = resolveEndpointAnchorSnap({
      pointerWorld: { x: 30, y: 0 },
      zoom: 1,
      nodeAnchorTargets: TARGETS
    });

    expect(result.visibleAnchors.every((target) => target.tier === "basic")).toBe(true);
  });

  it("does not reveal specialized anchors even when cursor is very close", () => {
    const result = resolveEndpointAnchorSnap({
      pointerWorld: { x: 9, y: 0 },
      zoom: 1,
      nodeAnchorTargets: TARGETS
    });

    expect(result.visibleAnchors.every((target) => target.tier === "basic")).toBe(true);
    expect(result.visibleAnchors.some((target) => target.anchor === "base")).toBe(false);
    expect(result.snappedAnchor?.nodeName).toBe("A");
    expect(result.snappedAnchor?.anchor).toBe("east");
  });

  it("returns no visible anchors when no node is within reveal radius", () => {
    const result = resolveEndpointAnchorSnap({
      pointerWorld: { x: 200, y: 200 },
      zoom: 1,
      nodeAnchorTargets: TARGETS
    });

    expect(result.visibleAnchors).toHaveLength(0);
    expect(result.snappedAnchor).toBeNull();
  });

  it("uses node extent (not only center) for proximity on large nodes", () => {
    const wideTargets: NodeAnchorTarget[] = [
      { nodeName: "Wide", anchor: "center", world: { x: 0, y: 0 }, tier: "basic" },
      { nodeName: "Wide", anchor: "west", world: { x: -150, y: 0 }, tier: "basic" },
      { nodeName: "Wide", anchor: "east", world: { x: 150, y: 0 }, tier: "basic" },
      { nodeName: "Wide", anchor: "north", world: { x: 0, y: 20 }, tier: "basic" },
      { nodeName: "Wide", anchor: "south", world: { x: 0, y: -20 }, tier: "basic" }
    ];

    const result = resolveEndpointAnchorSnap({
      // Near east edge, far from center (center distance ~= 150).
      pointerWorld: { x: 148, y: 0 },
      zoom: 1,
      nodeAnchorTargets: wideTargets
    });

    expect(result.visibleAnchors.length).toBeGreaterThan(0);
    expect(result.visibleAnchors.every((target) => target.nodeName === "Wide")).toBe(true);
    expect(result.snappedAnchor?.anchor).toBe("east");
  });

  it("biases anchor reveal toward the nearest matrix cell row/column when hints are available", () => {
    const matrixTargets: NodeAnchorTarget[] = [
      { nodeName: "m-1-1", anchor: "center", world: { x: 0, y: 0 }, tier: "basic" },
      { nodeName: "m-1-1", anchor: "east", world: { x: 0.8, y: 0 }, tier: "basic" },
      { nodeName: "m-1-2", anchor: "center", world: { x: 1.6, y: 0 }, tier: "basic" },
      { nodeName: "m-1-2", anchor: "west", world: { x: 1.2, y: 0 }, tier: "basic" }
    ];
    const matrixHints: MatrixCellAnchorHint[] = [
      {
        matrixSourceId: "path:0",
        cellSourceId: "node:0:0:matrix-cell:1:1",
        row: 1,
        column: 1,
        bounds: { minX: -0.4, minY: -0.4, maxX: 0.9, maxY: 0.4 }
      },
      {
        matrixSourceId: "path:0",
        cellSourceId: "node:0:0:matrix-cell:1:2",
        row: 1,
        column: 2,
        bounds: { minX: 1.0, minY: -0.4, maxX: 2.1, maxY: 0.4 }
      }
    ];

    const result = resolveEndpointAnchorSnap({
      pointerWorld: { x: 1.05, y: 0 },
      zoom: 1,
      nodeAnchorTargets: matrixTargets,
      matrixCellAnchorHints: matrixHints
    });

    expect(result.visibleAnchors.length).toBeGreaterThan(0);
    expect(result.visibleAnchors.every((target) => target.nodeName === "m-1-2")).toBe(true);
    expect(result.snappedAnchor?.nodeName).toBe("m-1-2");
  });
});
