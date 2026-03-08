import { describe, expect, it } from "vitest";
import {
  clearPathMorphingDecorationPreviewCache,
  renderPathMorphingDecorationPreviewSvg
} from "../packages/core/src/svg/decorations/preview.js";

describe("svg decoration preview helper", () => {
  it("emits non-empty SVG previews", () => {
    clearPathMorphingDecorationPreviewCache();
    const nonePreview = renderPathMorphingDecorationPreviewSvg("none", 0.8);
    const zigzagPreview = renderPathMorphingDecorationPreviewSvg("zigzag", 0.8);

    expect(nonePreview).toContain("<svg");
    expect(zigzagPreview).toContain("<svg");
    expect(zigzagPreview.length).toBeGreaterThan(0);
  });

  it("renders distinct output for zigzag vs none", () => {
    clearPathMorphingDecorationPreviewCache();
    const nonePreview = renderPathMorphingDecorationPreviewSvg("none", 0.8);
    const zigzagPreview = renderPathMorphingDecorationPreviewSvg("zigzag", 0.8);

    expect(zigzagPreview).not.toBe(nonePreview);
  });

  it("degrades gracefully for unsupported decoration names", () => {
    clearPathMorphingDecorationPreviewCache();
    expect(() => renderPathMorphingDecorationPreviewSvg("definitely-unsupported-decoration", 0.8)).not.toThrow();
    const fallbackPreview = renderPathMorphingDecorationPreviewSvg("definitely-unsupported-decoration", 0.8);
    expect(fallbackPreview).toContain("<svg");
  });
});
