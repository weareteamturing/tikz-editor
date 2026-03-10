import { describe, expect, it } from "vitest";
import { computeSnapshot } from "../../packages/app/src/compute";
import { applyEditAction } from "../../packages/core/src/edit/actions";
import { PT_PER_CM } from "../../packages/core/src/edit/format";

const cm = (value: number): number => value * PT_PER_CM;

describe("cutover regressions", () => {
  it("updates rendered scene after source edits", async () => {
    const sourceA = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;
    const sourceB = String.raw`\begin{tikzpicture}
  \node[draw] at (2,1) {A};
\end{tikzpicture}`;

    const first = await computeSnapshot({
      id: "cutover-render-a",
      kind: "render",
      source: sourceA
    });
    const second = await computeSnapshot({
      id: "cutover-render-b",
      kind: "render",
      source: sourceB
    });

    const firstText = first.snapshot.scene?.elements.find((element) => element.kind === "Text");
    const secondText = second.snapshot.scene?.elements.find((element) => element.kind === "Text");
    expect(firstText).toBeDefined();
    expect(secondText).toBeDefined();
    if (!firstText || !secondText || firstText.kind !== "Text" || secondText.kind !== "Text") {
      throw new Error("Expected text elements in both snapshots.");
    }

    expect(firstText.position).toEqual({ x: 0, y: 0 });
    expect(secondText.position).toEqual({ x: cm(2), y: cm(1) });
    expect(first.snapshot.svg?.svg).not.toEqual(second.snapshot.svg?.svg);
  });

  it("keeps handle-driven edits working after a code edit and recompute", async () => {
    const baseSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1);
  \draw (2,2) -- (3,3);
\end{tikzpicture}`;
    const editedSource = String.raw`\begin{tikzpicture}
  % formatting-only edit before drag
  \draw (0,0) -- (1,1);
  \draw (2,2) -- (3,3);
\end{tikzpicture}`;

    await computeSnapshot({
      id: "cutover-drag-prewarm",
      kind: "render",
      source: baseSource
    });
    const recomputed = await computeSnapshot({
      id: "cutover-drag-recompute",
      kind: "render",
      source: editedSource
    });

    const secondPathHandle = recomputed.snapshot.editHandles.find(
      (handle) => handle.kind === "path-point" && handle.sourceRef.sourceId === "path:1"
    );
    expect(secondPathHandle).toBeDefined();
    if (!secondPathHandle) {
      throw new Error("Expected a path-point handle for path:1");
    }

    const moved = applyEditAction(editedSource, recomputed.snapshot.editHandles, {
      kind: "moveHandle",
      handleId: secondPathHandle.id,
      newWorld: {
        x: secondPathHandle.world.x + cm(1),
        y: secondPathHandle.world.y + cm(1)
      }
    });

    expect(moved.kind).toBe("success");
  });
});
