import { describe, expect, it } from "vitest";
import { resolveAdornmentDragPlacement } from "../../web/src/ui/canvas-panel/useCanvasDragController.js";

describe("adornment drag placement", () => {
  it("quantizes dragged adornment distance to 0.5pt increments", () => {
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
      { allowCenter: false, defaultDistancePt: 0 }
    );

    expect(placement.angleRaw).toBe("right");
    expect(placement.distancePt).toBe(10);
  });

  it("keeps snapping back to the default distance within the existing tolerance", () => {
    const placement = resolveAdornmentDragPlacement(
      { x: 11.2, y: 0 },
      { x: 0, y: 0 },
      {
        shape: "coordinate",
        center: { x: 0, y: 0 },
        anchorHalfWidth: 0,
        anchorHalfHeight: 0,
        anchorRadius: 0
      },
      { allowCenter: false, defaultDistancePt: 12.9 }
    );

    expect(placement.distancePt).toBe(12.9);
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
      { allowCenter: true, defaultDistancePt: 10 }
    );
    const veryNearCenter = resolveAdornmentDragPlacement(
      { x: 0.6, y: 0 },
      { x: 0, y: 0 },
      ownerGeometry,
      { allowCenter: true, defaultDistancePt: 0 }
    );

    expect(nearBorder.angleRaw).toBe("right");
    expect(nearBorder.distancePt).toBe(1);
    expect(veryNearCenter).toEqual({ angleRaw: "center", distancePt: 0 });
  });
});
