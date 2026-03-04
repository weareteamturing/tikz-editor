import { describe, expect, it } from "vitest";

import type { EditHandle, Point } from "../../src/semantic/types.js";
import { identityMatrix, scaleMatrix, rotationMatrix, multiplyMatrix, translationMatrix } from "../../src/semantic/transform.js";
import { rewriteCoordinate } from "../../src/edit/rewrite.js";
import { PT_PER_CM } from "../../src/edit/format.js";

const cm = (value: number): number => value * PT_PER_CM;

function makeHandle(overrides: Partial<EditHandle> & { world: Point; sourceSpan: { from: number; to: number } }): EditHandle {
  return {
    id: "test-handle",
    kind: "path-point",
    sourceText: "",
    sourceFingerprint: "test",
    coordinateForm: "cartesian",
    transform: identityMatrix(),
    rewriteMode: "direct",
    ...overrides
  };
}

describe("rewriteCoordinate", () => {
  describe("cartesian", () => {
    it("rewrites with identity transform", () => {
      const source = "\\draw (1,2) -- (3,4);";
      const handle = makeHandle({
        world: { x: cm(1), y: cm(2) },
        sourceSpan: { from: 6, to: 11 },
        coordinateForm: "cartesian"
      });
      const result = rewriteCoordinate({ x: cm(5), y: cm(6) }, handle, source);
      expect(result).toBe("(5,6)");
    });

    it("preserves whitespace from original coordinate", () => {
      const source = "\\draw (1, 2) -- (3,4);";
      const handle = makeHandle({
        world: { x: cm(1), y: cm(2) },
        sourceSpan: { from: 6, to: 12 },
        coordinateForm: "cartesian"
      });
      const result = rewriteCoordinate({ x: cm(5), y: cm(6) }, handle, source);
      expect(result).toBe("(5, 6)");
    });

    it("rewrites with xscale=2 — local x is halved", () => {
      const transform = scaleMatrix(2, 1);
      const source = "\\draw (1,2);";
      const handle = makeHandle({
        world: { x: cm(2), y: cm(2) },
        sourceSpan: { from: 6, to: 11 },
        coordinateForm: "cartesian",
        transform
      });
      // Move to world (4cm, 3cm) → local should be (2cm, 3cm)
      const result = rewriteCoordinate({ x: cm(4), y: cm(3) }, handle, source);
      expect(result).toBe("(2,3)");
    });

    it("rewrites with rotate=90", () => {
      const transform = rotationMatrix(90);
      const source = "\\draw (0,1);";
      const handle = makeHandle({
        world: { x: cm(-1), y: cm(0) },
        sourceSpan: { from: 6, to: 11 },
        coordinateForm: "cartesian",
        transform
      });
      // Move to world (0, 1cm) → local should be (1, 0) after inverse rotation
      // rotate(90): (x,y) -> (-y, x). So inverse: (x,y) -> (y, -x)
      // world (0, cm(1)) -> local (cm(1), 0)
      const result = rewriteCoordinate({ x: 0, y: cm(1) }, handle, source);
      expect(result).not.toBeNull();
      // Parse the result to verify
      const match = result!.match(/^\(([^,]+),([^)]+)\)$/);
      expect(match).not.toBeNull();
      const x = parseFloat(match![1]);
      const y = parseFloat(match![2]);
      expect(x).toBeCloseTo(1, 2);
      expect(y).toBeCloseTo(0, 2);
    });

    it("rewrites with combined scale and translation", () => {
      const transform = multiplyMatrix(translationMatrix(cm(10), 0), scaleMatrix(2, 1));
      const source = "\\draw (1,2);";
      const handle = makeHandle({
        world: { x: cm(12), y: cm(2) },
        sourceSpan: { from: 6, to: 11 },
        coordinateForm: "cartesian",
        transform
      });
      // Move to world (cm(14), cm(4))
      // inverse: first undo translation (-10cm), then undo scale (/2)
      // (14-10)/2 = 2, 4/1 = 4
      const result = rewriteCoordinate({ x: cm(14), y: cm(4) }, handle, source);
      expect(result).toBe("(2,4)");
    });

    it("formats fractional coordinates cleanly", () => {
      const source = "\\draw (1,2);";
      const handle = makeHandle({
        world: { x: cm(1), y: cm(2) },
        sourceSpan: { from: 6, to: 11 },
        coordinateForm: "cartesian"
      });
      const result = rewriteCoordinate({ x: cm(1.5), y: cm(2.25) }, handle, source);
      expect(result).toBe("(1.5,2.25)");
    });
  });

  describe("polar", () => {
    it("rewrites preserving polar form", () => {
      const source = "\\draw (45:2);";
      const handle = makeHandle({
        world: { x: cm(Math.SQRT2), y: cm(Math.SQRT2) },
        sourceSpan: { from: 6, to: 12 },
        coordinateForm: "polar"
      });
      // Move to (0, 3cm) → angle=90, radius=3
      const result = rewriteCoordinate({ x: 0, y: cm(3) }, handle, source);
      expect(result).not.toBeNull();
      expect(result).toMatch(/^\(\d+(\.\d+)?:\d+(\.\d+)?\)$/);
      const match = result!.match(/^\(([^:]+):([^)]+)\)$/);
      expect(parseFloat(match![1])).toBeCloseTo(90, 1);
      expect(parseFloat(match![2])).toBeCloseTo(3, 2);
    });

    it("handles angle normalization (negative to positive)", () => {
      const source = "\\draw (0:1);";
      const handle = makeHandle({
        world: { x: cm(1), y: 0 },
        sourceSpan: { from: 6, to: 11 },
        coordinateForm: "polar"
      });
      // Move to (0, -1cm) → angle=270, radius=1
      const result = rewriteCoordinate({ x: 0, y: cm(-1) }, handle, source);
      expect(result).not.toBeNull();
      const match = result!.match(/^\(([^:]+):([^)]+)\)$/);
      expect(parseFloat(match![1])).toBeCloseTo(270, 1);
      expect(parseFloat(match![2])).toBeCloseTo(1, 2);
    });

    it("preserves coordinate-local options and spacing", () => {
      const source = "\\draw ([xshift=3pt] 45: 2);";
      const rawCoordinate = "([xshift=3pt] 45: 2)";
      const from = source.indexOf(rawCoordinate);
      const to = from + rawCoordinate.length;
      const handle = makeHandle({
        world: { x: cm(Math.SQRT2), y: cm(Math.SQRT2) },
        sourceSpan: { from, to },
        coordinateForm: "polar"
      });
      const result = rewriteCoordinate({ x: 0, y: cm(3) }, handle, source);
      expect(result).toBe("([xshift=3pt] 90: 3)");
    });
  });

  describe("delta (relative coordinates)", () => {
    it("rewrites ++ coordinate as delta from base", () => {
      const source = "\\draw (0,0) -- ++(1,1);";
      const handle = makeHandle({
        world: { x: cm(1), y: cm(1) },
        sourceSpan: { from: 18, to: 23 },
        coordinateForm: "cartesian",
        rewriteMode: "delta",
        relativePrefix: "++",
        relativeBaseWorld: { x: 0, y: 0 }
      });
      // Move to (2cm, 3cm) → delta from base (0,0) = (2,3)
      const result = rewriteCoordinate({ x: cm(2), y: cm(3) }, handle, source);
      // Relative prefix is outside the source span and must not be duplicated.
      expect(result).toBe("(2,3)");
    });

    it("rewrites + coordinate preserving prefix", () => {
      const source = "\\draw (0,0) -- +(1,0);";
      const handle = makeHandle({
        world: { x: cm(1), y: 0 },
        sourceSpan: { from: 17, to: 22 },
        coordinateForm: "cartesian",
        rewriteMode: "delta",
        relativePrefix: "+",
        relativeBaseWorld: { x: 0, y: 0 }
      });
      const result = rewriteCoordinate({ x: cm(3), y: cm(1) }, handle, source);
      // Relative prefix is outside the source span and must not be duplicated.
      expect(result).toBe("(3,1)");
    });

    it("preserves coordinate-local options for relative coordinates", () => {
      const source = "\\draw (1,1) -- ++([xshift=3pt] 1, 0);";
      const rawCoordinate = "([xshift=3pt] 1, 0)";
      const from = source.indexOf(rawCoordinate);
      const to = from + rawCoordinate.length;
      const handle = makeHandle({
        world: { x: cm(2), y: cm(1) },
        sourceSpan: { from, to },
        coordinateForm: "cartesian",
        rewriteMode: "delta",
        relativePrefix: "++",
        relativeBaseWorld: { x: cm(1), y: cm(1) }
      });
      const result = rewriteCoordinate({ x: cm(3), y: cm(2) }, handle, source);
      expect(result).toBe("([xshift=3pt] 2, 1)");
    });

    it("returns null when relativeBaseWorld is missing", () => {
      const source = "\\draw ++(1,1);";
      const handle = makeHandle({
        world: { x: cm(1), y: cm(1) },
        sourceSpan: { from: 6, to: 12 },
        coordinateForm: "cartesian",
        rewriteMode: "delta",
        relativePrefix: "++"
        // no relativeBaseWorld
      });
      const result = rewriteCoordinate({ x: cm(2), y: cm(2) }, handle, source);
      expect(result).toBeNull();
    });
  });

  describe("unsupported", () => {
    it("returns null for xyz direct coordinates", () => {
      const source = "\\draw (1,2,3);";
      const handle = makeHandle({
        world: { x: cm(1), y: cm(2) },
        sourceSpan: { from: 6, to: 13 },
        coordinateForm: "xyz",
        rewriteMode: "direct"
      });
      const result = rewriteCoordinate({ x: cm(2), y: cm(3) }, handle, source);
      expect(result).toBeNull();
    });

    it("rewrites named path endpoints in unsupported mode to detached cartesian coordinates", () => {
      const source = "\\draw (A);";
      const handle = makeHandle({
        world: { x: cm(1), y: cm(1) },
        sourceSpan: { from: 6, to: 9 },
        kind: "path-point",
        coordinateForm: "named",
        rewriteMode: "unsupported"
      });
      const result = rewriteCoordinate({ x: cm(2), y: cm(2) }, handle, source);
      expect(result).toBe("(2,2)");
    });

    it("returns null for unsupported non-endpoint handles", () => {
      const source = "\\draw (A) .. controls (B) .. (C);";
      const handle = makeHandle({
        world: { x: cm(1), y: cm(1) },
        sourceSpan: { from: 21, to: 24 },
        kind: "path-control",
        coordinateForm: "named",
        rewriteMode: "unsupported"
      });
      const result = rewriteCoordinate({ x: cm(2), y: cm(2) }, handle, source);
      expect(result).toBeNull();
    });

    it("returns null for calc coordinates", () => {
      const source = "\\draw ($0.5*(A)+0.5*(B)$);";
      const handle = makeHandle({
        world: { x: cm(1), y: cm(1) },
        sourceSpan: { from: 6, to: 25 },
        coordinateForm: "calc",
        rewriteMode: "unsupported"
      });
      const result = rewriteCoordinate({ x: cm(2), y: cm(2) }, handle, source);
      expect(result).toBeNull();
    });
  });
});
