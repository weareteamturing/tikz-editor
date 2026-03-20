import { describe, expect, it } from "vitest";
import {
  clampContextMenuAnchor,
  resolveCanvasContextMenuTarget
} from "../../packages/app/src/ui/canvas-panel/context-menu-target.js";

describe("canvas context menu target resolution", () => {
  it("selects unselected element before opening context menu", () => {
    const result = resolveCanvasContextMenuTarget({
      source: String.raw`\draw (0,0) -- (1,1);`,
      toolMode: "select",
      clickedSourceId: "path:2",
      selectedElementIds: new Set(["path:1"])
    });

    expect(result.target).toBe("selection-single");
    expect(result.selectionAction).toEqual({ kind: "select-only", sourceId: "path:2" });
  });

  it("keeps multi-selection when right-clicking an already selected element", () => {
    const result = resolveCanvasContextMenuTarget({
      source: String.raw`\draw (0,0) -- (1,1);`,
      toolMode: "select",
      clickedSourceId: "path:2",
      selectedElementIds: new Set(["path:1", "path:2"])
    });

    expect(result.target).toBe("selection-multi");
    expect(result.selectionAction).toEqual({ kind: "preserve" });
  });

  it("clears selection when right-clicking blank canvas", () => {
    const result = resolveCanvasContextMenuTarget({
      source: String.raw`\draw (0,0) -- (1,1);`,
      toolMode: "select",
      clickedSourceId: null,
      selectedElementIds: new Set(["path:1"])
    });

    expect(result.target).toBe("canvas-empty");
    expect(result.selectionAction).toEqual({ kind: "clear" });
  });

  it("works in draw mode without requiring a mode switch", () => {
    const result = resolveCanvasContextMenuTarget({
      source: String.raw`\draw (0,0) -- (1,1);`,
      toolMode: "addRect",
      clickedSourceId: null,
      selectedElementIds: new Set(["path:1"])
    });

    expect(result.target).toBe("canvas-empty");
    expect(result.selectionAction).toEqual({ kind: "clear" });
  });

  it("recognizes node selections for the node-specific context menu", () => {
    const result = resolveCanvasContextMenuTarget({
      source: String.raw`\begin{tikzpicture}\node[draw] (a) at (0,0) {A};\end{tikzpicture}`,
      toolMode: "select",
      clickedSourceId: "node:0:3",
      selectedElementIds: new Set(["node:0:3"])
    });

    expect(result.target).toBe("selection-single-node");
  });

  it("recognizes tree-root selections for tree-specific context menu", () => {
    const result = resolveCanvasContextMenuTarget({
      source: String.raw`\begin{tikzpicture}
  \path node {Root} child { node {Leaf} };
\end{tikzpicture}`,
      toolMode: "select",
      clickedSourceId: "path:0",
      selectedElementIds: new Set(["path:0"])
    });

    expect(result.target).toBe("selection-single-tree");
  });

  it("recognizes tree-child selections for tree-specific context menu", () => {
    const result = resolveCanvasContextMenuTarget({
      source: String.raw`\begin{tikzpicture}
  \path node {Root} child { node {Leaf} };
\end{tikzpicture}`,
      toolMode: "select",
      clickedSourceId: "path:0:tree-child:1:child-operation:0:2",
      selectedElementIds: new Set(["path:0:tree-child:1:child-operation:0:2"])
    });

    expect(result.target).toBe("selection-single-tree");
  });
});

describe("context menu clamping", () => {
  it("keeps the anchor within viewport bounds", () => {
    const clamped = clampContextMenuAnchor(
      { x: 490, y: 350 },
      { width: 160, height: 140 },
      { width: 500, height: 360 },
      4
    );

    expect(clamped).toEqual({ x: 336, y: 216 });
  });
});
