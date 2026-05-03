import { describe, expect, it } from "vitest";

import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

function handleIdFor(source: string, rendered: ReturnType<typeof renderTikzToSvg>, raw: string): string {
  const handle = rendered.semantic.editHandles.find(
    (candidate) => source.slice(candidate.sourceRef.sourceSpan.from, candidate.sourceRef.sourceSpan.to) === raw
  );
  if (!handle) {
    throw new Error(`Handle not found for ${raw}`);
  }
  return handle.id;
}

describe("path edit actions", () => {
  it("splits an open polyline at an interior point", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "splitPath",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(1,0)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
    expect(result.newSource).toContain("\\draw (1,0) -- (2,0);");
  });

  it("splits a cycle-closed polygon into one open path", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "splitPath",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(1,0)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (1,0) -- (1,1) -- (0,0);");
    expect(result.newSource).not.toContain("cycle");
  });

  it("joins two open paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,0) -- (3,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "joinPaths",
      elementIds: ["path:0", "path:1"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0) -- (2,0) -- (3,0);");
    expect(result.newSource.match(/\\draw/g)?.length).toBe(1);
  });

  it("reverses an open polyline", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "reversePath",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (2,0) -- (1,0) -- (0,0);");
  });

  it("reverses cubic segments by swapping controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (4,1) and (5,0) .. (6,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "reversePath",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(
      "\\draw (6,0) .. controls (5,0) and (4,1) .. (3,1) .. controls (2,1) and (1,0) .. (0,0);"
    );
  });

  it("reverses a closed polygon while preserving cycle closure", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "reversePath",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (1,1) -- (1,0) -- cycle;");
  });

  it("closes and reopens an explicit polyline", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const closed = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "toggleClosedPath",
      elementId: "path:0",
      closed: true
    });

    expect(closed.kind).toBe("success");
    if (closed.kind !== "success") return;
    expect(closed.newSource).toContain("-- cycle;");

    const reopenedRender = renderTikzToSvg(closed.newSource);
    const reopened = applyEditAction(closed.newSource, reopenedRender.semantic.editHandles, {
      kind: "toggleClosedPath",
      elementId: "path:0",
      closed: false
    });

    expect(reopened.kind).toBe("success");
    if (reopened.kind !== "success") return;
    expect(reopened.newSource).not.toContain("cycle");
    expect(reopened.newSource).toContain("\\draw (0,0) -- (1,0) -- (1,1);");
  });

  it("deletes an interior point from a polyline", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(1,0)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (2,0);");
  });

  it("deletes an interior point between cubic segments", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (4,1) and (5,0) .. (6,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(3,1)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) .. controls (1,0) and (5,0) .. (6,0);");
  });

  it("deletes a point from a closed polygon while preserving the cycle", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(1,0)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (1,1) -- cycle;");
  });

  it("deletes the start point from a closed polygon by rotating the path start", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(0,0)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (1,0) -- (1,1) -- cycle;");
  });

  it("deletes a point from a closed cubic path", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (4,1) and (5,0) .. (6,0) .. controls (5,-1) and (1,-1) .. cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(3,1)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(
      "\\draw (0,0) .. controls (1,0) and (5,0) .. (6,0) .. controls (5,-1) and (1,-1) .. cycle;"
    );
  });

  it("converts a cubic anchor to corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (4,1) and (5,0) .. (6,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(3,1)"),
      pointKind: "corner"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("and (2,1) .. (3,1) .. controls (4,1)");
  });

  it("converts a cubic anchor to smooth", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,2) and (2,2) .. (3,1) .. controls (4,2) and (5,0) .. (6,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(3,1)"),
      pointKind: "smooth"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("and (2,2) .. (3,1) .. controls (4,2)");
  });

  it("converts an interior polyline point to smooth cubic segments", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-2.33,0) -- (-2.72,1.74) -- (-0.86,2.27);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(-2.72,1.74)"),
      pointKind: "smooth"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(".. controls");
    expect(result.newSource).not.toContain(" -- (-2.72,1.74) -- ");
  });

  it("appends segments to the end of an open path", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "appendToPath",
      elementId: "path:0",
      end: "end",
      segmentSource: "-- (3,0) -- (4,0)"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0) -- (2,0) -- (3,0) -- (4,0);");
  });

  it("prepends segments to the start of an open path", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "appendToPath",
      elementId: "path:0",
      end: "start",
      segmentSource: "(-2,0) -- (-1,0) --"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (-2,0) -- (-1,0) -- (0,0) -- (1,0) -- (2,0);");
  });

  it("rejects appending to a closed path", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "appendToPath",
      elementId: "path:0",
      end: "end",
      segmentSource: "-- (2,0)"
    });

    expect(result.kind).toBe("unsupported");
  });

  it("rejects shorthand shapes for topology edits", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "toggleClosedPath",
      elementId: "path:0",
      closed: false
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: expect.stringContaining("rectangle")
    });
  });
});
