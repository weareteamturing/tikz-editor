import { describe, expect, it } from "vitest";
import {
  applyAdornmentPointerOffset,
  resolveAdornmentDragPlacement
} from "../../packages/app/src/ui/canvas-panel/useCanvasDragController.js";
import type { SceneAdornment } from "../../packages/core/src/semantic/types.js";

describe("adornment drag placement", () => {
  it("keeps dragged adornment distance continuous", () => {
    const placement = resolveAdornmentDragPlacement(
      { x: 10.24, y: 0 },
      { x: 0, y: 0 },
      {
        shape: "coordinate",
        center: { x: 0, y: 0 },
        anchorHalfWidth: 0,
        anchorHalfHeight: 0,
        anchorRadius: 0
      },
      { allowCenter: false }
    );

    expect(placement.angleRaw).toBe("0");
    expect(placement.distancePt).toBeCloseTo(10.24, 6);
  });

  it("keeps dragged adornment angle continuous", () => {
    const placement = resolveAdornmentDragPlacement(
      { x: 10, y: 10 },
      { x: 0, y: 0 },
      {
        shape: "coordinate",
        center: { x: 0, y: 0 },
        anchorHalfWidth: 0,
        anchorHalfHeight: 0,
        anchorRadius: 0
      },
      { allowCenter: false }
    );

    expect(placement.angleRaw).toBe("45");
    expect(placement.distancePt).toBeCloseTo(Math.sqrt(200), 6);
  });

  it("makes center snapping less aggressive than before", () => {
    const ownerGeometry = {
      shape: "rectangle" as const,
      center: { x: 0, y: 0 },
      anchorHalfWidth: 8,
      anchorHalfHeight: 8,
      anchorRadius: 8
    };

    const nearBorder = resolveAdornmentDragPlacement(
      { x: 9.2, y: 0 },
      { x: 0, y: 0 },
      ownerGeometry,
      { allowCenter: true }
    );
    const veryNearCenter = resolveAdornmentDragPlacement(
      { x: 0.6, y: 0 },
      { x: 0, y: 0 },
      ownerGeometry,
      { allowCenter: true }
    );

    expect(nearBorder.angleRaw).toBe("0");
    expect(nearBorder.distancePt).toBeCloseTo(1.2, 6);
    expect(veryNearCenter).toEqual({ angleRaw: "center", distancePt: 0 });
  });

  it("preserves pointer grab offset while dragging", () => {
    const adjusted = applyAdornmentPointerOffset(
      { x: 12, y: 6 },
      { x: 2.5, y: -1.5 }
    );

    expect(adjusted).toEqual({ x: 9.5, y: 7.5 });
  });

  it("does not jump on pickup for a pin with explicit pin distance", () => {
    const ownerCenter = { x: 0, y: 0 };
    const ownerGeometry = {
      shape: "rectangle" as const,
      center: ownerCenter,
      anchorHalfWidth: 11.08,
      anchorHalfHeight: 6,
      anchorRadius: 0
    };
    const adornment: SceneAdornment = {
      targetId: "node-adornment:path:0:pin:0",
      kind: "pin",
      ownerSourceId: "path:0",
      ownerNodeId: "path:0",
      adornmentIndex: 0,
      optionSpan: { from: 0, to: 0 },
      valueSpan: { from: 0, to: 0 },
      textSpan: { from: 0, to: 0 },
      angleRaw: "0.38",
      distancePt: 30,
      defaultDistancePt: 30,
      distanceExplicit: true,
      ownerPoint: ownerCenter,
      ownerGeometry
    };
    const angleDeg = 0.38;
    const radians = (angleDeg * Math.PI) / 180;
    const direction = { x: Math.cos(radians), y: Math.sin(radians) };
    const borderDistance = 1 / Math.max(Math.abs(direction.x) / ownerGeometry.anchorHalfWidth, Math.abs(direction.y) / ownerGeometry.anchorHalfHeight);
    const reference = {
      x: ownerCenter.x + direction.x * (borderDistance + 30),
      y: ownerCenter.y + direction.y * (borderDistance + 30)
    };
    const fakeTextCenter = {
      x: reference.x + 11.08,
      y: reference.y
    };
    const offset = {
      x: fakeTextCenter.x - reference.x,
      y: fakeTextCenter.y - reference.y
    };
    const afterPickup = applyAdornmentPointerOffset(fakeTextCenter, offset);

    const placement = resolveAdornmentDragPlacement(afterPickup, ownerCenter, ownerGeometry, { allowCenter: false });
    expect(placement.distancePt).toBeCloseTo(30, 3);
    expect(Number(placement.angleRaw)).toBeCloseTo(0.38, 2);
  });
});
