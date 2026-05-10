import { describe, expect, it } from "vitest";
import { worldPoint } from "../packages/core/src/coords/points.js";
import { pt } from "../packages/core/src/coords/scalars.js";
import { defaultStyle } from "../packages/core/src/semantic/style/defaults.js";
import type { SceneElement } from "../packages/core/src/semantic/types.js";
import {
  clearPathMorphingDecorationPreviewCache,
  computeDecorationPreviewBounds,
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

  it("normalizes blank names, invalid widths, and cached preview keys", () => {
    clearPathMorphingDecorationPreviewCache();

    const blankName = renderPathMorphingDecorationPreviewSvg("", Number.NaN);
    const noneInvalidWidth = renderPathMorphingDecorationPreviewSvg("none", -1);
    const noneDefaultWidth = renderPathMorphingDecorationPreviewSvg(" none ", 0.8);
    const repeated = renderPathMorphingDecorationPreviewSvg("none", 0.8);

    expect(blankName).toBe(noneInvalidWidth);
    expect(noneInvalidWidth).toBe(noneDefaultWidth);
    expect(repeated).toBe(noneDefaultWidth);
  });

  it("clamps line widths and renders curved path-morphing previews", () => {
    clearPathMorphingDecorationPreviewCache();

    const tinyWidth = renderPathMorphingDecorationPreviewSvg(" snake ", 0.01);
    const clampedTinyWidth = renderPathMorphingDecorationPreviewSvg("snake", 0.2);
    const hugeWidth = renderPathMorphingDecorationPreviewSvg("snake", 100);
    const clampedHugeWidth = renderPathMorphingDecorationPreviewSvg("snake", 4);

    expect(tinyWidth).toBe(clampedTinyWidth);
    expect(hugeWidth).toBe(clampedHugeWidth);
    expect(tinyWidth).toContain(" L ");
    expect(hugeWidth).toContain("<svg");
  });

  it("degrades gracefully for unsupported decoration names", () => {
    clearPathMorphingDecorationPreviewCache();
    expect(() => renderPathMorphingDecorationPreviewSvg("definitely-unsupported-decoration", 0.8)).not.toThrow();
    const fallbackPreview = renderPathMorphingDecorationPreviewSvg("definitely-unsupported-decoration", 0.8);
    expect(fallbackPreview).toContain("<svg");
  });

  it("computes preview bounds for non-path fallback scene elements", () => {
    const style = defaultStyle();
    const sourceRef = { sourceId: "preview", sourceSpan: { from: 0, to: 0 }, sourceFingerprint: "" };
    const elements: SceneElement[] = [
      {
        kind: "Circle",
        id: "circle",
        runtimeId: "circle",
        sourceRef,
        style,
        styleChain: [],
        center: worldPoint(pt(10), pt(20)),
        radius: 3
      },
      {
        kind: "Ellipse",
        id: "ellipse",
        runtimeId: "ellipse",
        sourceRef,
        style,
        styleChain: [],
        center: worldPoint(pt(-5), pt(7)),
        rx: 2,
        ry: 4
      },
      {
        kind: "Text",
        id: "text",
        runtimeId: "text",
        sourceRef,
        style,
        styleChain: [],
        position: worldPoint(pt(14), pt(-3)),
        text: "preview",
        textBlockWidth: 6,
        textBlockHeight: 2
      }
    ];

    const bounds = computeDecorationPreviewBounds(elements);
    expect(bounds).toEqual({
      minX: pt(-7),
      minY: pt(-3),
      maxX: pt(20),
      maxY: pt(23)
    });
    expect(computeDecorationPreviewBounds([])).toBeUndefined();
  });
});
