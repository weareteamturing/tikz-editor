import { describe, expect, it } from "vitest";
import { parseTikz } from "../../src/parser/index.js";
import { evaluateTikzFigure } from "../../src/semantic/evaluate.js";
import { PT_PER_CM } from "../../src/edit/format.js";
import { resolveResizeFrameForSource } from "../../web/src/ui/canvas-panel/resize-frames";

const TEST_VIEW_BOX = {
  x: -200,
  y: -200,
  width: 400,
  height: 400
};
const cm = (value: number) => value * PT_PER_CM;

function resolveFrame(source: string, sourceId: string) {
  const parsed = parseTikz(source, { recover: true });
  const evaluated = evaluateTikzFigure(parsed.figure, source);
  return resolveResizeFrameForSource(
    evaluated.scene.elements,
    evaluated.editHandles,
    sourceId,
    TEST_VIEW_BOX
  );
}

describe("resize frame geometry", () => {
  it("derives rotated rectangle corners with stable corner-role assignment", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) rectangle (2,1);
\end{tikzpicture}`;
    const frame = resolveFrame(source, "path:0");
    expect(frame).not.toBeNull();
    if (!frame) {
      return;
    }

    const topLeft = frame.cornersByRole["top-left"].world;
    const topRight = frame.cornersByRole["top-right"].world;
    const bottomLeft = frame.cornersByRole["bottom-left"].world;
    const bottomRight = frame.cornersByRole["bottom-right"].world;
    expect(topLeft.x).toBeCloseTo(cm(-Math.SQRT1_2), 3);
    expect(topLeft.y).toBeCloseTo(cm(Math.SQRT1_2), 3);
    expect(topRight.x).toBeCloseTo(cm(Math.SQRT1_2), 3);
    expect(topRight.y).toBeCloseTo(cm(3 * Math.SQRT1_2), 3);
    expect(bottomRight.x).toBeCloseTo(cm(2 * Math.SQRT1_2), 3);
    expect(bottomRight.y).toBeCloseTo(cm(2 * Math.SQRT1_2), 3);
    expect(bottomLeft.x).toBeCloseTo(0, 3);
    expect(bottomLeft.y).toBeCloseTo(0, 3);
  });

  it("uses transformed circle basis so corner handles are not on axis-aligned AABB corners", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) circle (1cm);
\end{tikzpicture}`;
    const frame = resolveFrame(source, "path:0");
    expect(frame).not.toBeNull();
    if (!frame) {
      return;
    }

    const corner = frame.cornersByRole["top-left"].svg;
    const isAabbCorner =
      Math.abs(corner.x - frame.boundsSvg.minX) <= 1e-6 &&
      Math.abs(corner.y - frame.boundsSvg.minY) <= 1e-6;

    expect(isAabbCorner).toBe(false);
  });

  it("builds rotated frame polygons for transform-rotated filled ellipse paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45,fill=yellow] (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;
    const frame = resolveFrame(source, "path:0");
    expect(frame).not.toBeNull();
    if (!frame) {
      return;
    }

    const topLeft = frame.cornersByRole["top-left"].world;
    const topRight = frame.cornersByRole["top-right"].world;
    const topEdge = {
      x: topRight.x - topLeft.x,
      y: topRight.y - topLeft.y
    };

    expect(frame.polygonSvg).toHaveLength(4);
    expect(Math.abs(topEdge.x)).toBeGreaterThan(1e-3);
    expect(Math.abs(topEdge.y)).toBeGreaterThan(1e-3);
  });

  it("builds rotated frame polygons for rotated draw nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,rotate=30] at (0,0) {C};
\end{tikzpicture}`;
    const frame = resolveFrame(source, "path:0");
    expect(frame).not.toBeNull();
    if (!frame) {
      return;
    }

    const topLeft = frame.cornersByRole["top-left"].world;
    const topRight = frame.cornersByRole["top-right"].world;
    const edge = {
      x: topRight.x - topLeft.x,
      y: topRight.y - topLeft.y
    };
    const corner = frame.cornersByRole["top-left"].svg;
    const isAabbCorner =
      Math.abs(corner.x - frame.boundsSvg.minX) <= 1e-6 &&
      Math.abs(corner.y - frame.boundsSvg.minY) <= 1e-6;

    expect(frame.polygonSvg).toHaveLength(4);
    expect(Math.abs(edge.x)).toBeGreaterThan(1e-3);
    expect(Math.abs(edge.y)).toBeGreaterThan(1e-3);
    expect(isAabbCorner).toBe(false);
  });

  it("ignores label and pin adornments when resolving node resize frames", () => {
    const plainSource = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {C};
\end{tikzpicture}`;
    const adornedSource = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L,pin=above:P] at (0,0) {C};
\end{tikzpicture}`;

    const plainFrame = resolveFrame(plainSource, "path:0");
    const adornedFrame = resolveFrame(adornedSource, "path:0");

    expect(plainFrame).not.toBeNull();
    expect(adornedFrame).not.toBeNull();
    if (!plainFrame || !adornedFrame) {
      return;
    }

    expect(adornedFrame.boundsSvg.minX).toBeCloseTo(plainFrame.boundsSvg.minX, 6);
    expect(adornedFrame.boundsSvg.maxX).toBeCloseTo(plainFrame.boundsSvg.maxX, 6);
    expect(adornedFrame.boundsSvg.minY).toBeCloseTo(plainFrame.boundsSvg.minY, 6);
    expect(adornedFrame.boundsSvg.maxY).toBeCloseTo(plainFrame.boundsSvg.maxY, 6);
  });

  it("returns null when frame geometry cannot be resolved from handles", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) circle (1cm);
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const evaluated = evaluateTikzFigure(parsed.figure, source);
    const frame = resolveResizeFrameForSource(
      evaluated.scene.elements,
      [],
      "path:0",
      TEST_VIEW_BOX
    );

    expect(frame).toBeNull();
  });
});
