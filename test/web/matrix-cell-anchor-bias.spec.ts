import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";
import { collectSourceWorldBounds } from "../../packages/core/src/edit/snapping/index.js";
import { resolveEndpointAnchorSnap, type MatrixCellAnchorHint } from "../../packages/app/src/ui/canvas-panel/endpoint-anchor-snap";

describe("matrix-cell anchor bias integration", () => {
  it("prefers anchors of the nearest matrix cell when adding path endpoints", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] (m) {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const boundsBySource = collectSourceWorldBounds(rendered.semantic.scene.elements);
    const hintsByCellId = new Map<string, MatrixCellAnchorHint>();
    for (const element of rendered.semantic.scene.elements) {
      const matrixCell = element.matrixCell;
      if (!matrixCell || hintsByCellId.has(matrixCell.cellSourceId)) {
        continue;
      }
      const bounds = boundsBySource.get(matrixCell.cellSourceId);
      if (!bounds) {
        continue;
      }
      hintsByCellId.set(matrixCell.cellSourceId, {
        matrixSourceId: matrixCell.matrixSourceId,
        cellSourceId: matrixCell.cellSourceId,
        row: matrixCell.row,
        column: matrixCell.column,
        bounds: {
          minX: bounds.minX,
          minY: bounds.minY,
          maxX: bounds.maxX,
          maxY: bounds.maxY
        }
      });
    }
    const hints = [...hintsByCellId.values()];
    const cell12 = hints.find((hint) => hint.row === 1 && hint.column === 2);
    if (!cell12) {
      throw new Error("Expected matrix cell (1,2) hint");
    }
    const pointer = {
      x: (cell12.bounds.minX + cell12.bounds.maxX) / 2,
      y: (cell12.bounds.minY + cell12.bounds.maxY) / 2
    };

    const snap = resolveEndpointAnchorSnap({
      pointerWorld: pointer,
      zoom: 1,
      nodeAnchorTargets: rendered.semantic.nodeAnchorTargets,
      matrixCellAnchorHints: hints
    });

    expect(snap.visibleAnchors.length).toBeGreaterThan(0);
    expect(snap.visibleAnchors.some((anchor) => anchor.nodeName === "m-1-2")).toBe(true);
    expect(snap.visibleAnchors.every((anchor) => anchor.nodeName === "m-1-2")).toBe(true);
  });
});
