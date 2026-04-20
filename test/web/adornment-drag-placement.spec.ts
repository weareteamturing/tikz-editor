import { describe, expect, it } from "vitest";
import {
  applyAdornmentWorldPointerOffset,
  resolveAdornmentDragPlacement
} from "../../packages/app/src/ui/canvas-panel/useCanvasDragController.js";
import type { AdornmentOwnerGeometry } from "../../packages/core/src/ast/types.js";
import type { SceneAdornment } from "../../packages/core/src/semantic/types.js";
import type { WorldPoint } from "../../packages/core/src/coords/points.js";

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
    expect(placement).not.toBeNull();
    if (!placement) return;

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
    expect(placement).not.toBeNull();
    if (!placement) return;

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
    expect(nearBorder).not.toBeNull();
    if (!nearBorder) return;
    expect(veryNearCenter).not.toBeNull();
    if (!veryNearCenter) return;

    expect(nearBorder.angleRaw).toBe("0");
    expect(nearBorder.distancePt).toBeCloseTo(1.2, 6);
    expect(veryNearCenter).toEqual({ angleRaw: "center", distancePt: 0 });
  });

  it("preserves pointer grab offset while dragging", () => {
    const adjusted = applyAdornmentWorldPointerOffset(
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
    const afterPickup = applyAdornmentWorldPointerOffset(fakeTextCenter, offset);

    const placement = resolveAdornmentDragPlacement(afterPickup, ownerCenter, ownerGeometry, { allowCenter: false });
    expect(placement).not.toBeNull();
    if (!placement) return;
    expect(placement.distancePt).toBeCloseTo(30, 3);
    expect(Number(placement.angleRaw)).toBeCloseTo(0.38, 2);
  });

  it("keeps cursor aligned when dragging across large angle changes", () => {
    const ownerCenter = { x: 0, y: 0 };
    const ownerGeometry = {
      shape: "rectangle" as const,
      center: ownerCenter,
      anchorHalfWidth: 24,
      anchorHalfHeight: 12,
      anchorRadius: 0
    };

    const pointerWorld = { x: 100, y: 45 };
    const placement = resolveAdornmentDragPlacement(
      pointerWorld,
      ownerCenter,
      ownerGeometry,
      {
        allowCenter: false,
        textDrag: {
          pointerOffsetFromCenter: { x: 0, y: 0 },
          halfWidth: 20,
          halfHeight: 8
        }
      }
    );
    expect(placement).not.toBeNull();
    if (!placement) return;

    const angleDeg = Number(placement.angleRaw);
    expect(Number.isFinite(angleDeg)).toBe(true);
    expect(placement.distancePt).toBeGreaterThan(0);
    expect(angleDeg).toBeGreaterThan(0);
    expect(angleDeg).toBeLessThan(90);
  });

  it("uses transformed owner geometry when resolving drag distance", () => {
    const rotation = 45 * Math.PI / 180;
    const ownerCenter = { x: 0, y: 0 };
    const ownerGeometry = {
      shape: "rectangle" as const,
      center: ownerCenter,
      anchorTransform: {
        a: Math.cos(rotation),
        b: Math.sin(rotation),
        c: -Math.sin(rotation),
        d: Math.cos(rotation),
        e: 0,
        f: 0
      },
      anchorHalfWidth: 20,
      anchorHalfHeight: 10,
      anchorRadius: 0
    };

    const transformedBorderX = 10 * Math.SQRT2;
    const placement = resolveAdornmentDragPlacement(
      { x: transformedBorderX + 6, y: 0 },
      ownerCenter,
      ownerGeometry,
      { allowCenter: false }
    );
    expect(placement).not.toBeNull();
    if (!placement) return;

    expect(placement.angleRaw).toBe("0");
    expect(placement.distancePt).toBeCloseTo(6, 6);
  });

  it("keeps a horizontal drag grabbed inside the pin body without collapsing to the owner border", () => {
    const ownerCenter = { x: 0.04, y: 0.62 };
    const ownerGeometry = {
      shape: "rectangle" as const,
      center: ownerCenter,
      anchorHalfWidth: 22,
      anchorHalfHeight: 11,
      anchorRadius: 0
    };
    const bodyHalfWidth = 40;
    const bodyHalfHeight = 10;
    const initialPlacement = resolveBodyCenterFromPlacement({
      ownerCenter,
      ownerGeometry,
      angleDeg: 200,
      distancePt: 5,
      halfWidth: bodyHalfWidth,
      halfHeight: bodyHalfHeight
    });
    const pointerOffsetFromCenter = {
      x: -39,
      y: -9
    };
    const movedWorldPointer = {
      x: initialPlacement.center.x + pointerOffsetFromCenter.x + 60,
      y: initialPlacement.center.y + pointerOffsetFromCenter.y
    };

    const placement = resolveAdornmentDragPlacement(
      movedWorldPointer,
      ownerCenter,
      ownerGeometry,
      {
        allowCenter: false,
        textDrag: {
          pointerOffsetFromCenter,
          halfWidth: bodyHalfWidth,
          halfHeight: bodyHalfHeight
        }
      }
    );
    expect(placement).not.toBeNull();
    if (!placement) return;

    const resolved = resolveBodyCenterFromPlacement({
      ownerCenter,
      ownerGeometry,
      angleDeg: Number(placement.angleRaw),
      distancePt: placement.distancePt,
      halfWidth: bodyHalfWidth,
      halfHeight: bodyHalfHeight
    });
    const expectedCenter = {
      x: initialPlacement.center.x + 60,
      y: initialPlacement.center.y
    };

    expect(Math.abs(resolved.center.x - expectedCenter.x)).toBeLessThanOrEqual(8);
    expect(Math.abs(resolved.center.y - expectedCenter.y)).toBeLessThanOrEqual(8);
  });
});

function resolveBodyCenterFromPlacement(input: {
  ownerCenter: WorldPoint;
  ownerGeometry: AdornmentOwnerGeometry;
  angleDeg: number;
  distancePt: number;
  halfWidth: number;
  halfHeight: number;
}): { center: WorldPoint; anchor: string; referenceWorldPoint: WorldPoint } {
  const direction = pointOnUnitCircle(input.angleDeg);
  const borderDistance = resolveOwnerBorderDistance(input.ownerGeometry, direction);
  const borderWorldPoint = {
    x: input.ownerCenter.x + direction.x * borderDistance,
    y: input.ownerCenter.y + direction.y * borderDistance
  };
  const centerToBorder = {
    x: borderWorldPoint.x - input.ownerCenter.x,
    y: borderWorldPoint.y - input.ownerCenter.y
  };
  const centerToBorderLength = Math.hypot(centerToBorder.x, centerToBorder.y);
  const shiftDirection = centerToBorderLength <= 1e-6
    ? direction
    : {
        x: centerToBorder.x / centerToBorderLength,
        y: centerToBorder.y / centerToBorderLength
      };
  const referenceWorldPoint = {
    x: borderWorldPoint.x + shiftDirection.x * input.distancePt,
    y: borderWorldPoint.y + shiftDirection.y * input.distancePt
  };
  const anchor = centerToBorderLength <= 1e-6
    ? anchorFacingAway(input.angleDeg)
    : autoAnchorFromVector({ x: shiftDirection.y, y: -shiftDirection.x });
  const centerOffset = anchorOffsetFromCenter(anchor, input.halfWidth, input.halfHeight);
  return {
    center: {
      x: referenceWorldPoint.x - centerOffset.x,
      y: referenceWorldPoint.y - centerOffset.y
    },
    anchor,
    referenceWorldPoint
  };
}

function resolveOwnerBorderDistance(ownerGeometry: AdornmentOwnerGeometry, direction: WorldPoint): number {
  if (ownerGeometry.shape === "rectangle") {
    return 1 / Math.max(
      Math.abs(direction.x) / Math.max(ownerGeometry.anchorHalfWidth, 1e-6),
      Math.abs(direction.y) / Math.max(ownerGeometry.anchorHalfHeight, 1e-6)
    );
  }
  if (ownerGeometry.shape === "circle") {
    return ownerGeometry.anchorRadius;
  }
  if (ownerGeometry.shape === "ellipse") {
    const rx = Math.max(ownerGeometry.anchorHalfWidth, 1e-6);
    const ry = Math.max(ownerGeometry.anchorHalfHeight, 1e-6);
    return 1 / Math.sqrt((direction.x * direction.x) / (rx * rx) + (direction.y * direction.y) / (ry * ry));
  }
  return 0;
}

function pointOnUnitCircle(angleDeg: number): WorldPoint {
  const radians = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

function anchorFacingAway(degrees: number): string {
  const normalized = normalizeDegrees(degrees);
  if (normalized < 4 || normalized >= 356) return "west";
  if (normalized < 87) return "south west";
  if (normalized < 94) return "south";
  if (normalized < 177) return "south east";
  if (normalized < 184) return "east";
  if (normalized < 267) return "north east";
  if (normalized < 274) return "north";
  return "north west";
}

function autoAnchorFromVector(vector: WorldPoint): string {
  if (vector.x > 0.05) {
    if (vector.y > 0.05) return "south east";
    if (vector.y < -0.05) return "south west";
    return "south";
  }
  if (vector.x < -0.05) {
    if (vector.y > 0.05) return "north east";
    if (vector.y < -0.05) return "north west";
    return "north";
  }
  return vector.y > 0 ? "east" : "west";
}

function anchorOffsetFromCenter(anchor: string, halfWidth: number, halfHeight: number): WorldPoint {
  switch (anchor) {
    case "west":
      return { x: -halfWidth, y: 0 };
    case "east":
      return { x: halfWidth, y: 0 };
    case "north":
      return { x: 0, y: halfHeight };
    case "south":
      return { x: 0, y: -halfHeight };
    case "north west":
      return { x: -halfWidth, y: halfHeight };
    case "north east":
      return { x: halfWidth, y: halfHeight };
    case "south west":
      return { x: -halfWidth, y: -halfHeight };
    case "south east":
      return { x: halfWidth, y: -halfHeight };
    default:
      return { x: 0, y: 0 };
  }
}

function normalizeDegrees(value: number): number {
  let normalized = value % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}
