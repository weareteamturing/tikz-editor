import { describe, expect, it } from "vitest";
import { PT_PER_CM } from "../../packages/core/src/edit/format.js";
import {
  appendFreehandToolPoint,
  catmullRomToBezierSegments,
  createFreehandToolDraft,
  generateFreehandToolSource,
  resolveFreehandPreviewSegments,
  simplifyFreehandPoints
} from "../../packages/app/src/ui/canvas-panel/freehand-tool.js";

const cm = (value: number): number => value * PT_PER_CM;

describe("freehand-tool", () => {
  it("decimates live points with a minimum spacing threshold", () => {
    const draft = createFreehandToolDraft({ x: cm(0), y: cm(0) }, 1);
    const near = appendFreehandToolPoint(draft, { x: cm(0.02), y: cm(0) });
    const far = appendFreehandToolPoint(near, { x: cm(0.6), y: cm(0) });

    expect(near.points).toHaveLength(1);
    expect(far.points).toHaveLength(2);
  });

  it("simplifies points while preserving endpoints", () => {
    const points = [
      { x: cm(0), y: cm(0) },
      { x: cm(0.01), y: cm(0.01) },
      { x: cm(0.02), y: cm(0.02) },
      { x: cm(0.7), y: cm(0.5) }
    ];

    const simplified = simplifyFreehandPoints(points, cm(0.05));
    expect(simplified[0]).toEqual(points[0]);
    expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1]);
    expect(simplified.length).toBeLessThan(points.length);
  });

  it("converts Catmull-Rom points into cubic Bezier segments", () => {
    const points = [
      { x: cm(0), y: cm(0) },
      { x: cm(1), y: cm(0.5) },
      { x: cm(2), y: cm(0.2) },
      { x: cm(3), y: cm(1) }
    ];

    const segments = catmullRomToBezierSegments(points);
    expect(segments).toHaveLength(points.length - 1);
    expect(segments[0]?.to).toEqual(points[1]);
    expect(segments[1]?.to).toEqual(points[2]);
  });

  it("returns null for degenerate drafts and a TikZ draw statement for valid drafts", () => {
    const degenerate = createFreehandToolDraft({ x: cm(0), y: cm(0) }, 1);
    const withTwoPoints = appendFreehandToolPoint(degenerate, { x: cm(0.8), y: cm(0) });
    expect(generateFreehandToolSource(withTwoPoints, 1, 16)).toBeNull();

    const withThreePoints = appendFreehandToolPoint(withTwoPoints, { x: cm(2), y: cm(1.2) });
    const source = generateFreehandToolSource(withThreePoints, 1, 16);
    expect(source).not.toBeNull();
    expect(source).toContain("\\draw");
    expect(source).toContain(".. controls");
  });

  it("uses smoothing tolerance when generating source output", () => {
    const points = [
      { x: cm(0), y: cm(0) },
      { x: cm(0.45), y: cm(0.02) },
      { x: cm(0.9), y: cm(0.04) },
      { x: cm(1.35), y: cm(0.03) },
      { x: cm(1.8), y: cm(0.01) }
    ];
    let draft = createFreehandToolDraft(points[0]!, 1);
    for (let i = 1; i < points.length; i += 1) {
      draft = appendFreehandToolPoint(draft, points[i]!);
    }

    const lowSmoothing = generateFreehandToolSource(draft, 1, 4);
    const highSmoothing = generateFreehandToolSource(draft, 1, 32);
    expect(lowSmoothing).not.toBeNull();
    expect(highSmoothing).not.toBeNull();
    const lowControls = (lowSmoothing?.match(/\.\. controls/g) ?? []).length;
    const highControls = (highSmoothing?.match(/\.\. controls/g) ?? []).length;
    expect(lowControls).toBeGreaterThan(highControls);
  });

  it("uses smoothing tolerance for preview segment simplification", () => {
    const points = [
      { x: cm(0), y: cm(0) },
      { x: cm(0.45), y: cm(0.02) },
      { x: cm(0.9), y: cm(0.04) },
      { x: cm(1.35), y: cm(0.02) },
      { x: cm(1.8), y: cm(0) }
    ];
    let draft = createFreehandToolDraft(points[0]!, 1);
    for (let i = 1; i < points.length; i += 1) {
      draft = appendFreehandToolPoint(draft, points[i]!);
    }

    const lowSmoothing = resolveFreehandPreviewSegments(draft, 4, 1);
    const highSmoothing = resolveFreehandPreviewSegments(draft, 32, 1);
    expect(lowSmoothing.length).toBeGreaterThan(highSmoothing.length);
  });
});
