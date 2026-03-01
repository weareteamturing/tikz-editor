import { describe, expect, it } from "vitest";
import type { EditHandle, Point } from "../src/semantic/types.js";
import type { NodeTextEngine } from "../src/text/types.js";
import { identityMatrix } from "../src/semantic/transform.js";
import { applyEditAction } from "../src/edit/actions.js";
import { PT_PER_CM } from "../src/edit/format.js";
import { computeSourceFingerprint } from "../src/utils/source-fingerprint.js";
import { parseTikz } from "../src/parser/index.js";
import { evaluateTikzFigure } from "../src/semantic/evaluate.js";

const cm = (v: number) => v * PT_PER_CM;

function makeHandle(
  source: string,
  overrides: Partial<EditHandle> & {
    world: Point;
    sourceSpan: { from: number; to: number };
    sourceId?: string;
  }
): EditHandle {
  const span = overrides.sourceSpan;
  return {
    id: `handle-${span.from}-${span.to}`,
    sourceId: overrides.sourceId ?? "elem-1",
    kind: "path-point",
    world: overrides.world,
    transform: identityMatrix(),
    sourceSpan: span,
    sourceText: source.slice(span.from, span.to),
    sourceFingerprint: computeSourceFingerprint(source),
    coordinateForm: overrides.coordinateForm ?? "cartesian",
    rewriteMode: overrides.rewriteMode ?? "direct",
    ...overrides
  };
}

// ── moveHandle ─────────────────────────────────────────────────────────────────

describe("applyEditAction – moveHandle", () => {
  it("moves a cartesian handle to a new world position", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const handle = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 6, to: 11 }
    });

    const result = applyEditAction(source, [handle], {
      kind: "moveHandle",
      handleId: handle.id,
      newWorld: { x: cm(5), y: cm(6) }
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toBe("\\draw (5,6) -- (3,4);");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("returns unsupported for unknown handle id", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const result = applyEditAction(source, [], {
      kind: "moveHandle",
      handleId: "nonexistent",
      newWorld: { x: cm(5), y: cm(6) }
    });
    expect(result.kind).toBe("error");
  });

  it("returns unsupported for unsupported coordinate form", () => {
    const source = "\\draw (A) -- (B);";
    const handle = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 6, to: 9 },
      coordinateForm: "named",
      rewriteMode: "unsupported"
    });

    const result = applyEditAction(source, [handle], {
      kind: "moveHandle",
      handleId: handle.id,
      newWorld: { x: cm(3), y: cm(4) }
    });
    expect(result.kind).toBe("unsupported");
  });
});

// ── moveElement ────────────────────────────────────────────────────────────────

describe("applyEditAction – moveElement", () => {
  it("moves all handles of an element by a delta", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const h1 = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 6, to: 11 },
      sourceId: "elem-1"
    });
    const h2 = makeHandle(source, {
      world: { x: cm(3), y: cm(4) },
      sourceSpan: { from: 15, to: 20 },
      id: "handle-15-20",
      sourceId: "elem-1"
    } as Parameters<typeof makeHandle>[1]);

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElement",
      elementId: "elem-1",
      delta: { x: cm(1), y: cm(1) }
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toBe("\\draw (2,3) -- (4,5);");
    }
  });

  it("moves handles for multiple element ids in one action", () => {
    const source = "\\node (A) at (1,2) {}; \\node (B) at (3,4) {};";
    const h1 = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 14, to: 19 },
      sourceId: "path:0"
    });
    const h2 = makeHandle(source, {
      world: { x: cm(3), y: cm(4) },
      sourceSpan: { from: 34, to: 39 },
      id: "handle-34-39",
      sourceId: "path:1"
    } as Parameters<typeof makeHandle>[1]);

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElements",
      elementIds: ["path:0", "path:1"],
      delta: { x: cm(1), y: cm(0) }
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("(2,2)");
      expect(result.newSource).toContain("(4,4)");
    }
  });

  it("returns unsupported when element has no handles", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "nonexistent",
      delta: { x: cm(1), y: cm(1) }
    });
    expect(result.kind).toBe("unsupported");
  });

  it("returns partial when some handles are unsupported", () => {
    const source = "\\draw (A) -- (1,2);";
    const unsupported = makeHandle(source, {
      world: { x: cm(0), y: cm(0) },
      sourceSpan: { from: 6, to: 9 },
      sourceId: "elem-1",
      coordinateForm: "named",
      rewriteMode: "unsupported"
    });
    // "\\draw (A) -- (1,2);" → "(1,2)" is at positions 13..17 (span end = 18)
    const supported = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 13, to: 18 },
      sourceId: "elem-1"
    });

    const result = applyEditAction(source, [unsupported, supported], {
      kind: "moveElement",
      elementId: "elem-1",
      delta: { x: cm(1), y: cm(0) }
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.skippedHandles).toHaveLength(1);
      expect(result.newSource).toBe("\\draw (A) -- (2,2);");  // x+1=2, y unchanged=2
    }
  });

  it("applies patches in correct order (handles at different offsets)", () => {
    // Both handles in same source; higher-offset patch applied first
    const source = "\\node (A) at (1,2) {}; \\node (B) at (3,4) {};";
    const h1 = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 14, to: 19 },
      sourceId: "multi"
    });
    const h2 = makeHandle(source, {
      world: { x: cm(3), y: cm(4) },
      sourceSpan: { from: 34, to: 39 },
      id: "handle-34-39",
      sourceId: "multi"
    } as Parameters<typeof makeHandle>[1]);

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElement",
      elementId: "multi",
      delta: { x: cm(10), y: cm(10) }
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("(11,12)");
      expect(result.newSource).toContain("(13,14)");
    }
  });

  it("moves matrix statements by rewriting inline at coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] at (0,0) {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: { x: cm(1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("at (1,2)");
    expect(result.newSource).not.toContain("at=(1,2)");
  });

  it("moves matrix statements by rewriting at options when inline placement is absent", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,at={(0,0)}] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: { x: cm(1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("at={(1,2)}");
  });

  it("moves matrix statements without placement by inserting at=(...)", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: { x: cm(1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toMatch(/matrix of nodes,\s*at=\(1,2\)/);
  });

  it("prefers rewriting inline at when both inline and option placement are present", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,at={(10,10)}] at (0,0) {
    A \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: { x: cm(1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("at={(10,10)}");
    expect(result.newSource).toContain("] at (11,12)");
  });
});

describe("applyEditAction – alignElements", () => {
  const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,2) -- (3,2);
\end{tikzpicture}`;

  it("aligns left/center/right using selection bounds", () => {
    const left = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "left"
    });
    expect(left.kind).toBe("success");
    if (left.kind === "success") {
      expect(left.newSource).toContain("\\draw (0,2) -- (1,2);");
    }

    const center = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "center"
    });
    expect(center.kind).toBe("success");
    if (center.kind === "success") {
      expect(center.newSource).toContain("\\draw (1,0) -- (2,0);");
      expect(center.newSource).toContain("\\draw (1,2) -- (2,2);");
    }

    const right = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "right"
    });
    expect(right.kind).toBe("success");
    if (right.kind === "success") {
      expect(right.newSource).toContain("\\draw (2,0) -- (3,0);");
    }
  });

  it("aligns top/middle/bottom in world y-up coordinates", () => {
    const top = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "top"
    });
    expect(top.kind).toBe("success");
    if (top.kind === "success") {
      expect(top.newSource).toContain("\\draw (0,2) -- (1,2);");
    }

    const middle = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "middle"
    });
    expect(middle.kind).toBe("success");
    if (middle.kind === "success") {
      expect(middle.newSource).toContain("\\draw (0,1) -- (1,1);");
      expect(middle.newSource).toContain("\\draw (2,1) -- (3,1);");
    }

    const bottom = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "bottom"
    });
    expect(bottom.kind).toBe("success");
    if (bottom.kind === "success") {
      expect(bottom.newSource).toContain("\\draw (2,0) -- (3,0);");
    }
  });

  it("returns unsupported for no-op aligns", () => {
    const aligned = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;
    const result = applyEditAction(aligned, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "left"
    });
    expect(result.kind).toBe("unsupported");
  });

  it("fails atomically when any selected element is non-rewritable", () => {
    const mixed = String.raw`\begin{tikzpicture}
  \coordinate (A) at (2,0);
  \coordinate (B) at (3,0);
  \draw (0,0) -- (1,0);
  \draw (A) -- (B);
\end{tikzpicture}`;

    const result = applyEditAction(mixed, [], {
      kind: "alignElements",
      elementIds: ["path:2", "path:3"],
      mode: "left"
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("unsupported coordinate forms");
    }
  });
});

describe("applyEditAction – distributeElements", () => {
  it("distributes horizontal gaps with endpoints fixed", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,0) -- (3,0);
  \draw (10,0) -- (11,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:2"],
      axis: "horizontal"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
      expect(result.newSource).toContain("\\draw (5,0) -- (6,0);");
      expect(result.newSource).toContain("\\draw (10,0) -- (11,0);");
    }
  });

  it("distributes vertical gaps with endpoints fixed", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,10) -- (1,10);
  \draw (0,6) -- (1,6);
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:2"],
      axis: "vertical"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,10) -- (1,10);");
      expect(result.newSource).toContain("\\draw (0,5) -- (1,5);");
      expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
    }
  });

  it("returns unsupported for no-op distributions", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,4) -- (1,4);
  \draw (0,2) -- (1,2);
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:2"],
      axis: "vertical"
    });
    expect(result.kind).toBe("unsupported");
  });

  it("fails atomically when any selected element is non-rewritable", () => {
    const mixed = String.raw`\begin{tikzpicture}
  \coordinate (A) at (2,0);
  \coordinate (B) at (3,0);
  \draw (0,0) -- (1,0);
  \draw (A) -- (B);
  \draw (10,0) -- (11,0);
\end{tikzpicture}`;
    const result = applyEditAction(mixed, [], {
      kind: "distributeElements",
      elementIds: ["path:2", "path:3", "path:4"],
      axis: "horizontal"
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("unsupported coordinate forms");
    }
  });
});

// ── setProperty ───────────────────────────────────────────────────────────────

describe("applyEditAction – setProperty", () => {
  const lineWidthPresetKeys = [
    "ultra thin",
    "very thin",
    "thin",
    "semithick",
    "thick",
    "very thick",
    "ultra thick"
  ];

  it("updates an existing command option key", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, line width=0.4pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line width",
      value: "1.2pt"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[blue, line width=1.2pt] (0,0) -- (1,0);");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("supports writing named line width flags while clearing numeric line width", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, line width=0.2pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "very thin",
      value: "true",
      clearKeys: ["line width", ...lineWidthPresetKeys.filter((key) => key !== "very thin")]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[blue, very thin] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("line width=");
    }
  });

  it("supports writing numeric line width while clearing preset flags", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, very thin] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line width",
      value: "1.3pt",
      clearKeys: lineWidthPresetKeys
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[blue, line width=1.3pt] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("very thin");
    }
  });

  it("inserts a new command option list when none exists", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[red] (0,0) -- (1,0);");
    }
  });

  it("serializes fill color as a bare option when setting color on a \\fill path", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "yellow"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\fill[yellow] (0,0) rectangle (1,1);");
    }
  });

  it("replaces existing bare draw color flags instead of appending duplicates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, thick] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[red, thick] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("blue");
    }
  });

  it("serializes updated draw key values as bare colors on \\draw paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue, thick] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "green"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[green, thick] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("draw=");
    }
  });

  it("inserts node options when targeting a node item id", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      throw new Error("Expected first statement to be a path");
    }
    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (!node || node.kind !== "Node") {
      throw new Error("Expected a node item");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: "fill",
      value: "yellow"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) node[fill=yellow] {A};");
    }
  });

  it("returns unsupported when the target id is missing", () => {
    const result = applyEditAction("\\draw (0,0);", [], {
      kind: "setProperty",
      elementId: "missing",
      level: "command",
      key: "color",
      value: "red"
    });
    expect(result.kind).toBe("unsupported");
  });
});

describe("applyEditAction – resizeElement", () => {
  it("writes minimum width and minimum height when growing from a corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: 100, y: 100 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=");
    expect(result.newSource).toContain("minimum height=");
  });

  it("removes minimum width/height when shrinking below the intrinsic floor", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum width=100pt,minimum height=80pt] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: { x: 0, y: 0 }
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("minimum width");
    expect(result.newSource).not.toContain("minimum height");
  });

  it("updates only the axis targeted by the resize role", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum height=40pt] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: { x: 90, y: 0 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=");
    expect(result.newSource).toContain("minimum height=40pt");
  });

  it("removes the full option list when resize drops the last minimum constraints", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[minimum width=100pt,minimum height=80pt] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: 0, y: 0 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("minimum width");
    expect(result.newSource).not.toContain("minimum height");
    expect(result.newSource).not.toContain("[]");
  });

  it("uses the provided text engine when computing intrinsic resize floors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum width=120pt] at (0,0) {Long label text};
\end{tikzpicture}`;
    const fakeTextEngine: NodeTextEngine = {
      validate: () => null,
      measure: () => ({
        cacheKey: "fake-measure",
        width: 40,
        height: 10,
        baselineY: -2,
        midLineY: 0
      }),
      renderFromCache: () => null
    };

    const result = applyEditAction(
      source,
      [],
      {
        kind: "resizeElement",
        elementId: "path:0",
        role: "right",
        newWorld: { x: 45, y: 0 }
      },
      { evaluateOptions: { textEngine: fakeTextEngine } }
    );

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=90pt");
  });

  it("resizes circle statements that use coordinate radius payloads", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1.2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle (2cm)");
  });

  it("resizes filled circle statements that are emitted as path geometry", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) circle (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1.2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle (2cm)");
  });

  it("resizes ellipse statements that use explicit x/y radius options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("resizes filled ellipse statements that are emitted as path geometry", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("preserves ellipse aspect ratio when preserveAspect is enabled", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(1.2), y: cm(0.4) },
      preserveAspect: true
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=1.2cm");
    expect(result.newSource).toContain("y radius=0.6cm");
  });

  it("uses the provided preserveAspectRatio instead of the current ratio", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1.2cm, y radius=0.4cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(0.5) },
      preserveAspect: true,
      preserveAspectRatio: 0.5
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("resizes ellipse statements where y radius is larger than x radius", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-1.88,1.26) ellipse [x radius=0.38cm, y radius=0.88cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(-0.68), y: cm(2.76) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=1.2cm");
    expect(result.newSource).toContain("y radius=1.5cm");
  });

  it("resizes transform-rotated ellipse statements emitted as ellipse primitives", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1.2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2.26cm");
    expect(result.newSource).toContain("y radius=0.57cm");
  });

  it("resizes transform-rotated filled ellipse path statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45,fill=yellow] (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1.2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2.26cm");
    expect(result.newSource).toContain("y radius=0.57cm");
  });

  it("resizes transform-rotated rectangle statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: { x: cm(-1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[rotate=45] (0.71,0) rectangle (2,2.12);");
  });

  it("keeps rotated rectangle corner drags continuous across world-topness changes", () => {
    let currentSource = String.raw`\begin{tikzpicture}[rotate=40]
  \draw (-3.73,-1.69) rectangle (2.91,2.78);
\end{tikzpicture}`;

    const dragX = 3.316;
    const dragYValues = [0.58, 0.2, -0.1, -0.3, -0.5, -0.7];
    const rewrittenTargetYValues: number[] = [];

    for (const dragY of dragYValues) {
      const result = applyEditAction(currentSource, [], {
        kind: "resizeElement",
        elementId: "path:0",
        role: "top-right",
        newWorld: { x: cm(dragX), y: cm(dragY) }
      });

      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        return;
      }
      currentSource = result.newSource;

      const targetMatch = currentSource.match(/rectangle\s*\(\s*[-+0-9.]+\s*,\s*([-+0-9.]+)\s*\)/);
      expect(targetMatch).not.toBeNull();
      if (!targetMatch) {
        return;
      }
      rewrittenTargetYValues.push(Number(targetMatch[1]));
    }

    for (let index = 1; index < rewrittenTargetYValues.length; index += 1) {
      const prev = rewrittenTargetYValues[index - 1]!;
      const next = rewrittenTargetYValues[index]!;
      expect(Math.abs(next - prev)).toBeLessThan(2);
    }
  });

  it("keeps rotated node corner drags stable at existing corners", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,rotate=30] at (0,0) {A};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const nodeBoxPath = semantic.scene.elements.find(
      (element): element is Extract<typeof semantic.scene.elements[number], { kind: "Path" }> =>
        element.sourceId === "path:0" && element.kind === "Path"
    );
    expect(nodeBoxPath).toBeDefined();
    if (!nodeBoxPath) {
      return;
    }

    const corner = nodeBoxPath.commands.find(
      (command): command is Extract<typeof nodeBoxPath.commands[number], { kind: "M" | "L" }> =>
        command.kind === "M" || command.kind === "L"
    )?.to;
    expect(corner).toBeDefined();
    if (!corner) {
      return;
    }

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-right",
      newWorld: corner
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.newSource).not.toContain("minimum width");
    expect(result.newSource).not.toContain("minimum height");
  });

  it("resizes transform-rotated circle statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) circle (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1.2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[rotate=45] (0,0) circle (2.26cm);");
  });

  it("inserts per-shape radius options when circle radius is inherited from statement options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[radius=1cm] (0,0) circle;
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(1.5), y: cm(1.5) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle[radius=1.5cm]");
  });

  it("resizes rectangle statements using opposite-corner anchoring", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: { x: cm(-1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (-1,0) rectangle (2,2);");
  });

  it("resizes filled rectangle statements using opposite-corner anchoring", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: { x: cm(-1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[fill=yellow] (-1,0) rectangle (2,2);");
  });

  it("updates rectangle relative target coordinates against the moved start corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle +(2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: { x: cm(-1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (-1,0) rectangle +(3,2);");
  });

  it("returns unsupported for non-node elements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: { x: 10, y: 0 }
    });

    expect(result.kind).toBe("unsupported");
  });

  it("reports changedSourceIds for successful resize edits", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: 120, y: 120 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.changedSourceIds).toEqual(["path:0"]);
  });
});

// ── addElement / unimplemented actions ─────────────────────────────────────────

describe("applyEditAction – addElement", () => {
  it("inserts a node snippet before \\end{tikzpicture}", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addElement",
      template: { kind: "node", text: "A" },
      at: { x: cm(2), y: cm(3) }
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("  \\node at (2,3) {A};");
      expect(result.newSource).toContain("\\end{tikzpicture}");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("inserts a bezier snippet with explicit controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addElement",
      template: {
        kind: "bezier",
        to: { x: cm(3), y: cm(1) },
        control1: { x: cm(1), y: cm(2) },
        control2: { x: cm(2), y: cm(2) }
      },
      at: { x: cm(0), y: cm(0) }
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("  \\draw (0,0) .. controls (1,2) and (2,2) .. (3,1);");
      expect(result.newSource).toContain("\\end{tikzpicture}");
      expect(result.patches).toHaveLength(1);
    }
  });
});

describe("applyEditAction – deleteElement", () => {
  it("deletes a whole path statement", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).not.toContain("\\draw (0,0) -- (1,0);");
      expect(result.newSource).toContain("\\draw (0,1) -- (1,1);");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("deletes multiple elements in one action", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElements",
      elementIds: ["path:0", "path:2"]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).not.toContain("\\draw (0,0) -- (1,0);");
      expect(result.newSource).toContain("\\draw (0,1) -- (1,1);");
      expect(result.newSource).not.toContain("\\draw (0,2) -- (1,2);");
    }
  });
});

describe("applyEditAction – reorderElements", () => {
  it("brings a single statement forward by one slot", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:0"],
      direction: "bringForward"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource.indexOf("\\draw (0,1) -- (1,1);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,0) -- (1,0);")
    );
  });

  it("sends a single statement backward by one slot", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1"],
      direction: "sendBackward"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource.indexOf("\\draw (0,1) -- (1,1);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,0) -- (1,0);")
    );
  });

  it("supports sendToBack and bringToFront", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const toBack = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:2"],
      direction: "sendToBack"
    });
    expect(toBack.kind).toBe("success");
    if (toBack.kind === "success") {
      expect(toBack.newSource.indexOf("\\draw (0,2) -- (1,2);")).toBeLessThan(
        toBack.newSource.indexOf("\\draw (0,0) -- (1,0);")
      );
    }

    const toFront = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:0"],
      direction: "bringToFront"
    });
    expect(toFront.kind).toBe("success");
    if (toFront.kind === "success") {
      expect(toFront.newSource.indexOf("\\draw (0,2) -- (1,2);")).toBeLessThan(
        toFront.newSource.indexOf("\\draw (0,0) -- (1,0);")
      );
    }
  });

  it("keeps contiguous multi-selection stable while moving one step forward", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
  \draw (0,3) -- (1,3);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1", "path:2"],
      direction: "bringForward"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource.indexOf("\\draw (0,3) -- (1,3);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,1) -- (1,1);")
    );
    expect(result.newSource.indexOf("\\draw (0,1) -- (1,1);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,2) -- (1,2);")
    );
  });

  it("moves non-contiguous multi-selection one step backward per statement", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
  \draw (0,3) -- (1,3);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1", "path:3"],
      direction: "sendBackward"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource.indexOf("\\draw (0,1) -- (1,1);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,0) -- (1,0);")
    );
    expect(result.newSource.indexOf("\\draw (0,3) -- (1,3);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,2) -- (1,2);")
    );
  });

  it("keeps statements separated by newline+indent when reordering forward/backward", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-3,-3) rectangle (3,3);\draw[fill=gray] (-1.31,1.23) rectangle (1,-0.29);

  \draw (-2.5, 2.5) -- (2.5, 2.5);
\end{tikzpicture}`;

    const backward = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1"],
      direction: "sendBackward"
    });
    expect(backward.kind).toBe("success");
    if (backward.kind !== "success") return;
    expect(backward.newSource).not.toContain(";\\draw");
    expect(backward.newSource).toContain(";\n  \\draw");

    const forward = applyEditAction(backward.newSource, [], {
      kind: "reorderElements",
      elementIds: ["path:0"],
      direction: "bringForward"
    });
    expect(forward.kind).toBe("success");
    if (forward.kind !== "success") return;
    expect(forward.newSource).not.toContain(";\\draw");
    expect(forward.newSource).toContain(";\n  \\draw");
  });

  it("reorders mixed-parent selections per parent list", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (0,1) -- (1,1);
    \draw (0,2) -- (1,2);
  \end{scope}
  \draw (0,3) -- (1,3);
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const scope = parsed.figure.body.find((statement) => statement.kind === "Scope");
    expect(scope?.kind).toBe("Scope");
    if (!scope || scope.kind !== "Scope") {
      throw new Error("Expected a scope statement.");
    }
    const nestedFirst = scope.body.find((statement) => statement.kind === "Path");
    expect(nestedFirst?.kind).toBe("Path");
    if (!nestedFirst || nestedFirst.kind !== "Path") {
      throw new Error("Expected a nested path statement.");
    }

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:0", nestedFirst.id],
      direction: "bringToFront"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.newSource.indexOf("\\draw (0,3) -- (1,3);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,0) -- (1,0);")
    );
    expect(result.newSource.indexOf("\\draw (0,2) -- (1,2);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,1) -- (1,1);")
    );
  });
});

describe("applyEditAction – duplicateElements", () => {
  it("duplicates selected statements after the same-parent anchor with default down-right offset", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0"]
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;

    expect(result.newSource.indexOf("\\draw (0,0) -- (1,0);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0.25,-0.25) -- (1.25,-0.25);")
    );
    expect(result.newSource.indexOf("\\draw (0.25,-0.25) -- (1.25,-0.25);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,1) -- (1,1);")
    );
    expect(result.selectedSourceIds?.length ?? 0).toBe(1);
  });

  it("renames duplicated named nodes to avoid name conflicts", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (C) at (0, 1.5) {C};
  \node[draw] (C2) at (2, 1.5) {C2};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0"]
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;
    expect(result.newSource).toContain("\\node[draw] (C3) at (0.25, 1.25) {C};");
  });

  it("uses spaced numeric suffixes for names that contain spaces", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (My Node) at (0, 1.5) {C};
  \node[draw] (My Node 2) at (2, 1.5) {C2};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0"]
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;
    expect(result.newSource).toContain("\\node[draw] (My Node 3) at (0.25, 1.25) {C};");
  });
});

describe("applyEditAction – pasteStatements", () => {
  it("pastes snippets after anchor and returns selected source ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: ["\\draw (0,0) -- (1,0);"],
      anchorElementId: "path:0"
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;
    expect(result.newSource).toContain("\\draw (0.25,-0.25) -- (1.25,-0.25);");
    expect(result.selectedSourceIds?.length ?? 0).toBe(1);
  });

  it("pastes snippets before \\end{tikzpicture} when no anchor is provided", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: ["\\draw (2,2) -- (3,2);"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (2.25,1.75) -- (3.25,1.75);");
    expect(result.newSource).toContain("\\draw (2.25,1.75) -- (3.25,1.75);\n\\end{tikzpicture}");
    const endIndex = result.newSource.lastIndexOf("\\end{tikzpicture}");
    expect(result.newSource.lastIndexOf("\\draw (2.25,1.75) -- (3.25,1.75);")).toBeLessThan(endIndex);
  });

  it("renames pasted named nodes and updates coordinate references", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (C) at (0, 1.5) {C};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: [
        "\\node[draw] (C) at (0, 1.5) {C};",
        "\\draw (C) -- ++(1,0);"
      ]
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;
    expect(result.newSource).toContain("\\node[draw] (C2) at (0.25, 1.25) {C};");
    expect(result.newSource).toContain("\\draw (C2) -- ++");
  });
});
