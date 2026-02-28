import { describe, expect, it } from "vitest";

import { rgbToXcolorExpressionFast, type RgbColor } from "../src/edit/rgb-to-xcolor";

const BASE_COLORS: Array<{ name: string; rgb: RgbColor }> = [
  { name: "black", rgb: { r: 0, g: 0, b: 0 } },
  { name: "darkgray", rgb: { r: 64, g: 64, b: 64 } },
  { name: "gray", rgb: { r: 128, g: 128, b: 128 } },
  { name: "lightgray", rgb: { r: 191, g: 191, b: 191 } },
  { name: "white", rgb: { r: 255, g: 255, b: 255 } },
  { name: "red", rgb: { r: 255, g: 0, b: 0 } },
  { name: "green", rgb: { r: 0, g: 255, b: 0 } },
  { name: "blue", rgb: { r: 0, g: 0, b: 255 } },
  { name: "cyan", rgb: { r: 0, g: 255, b: 255 } },
  { name: "magenta", rgb: { r: 255, g: 0, b: 255 } },
  { name: "yellow", rgb: { r: 255, g: 255, b: 0 } },
  { name: "lime", rgb: { r: 191, g: 255, b: 0 } },
  { name: "olive", rgb: { r: 128, g: 128, b: 0 } },
  { name: "orange", rgb: { r: 255, g: 128, b: 0 } },
  { name: "pink", rgb: { r: 255, g: 191, b: 191 } },
  { name: "teal", rgb: { r: 0, g: 128, b: 128 } },
  { name: "violet", rgb: { r: 128, g: 0, b: 128 } },
  { name: "purple", rgb: { r: 191, g: 0, b: 64 } },
  { name: "brown", rgb: { r: 191, g: 128, b: 64 } }
];

describe("rgbToXcolorExpressionFast", () => {
  it("returns exact expressions for xcolor base colors", () => {
    for (const sample of BASE_COLORS) {
      const result = rgbToXcolorExpressionFast(sample.rgb, {
        mode: "release",
        maxMixes: 2
      });
      expect(result.exact).toBe(true);
      expect(result.error2).toBe(0);
      expect(result.expression.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic for repeated calls over arbitrary samples", () => {
    const samples: RgbColor[] = [
      { r: 26, g: 43, b: 60 },
      { r: 91, g: 203, b: 147 },
      { r: 123, g: 45, b: 67 },
      { r: 240, g: 200, b: 120 },
      { r: 17, g: 9, b: 220 }
    ];

    for (const sample of samples) {
      const first = rgbToXcolorExpressionFast(sample, { mode: "release", maxMixes: 2 });
      const second = rgbToXcolorExpressionFast(sample, { mode: "release", maxMixes: 2 });
      const third = rgbToXcolorExpressionFast(sample, { mode: "release", maxMixes: 2 });

      expect(second.expression).toBe(first.expression);
      expect(second.error2).toBe(first.error2);
      expect(second.mixes).toBe(first.mixes);

      expect(third.expression).toBe(first.expression);
      expect(third.error2).toBe(first.error2);
      expect(third.mixes).toBe(first.mixes);
    }
  });

  it("release mode is never worse than drag mode for error^2", () => {
    const samples: RgbColor[] = [
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
      { r: 26, g: 43, b: 60 },
      { r: 44, g: 97, b: 166 },
      { r: 64, g: 200, b: 44 },
      { r: 91, g: 203, b: 147 },
      { r: 123, g: 45, b: 67 },
      { r: 150, g: 150, b: 1 },
      { r: 222, g: 19, b: 90 },
      { r: 240, g: 200, b: 120 },
      { r: 254, g: 10, b: 180 }
    ];

    for (const sample of samples) {
      const drag = rgbToXcolorExpressionFast(sample, { mode: "drag", maxMixes: 2 });
      const release = rgbToXcolorExpressionFast(sample, { mode: "release", maxMixes: 2 });
      expect(release.error2).toBeLessThanOrEqual(drag.error2);
    }
  });
});
