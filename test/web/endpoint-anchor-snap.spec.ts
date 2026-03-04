import { describe, expect, it } from "vitest";

import type { NodeAnchorTarget } from "../../src/semantic/types.js";
import { resolveEndpointAnchorSnap } from "../../web/src/ui/canvas-panel/endpoint-anchor-snap";

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
});
