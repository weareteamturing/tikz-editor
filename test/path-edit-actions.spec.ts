import { describe, expect, it } from "vitest";

import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { PT_PER_CM } from "../packages/core/src/edit/format.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { wp } from "./coords-helpers.js";

const cm = (value: number) => value * PT_PER_CM;

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

  it("rejects splitting endpoint and unresolved handles", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const endpoint = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "splitPath",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(0,0)")
    });
    expect(endpoint.kind).toBe("unsupported");
    if (endpoint.kind === "unsupported") {
      expect(endpoint.reason).toContain("interior");
    }

    const missing = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "splitPath",
      elementId: "path:0",
      handleId: "missing-handle"
    });
    expect(missing.kind).toBe("unsupported");

    const missingPath = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "splitPath",
      elementId: "path:missing",
      handleId: handleIdFor(source, rendered, "(1,0)")
    });
    expect(missingPath.kind).toBe("unsupported");
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

  it("rejects invalid join selections, cross-scope paths, and closed paths", () => {
    const simple = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const duplicate = applyEditAction(simple, [], {
      kind: "joinPaths",
      elementIds: ["path:0", "path:0"]
    });
    expect(duplicate.kind).toBe("unsupported");
    if (duplicate.kind === "unsupported") {
      expect(duplicate.reason).toContain("exactly two");
    }

    const crossScope = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (2,0) -- (3,0);
  \end{scope}
\end{tikzpicture}`;
    const scoped = applyEditAction(crossScope, [], {
      kind: "joinPaths",
      elementIds: ["path:0", "path:1"]
    });
    expect(scoped.kind).toBe("unsupported");
    if (scoped.kind === "unsupported") {
      expect(scoped.reason).toContain("same scope");
    }

    const closed = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,0) -- (3,0) -- cycle;
\end{tikzpicture}`;
    const closedResult = applyEditAction(closed, [], {
      kind: "joinPaths",
      elementIds: ["path:0", "path:1"]
    });
    expect(closedResult.kind).toBe("unsupported");
    if (closedResult.kind === "unsupported") {
      expect(closedResult.reason).toContain("open explicit paths");
    }

    const ineligible = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
  \draw (2,0) -- (3,0);
\end{tikzpicture}`;
    const ineligibleResult = applyEditAction(ineligible, [], {
      kind: "joinPaths",
      elementIds: ["path:0", "path:1"]
    });
    expect(ineligibleResult.kind).toBe("unsupported");
    if (ineligibleResult.kind === "unsupported") {
      expect(ineligibleResult.reason).toContain("rectangle");
    }
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

  it("rejects no-op close/open requests", () => {
    const open = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const alreadyOpen = applyEditAction(open, [], {
      kind: "toggleClosedPath",
      elementId: "path:0",
      closed: false
    });
    expect(alreadyOpen.kind).toBe("unsupported");
    if (alreadyOpen.kind === "unsupported") {
      expect(alreadyOpen.reason).toContain("already open");
    }

    const closed = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- cycle;
\end{tikzpicture}`;
    const alreadyClosed = applyEditAction(closed, [], {
      kind: "toggleClosedPath",
      elementId: "path:0",
      closed: true
    });
    expect(alreadyClosed.kind).toBe("unsupported");
    if (alreadyClosed.kind === "unsupported") {
      expect(alreadyClosed.reason).toContain("already closed");
    }
  });

  it("rejects reversing or toggling unresolved and degenerate paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0);
\end{tikzpicture}`;

    const missingReverse = applyEditAction(source, [], {
      kind: "reversePath",
      elementId: "path:missing"
    });
    expect(missingReverse.kind).toBe("unsupported");

    const degenerateReverse = applyEditAction(source, [], {
      kind: "reversePath",
      elementId: "path:0"
    });
    expect(degenerateReverse.kind).toBe("unsupported");

    const missingToggle = applyEditAction(source, [], {
      kind: "toggleClosedPath",
      elementId: "path:missing",
      closed: true
    });
    expect(missingToggle.kind).toBe("unsupported");
  });

  it("opens a curve-cycle path by dropping the closing cubic cycle segment", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (2,-1) and (1,-1) .. cycle;
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "toggleClosedPath",
      elementId: "path:0",
      closed: false
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) .. controls (1,0) and (2,1) .. (3,1);");
    expect(result.newSource).not.toContain("cycle");
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

  it("rejects deleting endpoints, tiny closed paths, and mixed line-cubic anchors", () => {
    const open = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const openRendered = renderTikzToSvg(open);
    const endpoint = applyEditAction(open, openRendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(open, openRendered, "(0,0)")
    });
    expect(endpoint.kind).toBe("unsupported");
    if (endpoint.kind === "unsupported") {
      expect(endpoint.reason).toContain("interior");
    }

    const tinyClosed = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- cycle;
\end{tikzpicture}`;
    const tinyRendered = renderTikzToSvg(tinyClosed);
    const tooFew = applyEditAction(tinyClosed, tinyRendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(tinyClosed, tinyRendered, "(0,0)")
    });
    expect(tooFew.kind).toBe("unsupported");
    if (tooFew.kind === "unsupported") {
      expect(tooFew.reason).toContain("too few");
    }

    const mixed = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) .. controls (1,1) and (2,1) .. (2,0);
\end{tikzpicture}`;
    const mixedRendered = renderTikzToSvg(mixed);
    const unsupportedConversion = applyEditAction(mixed, mixedRendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(mixed, mixedRendered, "(1,0)")
    });
    expect(unsupportedConversion.kind).toBe("unsupported");
    if (unsupportedConversion.kind === "unsupported") {
      expect(unsupportedConversion.reason).toContain("unsupported segment conversion");
    }
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

  it("rejects converting endpoints and line-cubic mixed anchors to corner", () => {
    const endpointSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const endpointRender = renderTikzToSvg(endpointSource);
    const endpoint = applyEditAction(endpointSource, endpointRender.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: handleIdFor(endpointSource, endpointRender, "(0,0)"),
      pointKind: "smooth"
    });
    expect(endpoint.kind).toBe("unsupported");
    if (endpoint.kind === "unsupported") {
      expect(endpoint.reason).toContain("interior");
    }

    const mixedSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) .. controls (1,1) and (2,1) .. (2,0);
\end{tikzpicture}`;
    const mixedRender = renderTikzToSvg(mixedSource);
    const mixed = applyEditAction(mixedSource, mixedRender.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: handleIdFor(mixedSource, mixedRender, "(1,0)"),
      pointKind: "corner"
    });
    expect(mixed.kind).toBe("unsupported");
    if (mixed.kind === "unsupported") {
      expect(mixed.reason).toContain("cubic");
    }

    const missingHandle = applyEditAction(mixedSource, mixedRender.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: "missing-handle",
      pointKind: "smooth"
    });
    expect(missingHandle.kind).toBe("unsupported");
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

    const missing = applyEditAction(source, [], {
      kind: "appendToPath",
      elementId: "path:missing",
      end: "end",
      segmentSource: "-- (2,0)"
    });
    expect(missing.kind).toBe("unsupported");
  });

  it("inserts a point into a line segment at the closest point", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "insertPathPoint",
      elementId: "path:0",
      segmentIndex: 0,
      point: wp(cm(0.75), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (0.75,0) -- (2,0);");
  });

  it("inserts a point into a cubic segment by subdividing controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "insertPathPoint",
      elementId: "path:0",
      segmentIndex: 0,
      point: wp(cm(1.5), cm(0.5))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(".. controls");
    expect(result.newSource.match(/\.\. controls/g)?.length).toBe(2);
    expect(result.newSource).toContain(".. (3,1);");
  });

  it("inserts a point into a closed path while preserving the closing segment", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) -- (2,2) -- cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "insertPathPoint",
      elementId: "path:0",
      segmentIndex: 0,
      point: wp(cm(1), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0) -- (2,0) -- (2,2) -- cycle;");
  });

  it("rejects point insertion with invalid segment indices or missing handles", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const invalidSegment = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "insertPathPoint",
      elementId: "path:0",
      segmentIndex: 10,
      point: wp(cm(1), 0)
    });
    expect(invalidSegment.kind).toBe("unsupported");
    if (invalidSegment.kind === "unsupported") {
      expect(invalidSegment.reason).toContain("Invalid segment");
    }

    const missingHandles = applyEditAction(source, [], {
      kind: "insertPathPoint",
      elementId: "path:0",
      segmentIndex: 0,
      point: wp(cm(1), 0)
    });
    expect(missingHandles.kind).toBe("unsupported");
    if (missingHandles.kind === "unsupported") {
      expect(missingHandles.reason).toContain("endpoint positions");
    }

    const missingPath = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "insertPathPoint",
      elementId: "path:missing",
      segmentIndex: 0,
      point: wp(cm(1), 0)
    });
    expect(missingPath.kind).toBe("unsupported");
  });

  it("rejects cubic insertion when control handles are unavailable", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(
      source,
      rendered.semantic.editHandles.filter((handle) => handle.kind !== "path-control"),
      {
        kind: "insertPathPoint",
        elementId: "path:0",
        segmentIndex: 0,
        point: wp(cm(1.5), cm(0.5))
      }
    );

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("control point positions");
    }
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
