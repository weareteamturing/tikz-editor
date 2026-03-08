import { describe, expect, it } from "vitest";
import { computeSnapshot } from "../../apps/web/src/compute";

describe("computeSnapshot incremental triggers", () => {
  it("uses incremental compute for drag-element triggers used by resize drags", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {Long label text};
\end{tikzpicture}`;

    const response = await computeSnapshot({
      id: "resize-drag-incremental",
      kind: "render",
      source,
      changedSourceIds: ["path:0"],
      trigger: "drag-element"
    });

    expect(response.snapshot.incremental).not.toBeNull();
    expect(response.snapshot.incremental?.trigger).toBe("drag-element");
    expect(response.snapshot.incremental?.changedSourceIds).toEqual(["path:0"]);
  });
});
