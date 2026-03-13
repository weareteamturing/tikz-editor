import { describe, expect, it } from "vitest";

import { computeSnapshot } from "../../packages/app/src/compute.js";
import { deriveSingleSourcePatch } from "../../packages/app/src/store/source-patch-diff.js";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";

describe("computeSnapshot incremental parser integration", () => {
  it("uses parser and semantic incremental paths for move drags and keeps dependent edges correct", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (0,0) {A};
  \node[draw] (B) at (2,0) {B};
  \draw (A) edge (B);
\end{tikzpicture}`;
    const nextSource = source.replace("(2,0)", "(2.5,0.6)");

    const seeded = await computeSnapshot({
      id: "drag-move-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });

    const incremental = await computeSnapshot({
      id: "drag-move-incremental",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:1"],
      patches: [computeSinglePatch(source, nextSource)],
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "drag-move-canonical",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(incremental.snapshot.incremental?.strategy).toBeDefined();
    expect(incremental.snapshot.scene).toEqual(canonical.snapshot.scene);
    expect(incremental.snapshot.svg?.svg).toBe(canonical.snapshot.svg?.svg);
  });

  it("uses parser incremental patching for resize drags", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {Long label text};
\end{tikzpicture}`;

    const seeded = await computeSnapshot({
      id: "resize-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });
    const action = applyEditAction(source, seeded.snapshot.editHandles, {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: { x: 90, y: 0 }
    });
    expect(action.kind === "success" || action.kind === "partial").toBe(true);
    if (!(action.kind === "success" || action.kind === "partial")) {
      throw new Error(`resizeElement failed: ${action.kind}`);
    }

    const incremental = await computeSnapshot({
      id: "resize-incremental",
      kind: "render",
      source: action.newSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: action.changedSourceIds ?? ["path:0"],
      patches: action.patches,
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "resize-canonical",
      kind: "render",
      source: action.newSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(incremental.snapshot.incremental?.trigger).toBe("drag-element");
    expect(incremental.snapshot.scene).toEqual(canonical.snapshot.scene);
  });

  it("reports selective semantic replay for a small dependency closure with a long suffix", async () => {
    const source = makeClosureFigureWithLongTail(200);
    const nextSource = source.replace("(1.5, -0.5)", "(2.1, -0.1)");

    const seeded = await computeSnapshot({
      id: "closure-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });

    const incremental = await computeSnapshot({
      id: "closure-incremental",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:1"],
      patches: [computeSinglePatch(source, nextSource)],
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "closure-canonical",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.replayMode).toBe("selective");
    expect(incremental.snapshot.incremental?.corridorEndStatementIndex).toBe(3);
    expect(incremental.snapshot.incremental?.affectedStatementCount).toBe(2);
    expect(incremental.snapshot.scene).toEqual(canonical.snapshot.scene);
    expect(incremental.snapshot.svg?.svg).toBe(canonical.snapshot.svg?.svg);
  });

  it("keeps later graphical scopes on the selective path", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (0,0) {A};
  \node[draw] (B) at (2,0) {B};
  \draw (A) -- (B);
  \begin{scope}[shift={(10,0)}]
    \draw (0,0) rectangle (2,1);
    \node[draw] at (1,0.5) {Box};
  \end{scope}
\end{tikzpicture}`;
    const nextSource = source.replace("(2,0)", "(2.4,0.5)");

    const seeded = await computeSnapshot({
      id: "scope-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });

    const incremental = await computeSnapshot({
      id: "scope-incremental",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:1"],
      patches: [computeSinglePatch(source, nextSource)],
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "scope-canonical",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.replayMode).toBe("selective");
    expect(incremental.snapshot.scene).toEqual(canonical.snapshot.scene);
  });

  it("keeps later foreach-origin fragments on the selective path", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (0,0) {A};
  \node[draw] (B) at (2,0) {B};
  \draw (A) -- (B);
  \foreach \x in {0,1,2,3} {
    \draw (\x,3) circle (0.2);
  }
\end{tikzpicture}`;
    const nextSource = source.replace("(2,0)", "(2.3,0.35)");

    const seeded = await computeSnapshot({
      id: "foreach-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });

    const incremental = await computeSnapshot({
      id: "foreach-incremental",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:1"],
      patches: [computeSinglePatch(source, nextSource)],
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "foreach-canonical",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.replayMode).toBe("selective");
    expect(incremental.snapshot.scene).toEqual(canonical.snapshot.scene);
  });

  it("keeps handle drags working when statement children regenerate ids", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1);
\end{tikzpicture}`;
    const nextSource = source.replace("(1,0)", "(1.2,0.35)");

    const seeded = await computeSnapshot({
      id: "handle-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });

    const incremental = await computeSnapshot({
      id: "handle-incremental",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:0"],
      patches: [computeSinglePatch(source, nextSource)],
      trigger: "drag-handle"
    });
    const canonical = await computeSnapshot({
      id: "handle-canonical",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(incremental.snapshot.incremental?.trigger).toBe("drag-handle");
    expect(incremental.snapshot.scene).toEqual(canonical.snapshot.scene);
  });

  it("reuses the cached parse session for unchanged-source prewarm requests", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    await computeSnapshot({
      id: "prewarm-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });
    const prewarm = await computeSnapshot({
      id: "prewarm-reuse",
      kind: "prewarm",
      source
    });

    expect(prewarm.snapshot.source).toBe(source);
    expect(prewarm.snapshot.parseResult).toBeNull();
    expect(prewarm.diagnostics).toEqual([]);
  });

  it("returns to the canonical full path after a drag frame", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const nextSource = source.replace("(1,0)", "(1.2,0)");

    const seeded = await computeSnapshot({
      id: "canonical-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });
    const dragFrame = await computeSnapshot({
      id: "canonical-drag",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:0"],
      patches: [computeSinglePatch(source, nextSource)],
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "canonical-refresh",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(dragFrame.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(canonical.snapshot.incremental).toBeNull();
  });

  it("uses the incremental path for source scrubbing when a single contiguous patch is available", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1.0,0);
\end{tikzpicture}`;
    const nextSource = source.replace("1.0", "1.25");

    const seeded = await computeSnapshot({
      id: "scrub-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });
    const patches = deriveSingleSourcePatch(source, nextSource);
    expect(patches).not.toBeNull();
    if (!patches) {
      throw new Error("Expected a contiguous scrub patch");
    }

    const incremental = await computeSnapshot({
      id: "scrub-incremental",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:0"],
      patches,
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "scrub-canonical",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(incremental.snapshot.scene).toEqual(canonical.snapshot.scene);
  });
});

function computeSinglePatch(oldSource: string, newSource: string) {
  let prefix = 0;
  const limit = Math.min(oldSource.length, newSource.length);
  while (prefix < limit && oldSource.charCodeAt(prefix) === newSource.charCodeAt(prefix)) {
    prefix += 1;
  }

  let oldSuffix = oldSource.length;
  let newSuffix = newSource.length;
  while (
    oldSuffix > prefix &&
    newSuffix > prefix &&
    oldSource.charCodeAt(oldSuffix - 1) === newSource.charCodeAt(newSuffix - 1)
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }

  return {
    oldSpan: { from: prefix, to: oldSuffix },
    newSpan: { from: prefix, to: newSuffix },
    replacement: newSource.slice(prefix, newSuffix)
  };
}

function makeClosureFigureWithLongTail(unrelatedPathCount: number): string {
  const lines = [
    "\\begin{tikzpicture}",
    "  \\node[draw] (A) at (-1, -1) {A};",
    "  \\node[draw] (B) at (1.5, -0.5) {B};",
    "  \\node[draw] (C) at (0, 1.5) {C};",
    "  \\draw (A) edge (B)",
    "        (B) edge (C)",
    "        (C) edge (A);"
  ];
  for (let index = 0; index < unrelatedPathCount; index += 1) {
    lines.push(`  \\draw (${index},0) -- (${index + 1},1);`);
  }
  lines.push("\\end{tikzpicture}");
  return lines.join("\n");
}
