import { describe, expect, it } from "vitest";
import { getEditActionAvailability } from "../src/edit/action-availability.js";
import { renderTikzToSvg } from "../src/render/index.js";

describe("getEditActionAvailability", () => {
  it("gates align/distribute actions by selection size", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (3,1) -- (4,1);
  \draw (10,4) -- (11,4);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const availability = getEditActionAvailability({
      source,
      snapshotSource: source,
      selectedSourceIds: ["path:0"],
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      hasClipboardContent: false
    });

    expect(availability["align-left"].enabled).toBe(false);
    expect(availability["align-left"].reason).toContain("at least 2");
    expect(availability["distribute-horizontal"].enabled).toBe(false);
    expect(availability["distribute-horizontal"].reason).toContain("at least 3");
  });

  it("gates arrange actions when snapshot/source are out of sync", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,1) -- (3,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const availability = getEditActionAvailability({
      source,
      snapshotSource: `${source} `,
      selectedSourceIds: ["path:0", "path:1"],
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles
    });

    expect(availability["align-left"].enabled).toBe(false);
    expect(availability["align-left"].reason).toContain("recompute");
  });

  it("gates arrange actions when any selected element is non-rewritable", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (A) at (2,0);
  \coordinate (B) at (3,0);
  \draw (0,0) -- (1,0);
  \draw (A) -- (B);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const availability = getEditActionAvailability({
      source,
      snapshotSource: source,
      selectedSourceIds: ["path:2", "path:3"],
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles
    });

    expect(availability["align-left"].enabled).toBe(false);
    expect(availability["align-left"].reason).toContain("unsupported coordinate forms");
  });

  it("gates arrange actions when bounds are missing", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,1) -- (3,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const availability = getEditActionAvailability({
      source,
      snapshotSource: source,
      selectedSourceIds: ["path:0", "missing-id"],
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles
    });

    expect(availability["align-left"].enabled).toBe(false);
    expect(availability["align-left"].reason).toContain("geometry bounds");
  });

  it("gates arrange actions when selected elements have no edit handles", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,1) -- (3,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const availability = getEditActionAvailability({
      source,
      snapshotSource: source,
      selectedSourceIds: ["path:0", "path:1"],
      scene: rendered.semantic.scene,
      editHandles: []
    });

    expect(availability["align-left"].enabled).toBe(false);
    expect(availability["align-left"].reason).toContain("edit handles");
  });

  it("enables arrange actions for rewritable multi-selection", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (3,1) -- (4,1);
  \draw (10,4) -- (11,4);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const availability = getEditActionAvailability({
      source,
      snapshotSource: source,
      selectedSourceIds: ["path:0", "path:1", "path:2"],
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles
    });

    expect(availability["align-left"].enabled).toBe(true);
    expect(availability["distribute-horizontal"].enabled).toBe(true);
    expect(availability["distribute-vertical"].enabled).toBe(true);
  });

  it("disables no-op arrange modes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,2) -- (1,2);
  \draw (0,4) -- (1,4);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const availability = getEditActionAvailability({
      source,
      snapshotSource: source,
      selectedSourceIds: ["path:0", "path:1", "path:2"],
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles
    });

    expect(availability["align-left"].enabled).toBe(false);
    expect(availability["align-left"].reason).toContain("already aligned");
    expect(availability["distribute-vertical"].enabled).toBe(false);
    expect(availability["distribute-vertical"].reason).toContain("already evenly distributed");
  });
});
