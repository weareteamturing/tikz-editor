import { describe, expect, it } from "vitest";

import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { createIncrementalSemanticSession } from "../../packages/core/src/semantic/incremental.js";
import type { EditHandle, EvaluateOptions } from "../../packages/core/src/semantic/types.js";

describe("semantic incremental evaluation", () => {
  it("matches full evaluation for repeated move-element drag updates", () => {
    const session = createIncrementalSemanticSession();
    let source = STARTUP_SOURCE;
    const seededParsed = parseTikz(source, { recover: true });
    const seeded = session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });
    expect(seeded.stats.strategy).toBe("full");

    for (let step = 0; step < 20; step += 1) {
      const current = evaluateFull(source);
      const targetSourceId = pickMoveSourceId(current.semantic.editHandles);
      const actionResult = applyEditAction(source, current.semantic.editHandles, {
        kind: "moveElements",
        elementIds: [targetSourceId],
        delta: {
          x: 0.05,
          y: -0.02
        }
      });
      expect(actionResult.kind === "success" || actionResult.kind === "partial").toBe(true);
      if (!(actionResult.kind === "success" || actionResult.kind === "partial")) {
        throw new Error(`moveElements failed: ${actionResult.kind}`);
      }
      source = actionResult.newSource;

      const parsed = parseTikz(source, { recover: true });
      const incremental = session.evaluate({
        figure: parsed.figure,
        source,
        hints: {
          trigger: "drag-element",
          changedSourceIds: actionResult.changedSourceIds ?? [targetSourceId]
        }
      });
      const full = evaluateTikzFigure(parsed.figure, source);
      expect(incremental.semantic).toEqual(full);
      expect(incremental.stats.strategy).toBe("incremental");
      expect(incremental.stats.recomputeFromStatementIndex).not.toBeNull();
    }
  });

  it("matches full evaluation for repeated move-handle drag updates", () => {
    const session = createIncrementalSemanticSession();
    let source = STARTUP_SOURCE;
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    for (let step = 0; step < 12; step += 1) {
      const current = evaluateFull(source);
      const handle = pickHandleForDrag(current.semantic.editHandles);
      const actionResult = applyEditAction(source, current.semantic.editHandles, {
        kind: "moveHandle",
        handleId: handle.id,
        newWorld: {
          x: handle.world.x + 0.04,
          y: handle.world.y + 0.03
        }
      });
      expect(actionResult.kind === "success" || actionResult.kind === "partial").toBe(true);
      if (!(actionResult.kind === "success" || actionResult.kind === "partial")) {
        throw new Error(`moveHandle failed: ${actionResult.kind}`);
      }
      source = actionResult.newSource;

      const parsed = parseTikz(source, { recover: true });
      const incremental = session.evaluate({
        figure: parsed.figure,
        source,
        hints: {
          trigger: "drag-handle",
          changedSourceIds: actionResult.changedSourceIds ?? [handle.sourceRef.sourceId]
        }
      });
      const full = evaluateTikzFigure(parsed.figure, source);
      expect(incremental.semantic).toEqual(full);
      expect(incremental.stats.strategy).toBe("incremental");
    }
  });

  it("matches full evaluation for multi-hop named resource dependencies", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \coordinate (B) at (2,0);
  \path[name path=ab] (A) -- (B);
  \path[name path=vertical] (1,-1) -- (1,1);
  \path [name intersections={of=ab and vertical, by=P}];
  \draw (P) -- (2,2);
\end{tikzpicture}`;
    const session = createIncrementalSemanticSession();
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const current = evaluateFull(source);
    const targetSourceId = pickMoveSourceId(current.semantic.editHandles);
    const actionResult = applyEditAction(source, current.semantic.editHandles, {
      kind: "moveElements",
      elementIds: [targetSourceId],
      delta: { x: 0.08, y: 0.01 }
    });
    expect(actionResult.kind === "success" || actionResult.kind === "partial").toBe(true);
    if (!(actionResult.kind === "success" || actionResult.kind === "partial")) {
      throw new Error(`moveElements failed: ${actionResult.kind}`);
    }
    const nextSource = actionResult.newSource;
    const parsed = parseTikz(nextSource, { recover: true });
    const incremental = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: actionResult.changedSourceIds ?? [targetSourceId]
      }
    });
    const full = evaluateTikzFigure(parsed.figure, nextSource);
    expect(incremental.semantic).toEqual(full);
    expect(incremental.stats.strategy).toBe("incremental");
  });

  it("falls back to full strategy when opaque dependencies are reached", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1}
    \draw (\x,0) -- (\x,1);
  \coordinate (A) at (0,2);
  \draw (A) -- (1,2);
\end{tikzpicture}`;
    const session = createIncrementalSemanticSession();
    const seededParsed = parseTikz(source, { recover: true });
    const seeded = session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });
    const opaqueSourceId = seeded.semantic.dependencies.nodes
      .filter((node): node is Extract<(typeof seeded.semantic.dependencies.nodes)[number], { kind: "source" }> => node.kind === "source")
      .find((node) => node.opaque)?.sourceId;
    expect(opaqueSourceId).toBeDefined();
    if (!opaqueSourceId) {
      throw new Error("Expected an opaque source id");
    }

    const nextSource = source.replace("(0,2)", "(0.1,2)");
    const parsed = parseTikz(nextSource, { recover: true });
    const evaluated = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: [opaqueSourceId]
      }
    });
    expect(evaluated.stats.strategy).toBe("full");
    expect(evaluated.stats.fallbackReason).toBe("opaque-dependency");
  });

  it("falls back to full strategy when expanded statement structure changes", () => {
    const session = createIncrementalSemanticSession();
    const source = STARTUP_SOURCE;
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const nextSource = source.replace(
      "\\end{tikzpicture}",
      "  \\draw (0,0) -- (1,1);\n\\end{tikzpicture}"
    );
    const parsed = parseTikz(nextSource, { recover: true });
    const evaluated = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: ["path:0"]
      }
    });
    expect(evaluated.stats.strategy).toBe("full");
    expect(evaluated.stats.fallbackReason).toBe("statement-structure-changed");
  });

  it("falls back to full strategy for unknown changed source ids", () => {
    const session = createIncrementalSemanticSession();
    const source = STARTUP_SOURCE;
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const nextSource = source.replace("(1.5, -0.5)", "(1.55, -0.5)");
    const parsed = parseTikz(nextSource, { recover: true });
    const evaluated = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: ["unknown-source-id"]
      }
    });
    expect(evaluated.stats.strategy).toBe("full");
    expect(evaluated.stats.fallbackReason).toBe("unmapped-affected-source");
  });
});

function evaluateFull(
  source: string,
  options: EvaluateOptions = {}
): {
  parsed: ReturnType<typeof parseTikz>;
  semantic: ReturnType<typeof evaluateTikzFigure>;
} {
  const parsed = parseTikz(source, { recover: true });
  const semantic = evaluateTikzFigure(parsed.figure, source, options);
  return {
    parsed,
    semantic
  };
}

function pickMoveSourceId(handles: readonly EditHandle[]): string {
  const candidate =
    handles.find((handle) => handle.kind === "node-position" && handle.rewriteMode !== "unsupported") ??
    handles.find((handle) => handle.rewriteMode !== "unsupported");
  if (!candidate) {
    throw new Error("Expected at least one rewritable handle");
  }
  return candidate.sourceRef.sourceId;
}

function pickHandleForDrag(handles: readonly EditHandle[]): EditHandle {
  const candidate =
    handles.find((handle) => handle.kind === "path-point" && handle.rewriteMode !== "unsupported") ??
    handles.find((handle) => handle.kind === "node-position" && handle.rewriteMode !== "unsupported") ??
    handles.find((handle) => handle.rewriteMode !== "unsupported");
  if (!candidate) {
    throw new Error("Expected at least one rewritable handle");
  }
  return candidate;
}

const STARTUP_SOURCE = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \draw (-3,-3) rectangle (3,3);

  \draw (-2.5, 2.5) -- (2.5, 2.5);

  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1.5, -0.5) {B};
  \node[draw] (C) at (0, 1.5) {C};
  \draw (A) edge (B)
        (B) edge (C)
        (C) edge (A);
\end{tikzpicture}`;
