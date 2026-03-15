import { describe, expect, it } from "vitest";
import { editorReducer, makeInitialState, DEFAULT_SOURCE } from "../packages/app/src/store/reducer.js";
import type { EditorAction, EditorState } from "../packages/app/src/store/types.js";
import { makeEmptySnapshot } from "../packages/app/src/compute.js";
import type { EditHandle, Point } from "../packages/core/src/semantic/types.js";
import { identityMatrix } from "../packages/core/src/semantic/transform.js";
import { computeSourceFingerprint } from "../packages/core/src/utils/source-fingerprint.js";
import { PT_PER_CM } from "../packages/core/src/edit/format.js";

// Helper to dispatch a sequence of actions
function applyActions(actions: EditorAction[], initial?: EditorState): EditorState {
  let state = initial ?? makeInitialState();
  for (const action of actions) {
    state = editorReducer(state, action);
  }
  return state;
}

const cm = (v: number) => v * PT_PER_CM;

function makeHandle(
  source: string,
  overrides: Partial<EditHandle> & {
    world: Point;
    sourceSpan: { from: number; to: number };
    sourceId?: string;
  }
): EditHandle {
  const { world, sourceSpan, sourceId, ...rest } = overrides;
  const span = sourceSpan;
  return {
    id: `handle-${span.from}-${span.to}`,
    runtimeId: `runtime:handle-${span.from}-${span.to}`,
    sourceRef: {
      sourceId: sourceId ?? "elem-1",
      sourceSpan: span,
      sourceFingerprint: computeSourceFingerprint(source)
    },
    kind: "path-point",
    world: world,
    transform: identityMatrix(),
    sourceText: source.slice(span.from, span.to),
    coordinateForm: overrides.coordinateForm ?? "cartesian",
    rewriteMode: overrides.rewriteMode ?? "direct",
    ...rest
  };
}

function makeStateWithHandle(source: string = "\\draw (1,2) -- (3,4);"): { state: EditorState; handle: EditHandle } {
  const handle = makeHandle(source, {
    world: { x: cm(1), y: cm(2) },
    sourceSpan: { from: 6, to: 11 },
    sourceId: "elem-1"
  });

  const initial = makeInitialState();
  return {
    handle,
    state: {
      ...initial,
      source,
      snapshot: { ...makeEmptySnapshot(source), source, editHandles: [handle] }
    }
  };
}

function applySourcePatches(
  source: string,
  patches: ReadonlyArray<{ oldSpan: { from: number; to: number }; replacement: string }>
): string {
  let cursor = 0;
  let output = "";
  for (const patch of patches) {
    output += source.slice(cursor, patch.oldSpan.from);
    output += patch.replacement;
    cursor = patch.oldSpan.to;
  }
  output += source.slice(cursor);
  return output;
}

// ── CODE_EDITED ────────────────────────────────────────────────────────────────

describe("editorReducer – CODE_EDITED", () => {
  it("updates source when it changes", () => {
    const state = applyActions([{ type: "CODE_EDITED", source: "new source" }]);
    expect(state.source).toBe("new source");
  });

  it("clears WYSIWYG history on direct code edits", () => {
    const initial = makeInitialState();
    const withHistory: EditorState = {
      ...initial,
      history: [
        {
          kind: "move",
          label: "Moved element",
          backward: [],
          forward: [],
          sourceBefore: "before",
          sourceAfter: "after"
        }
      ],
      historyIndex: 0
    };

    const next = editorReducer(withHistory, { type: "CODE_EDITED", source: "typed source" });
    expect(next.history).toEqual([]);
    expect(next.historyIndex).toBe(-1);
  });

  it("is a no-op when source is unchanged", () => {
    const initial = makeInitialState();
    const next = editorReducer(initial, { type: "CODE_EDITED", source: DEFAULT_SOURCE });
    expect(next).toBe(initial); // same reference = no change
  });

  it("records changed source ids and patches while source scrubbing is active", () => {
    const initial = applyActions([{ type: "SET_ACTIVE_SOURCE_SCRUB", sourceId: "path:0" }]);
    const nextSource = DEFAULT_SOURCE.replace("(1.5, -0.5)", "(1.75, -0.5)");
    const next = editorReducer(initial, {
      type: "CODE_EDITED",
      source: nextSource
    });

    expect(next.lastEditChangedSourceIds).toEqual(["path:0"]);
    expect(next.lastEditPatches).not.toBeNull();
    expect(next.lastEditPatches).toHaveLength(1);
    const patch = next.lastEditPatches?.[0];
    expect(patch?.replacement.length).toBeGreaterThan(0);
    expect(applySourcePatches(DEFAULT_SOURCE, next.lastEditPatches ?? [])).toBe(nextSource);
  });

  it("increments sourceRevision only when the source text changes", () => {
    const initial = makeInitialState();
    const edited = editorReducer(initial, {
      type: "CODE_EDITED",
      source: `${initial.source}\n% changed`
    });
    const selected = editorReducer(edited, { type: "SELECT", id: "path:0", additive: false });

    expect(initial.sourceRevision).toBe(0);
    expect(edited.sourceRevision).toBe(1);
    expect(selected.sourceRevision).toBe(1);
  });
});

// ── COMPUTE_REQUESTED / SNAPSHOT_READY ────────────────────────────────────────

describe("editorReducer – compute lifecycle", () => {
  it("COMPUTE_REQUESTED stores the pending request id", () => {
    const state = applyActions([{ type: "COMPUTE_REQUESTED", requestId: "req-1" }]);
    expect(state.pendingRequestId).toBe("req-1");
  });

  it("SNAPSHOT_READY updates snapshot when id matches", () => {
    const snap = { ...makeEmptySnapshot("hello"), revision: 5 };
    const state = applyActions([
      { type: "COMPUTE_REQUESTED", requestId: "req-1" },
      { type: "SNAPSHOT_READY", requestId: "req-1", snapshot: snap }
    ]);
    expect(state.snapshot.revision).toBe(5);
    expect(state.pendingRequestId).toBeNull();
  });

  it("SNAPSHOT_READY is ignored when id does not match (stale response)", () => {
    const initial = makeInitialState();
    const stale = applyActions([
      { type: "COMPUTE_REQUESTED", requestId: "req-2" }
    ], initial);

    const snap = makeEmptySnapshot("stale");
    const after = editorReducer(stale, {
      type: "SNAPSHOT_READY",
      requestId: "req-1",  // wrong id
      snapshot: snap
    });
    expect(after.pendingRequestId).toBe("req-2"); // unchanged
    expect(after.snapshot.source).toBe(DEFAULT_SOURCE); // unchanged
  });

  it("auto-selects the first figure on first compute and clears active figure if it disappears", () => {
    const figureA = {
      id: "figure:a",
      span: { from: 0, to: 10 },
      beginSpan: { from: 0, to: 5 },
      endSpan: { from: 5, to: 10 },
      startLine: 1,
      endLine: 2
    };
    const figureB = {
      id: "figure:b",
      span: { from: 10, to: 20 },
      beginSpan: { from: 10, to: 15 },
      endSpan: { from: 15, to: 20 },
      startLine: 3,
      endLine: 4
    };
    const firstSnapshot = {
      ...makeEmptySnapshot("source"),
      source: "source",
      figures: [figureA, figureB],
      activeFigureId: null
    };
    const afterFirst = applyActions([
      { type: "COMPUTE_REQUESTED", requestId: "req-1" },
      { type: "SNAPSHOT_READY", requestId: "req-1", snapshot: firstSnapshot }
    ]);
    expect(afterFirst.activeFigureId).toBe("figure:a");

    const switched = editorReducer(afterFirst, { type: "SET_ACTIVE_FIGURE", figureId: "figure:b" });
    expect(switched.activeFigureId).toBe("figure:b");

    const secondSnapshot = {
      ...firstSnapshot,
      figures: [figureA],
      activeFigureId: null
    };
    const afterRemoval = applyActions([
      { type: "COMPUTE_REQUESTED", requestId: "req-2" },
      { type: "SNAPSHOT_READY", requestId: "req-2", snapshot: secondSnapshot }
    ], switched);
    expect(afterRemoval.activeFigureId).toBeNull();
  });

  it("auto-selects first figure when figure count grows and the previous active figure became invalid", () => {
    const figure0 = {
      id: "figure:0",
      span: { from: 0, to: 10 },
      beginSpan: { from: 0, to: 5 },
      endSpan: { from: 5, to: 10 },
      startLine: 1,
      endLine: 2
    };
    const figureA = {
      id: "figure:a",
      span: { from: 20, to: 30 },
      beginSpan: { from: 20, to: 25 },
      endSpan: { from: 25, to: 30 },
      startLine: 3,
      endLine: 4
    };
    const figureB = {
      id: "figure:b",
      span: { from: 40, to: 50 },
      beginSpan: { from: 40, to: 45 },
      endSpan: { from: 45, to: 50 },
      startLine: 5,
      endLine: 6
    };

    const firstSnapshot = {
      ...makeEmptySnapshot("source-1"),
      source: "source-1",
      figures: [figure0],
      activeFigureId: null
    };
    const afterFirst = applyActions([
      { type: "COMPUTE_REQUESTED", requestId: "req-1" },
      { type: "SNAPSHOT_READY", requestId: "req-1", snapshot: firstSnapshot }
    ]);
    expect(afterFirst.activeFigureId).toBe("figure:0");

    const secondSnapshot = {
      ...makeEmptySnapshot("source-2"),
      source: "source-2",
      figures: [figureA, figureB],
      activeFigureId: null
    };
    const afterSecond = applyActions([
      { type: "CODE_EDITED", source: "source-2" },
      { type: "COMPUTE_REQUESTED", requestId: "req-2" },
      { type: "SNAPSHOT_READY", requestId: "req-2", snapshot: secondSnapshot }
    ], afterFirst);

    expect(afterSecond.activeFigureId).toBe("figure:a");
  });
});

// ── UNDO / REDO ────────────────────────────────────────────────────────────────

describe("editorReducer – UNDO / REDO", () => {
  it("UNDO is a no-op when history is empty", () => {
    const initial = makeInitialState();
    const after = editorReducer(initial, { type: "UNDO" });
    expect(after).toBe(initial);
  });

  it("REDO is a no-op when at the end of history", () => {
    const initial = makeInitialState();
    const after = editorReducer(initial, { type: "REDO" });
    expect(after).toBe(initial);
  });

  it("increments sourceRevision for undo and redo source changes", () => {
    const { state: initial, handle } = makeStateWithHandle();
    const edited = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: handle.id,
        newWorld: { x: cm(5), y: cm(6) }
      }
    });

    expect(edited.sourceRevision).toBe(1);

    const undone = editorReducer(edited, { type: "UNDO" });
    expect(undone.sourceRevision).toBe(2);

    const redone = editorReducer(undone, { type: "REDO" });
    expect(redone.sourceRevision).toBe(3);
  });
});

// ── APPLY_EDIT_ACTION ──────────────────────────────────────────────────────────

describe("editorReducer – APPLY_EDIT_ACTION", () => {
  it("applies a successful edit action and pushes history", () => {
    const { state: initial, handle } = makeStateWithHandle();

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: handle.id,
        newWorld: { x: cm(5), y: cm(6) }
      }
    });

    expect(next.source).toBe("\\draw (5,6) -- (3,4);");
    expect(next.history).toHaveLength(1);
    expect(next.historyIndex).toBe(0);
    expect(next.history[0]?.kind).toBe("move-handle");
    expect(next.history[0]?.sourceBefore).toBe("\\draw (1,2) -- (3,4);");
    expect(next.history[0]?.sourceAfter).toBe("\\draw (5,6) -- (3,4);");
  });

  it("coalesces drag updates that share the same history merge key", () => {
    const { state: initial, handle } = makeStateWithHandle();
    const mergeKey = "drag-elem-1";

    const first = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: handle.id,
        newWorld: { x: cm(5), y: cm(6) }
      },
      historyMergeKey: mergeKey
    });

    const refreshedHandle = makeHandle(first.source, {
      world: { x: cm(5), y: cm(6) },
      sourceSpan: { from: 6, to: 11 },
      sourceId: "elem-1"
    });

    const withFreshSnapshot: EditorState = {
      ...first,
      snapshot: {
        ...first.snapshot,
        source: first.source,
        editHandles: [refreshedHandle]
      }
    };

    const second = editorReducer(withFreshSnapshot, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: refreshedHandle.id,
        newWorld: { x: cm(7), y: cm(8) }
      },
      historyMergeKey: mergeKey
    });

    expect(second.history).toHaveLength(1);
    expect(second.historyIndex).toBe(0);
    expect(second.history[0]?.sourceBefore).toBe("\\draw (1,2) -- (3,4);");
    expect(second.history[0]?.sourceAfter).toBe("\\draw (7,8) -- (3,4);");
  });

  it("is a no-op for unsupported edit actions", () => {
    const initial = makeInitialState();
    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveElement",
        elementId: "missing",
        delta: { x: cm(1), y: cm(1) }
      }
    });
    expect(next).toBe(initial);
  });

  it("applies precomputed edit results without recomputing the action", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      snapshot: { ...makeEmptySnapshot(source), source, editHandles: [] }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: "missing-handle-id",
        newWorld: { x: cm(5), y: cm(6) }
      },
      precomputedResult: {
        kind: "success",
        newSource: "\\draw (5,6) -- (3,4);",
        patches: [
          {
            oldSpan: { from: 6, to: 11 },
            newSpan: { from: 6, to: 11 },
            replacement: "(5,6)"
          }
        ],
        changedSourceIds: ["elem-1"]
      }
    });

    expect(next.source).toBe("\\draw (5,6) -- (3,4);");
    expect(next.history).toHaveLength(1);
    expect(next.history[0]?.kind).toBe("move-handle");
    expect(next.lastEditChangedSourceIds).toEqual(["elem-1"]);
  });

  it("is a no-op when an edit action rewrites to the same source text", () => {
    const { state: initial } = makeStateWithHandle();

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveElement",
        elementId: "elem-1",
        delta: { x: 0.01, y: 0 }
      }
    });

    expect(next).toBe(initial);
  });

  it("replaces selected ids when the edit result provides selectedSourceIds", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      selectedElementIds: new Set(["path:0"]),
      snapshot: { ...makeEmptySnapshot(source), source }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "pasteStatements",
        snippets: ["\\draw (2,2) -- (3,2);"],
        anchorElementId: "path:0"
      }
    });

    expect(next).not.toBe(initial);
    expect(next.selectedElementIds).not.toEqual(new Set(["path:0"]));
    expect(next.selectedElementIds.size).toBe(1);
  });

  it("records reorder actions with reorder history kind and label", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      snapshot: { ...makeEmptySnapshot(source), source }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "reorderElements",
        elementIds: ["path:0"],
        direction: "bringForward"
      }
    });

    expect(next.history).toHaveLength(1);
    expect(next.history[0]?.kind).toBe("reorder");
    expect(next.history[0]?.label).toBe("Reordered elements");
  });

  it("records align actions with align history kind and label", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,1) -- (3,1);
\end{tikzpicture}`;
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      snapshot: { ...makeEmptySnapshot(source), source }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "alignElements",
        elementIds: ["path:0", "path:1"],
        mode: "left"
      }
    });

    expect(next.history).toHaveLength(1);
    expect(next.history[0]?.kind).toBe("align");
    expect(next.history[0]?.label).toBe("Aligned elements");
  });

  it("records distribute actions with distribute history kind and label", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,0) -- (3,0);
  \draw (10,0) -- (11,0);
\end{tikzpicture}`;
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      snapshot: { ...makeEmptySnapshot(source), source }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "distributeElements",
        elementIds: ["path:0", "path:1", "path:2"],
        axis: "horizontal"
      }
    });

    expect(next.history).toHaveLength(1);
    expect(next.history[0]?.kind).toBe("distribute");
    expect(next.history[0]?.label).toBe("Distributed elements");
  });

  it("records resize actions with resize history kind and updates source", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      snapshot: { ...makeEmptySnapshot(source), source }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "resizeElement",
        elementId: "path:0",
        role: "bottom-right",
        newWorld: { x: 100, y: 100 }
      }
    });

    expect(next.source).not.toBe(source);
    expect(next.source).toContain("minimum width=");
    expect(next.source).toContain("minimum height=");
    expect(next.history).toHaveLength(1);
    expect(next.history[0]?.kind).toBe("resize");
    expect(next.history[0]?.label).toBe("Resized element");
  });

  it("increments sourceRevision for successful edit actions, including transient previews", () => {
    const { state: initial, handle } = makeStateWithHandle();
    const preview = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: handle.id,
        newWorld: { x: cm(5), y: cm(6) }
      },
      recordInHistory: false
    });

    expect(preview.sourceRevision).toBe(1);

    const committed = editorReducer(preview, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: makeHandle(preview.source, {
          world: { x: cm(5), y: cm(6) },
          sourceSpan: { from: 6, to: 11 },
          sourceId: "elem-1"
        }).id,
        newWorld: { x: cm(7), y: cm(8) }
      },
      precomputedResult: {
        kind: "success",
        newSource: "\\draw (7,8) -- (3,4);",
        patches: [
          {
            oldSpan: { from: 6, to: 11 },
            newSpan: { from: 6, to: 11 },
            replacement: "(7,8)"
          }
        ],
        changedSourceIds: ["elem-1"]
      }
    });

    expect(committed.sourceRevision).toBe(2);
  });
});

// ── SELECT / CLEAR_SELECTION ───────────────────────────────────────────────────

describe("editorReducer – selection", () => {
  it("SELECT sets the selected id (non-additive)", () => {
    const state = applyActions([{ type: "SELECT", id: "elem-1", additive: false }]);
    expect(state.selectedElementIds).toEqual(new Set(["elem-1"]));
  });

  it("SELECT with additive adds to selection", () => {
    const state = applyActions([
      { type: "SELECT", id: "elem-1", additive: false },
      { type: "SELECT", id: "elem-2", additive: true }
    ]);
    expect(state.selectedElementIds).toEqual(new Set(["elem-1", "elem-2"]));
  });

  it("SELECT with additive on existing id removes it", () => {
    const state = applyActions([
      { type: "SELECT", id: "elem-1", additive: false },
      { type: "SELECT", id: "elem-1", additive: true }
    ]);
    expect(state.selectedElementIds.size).toBe(0);
  });

  it("CLEAR_SELECTION empties the selection", () => {
    const state = applyActions([
      { type: "SELECT", id: "elem-1", additive: false },
      { type: "CLEAR_SELECTION" }
    ]);
    expect(state.selectedElementIds.size).toBe(0);
    expect(state.focusedScopeId).toBeNull();
  });

  it("CLEAR_SELECTION is a no-op when already empty", () => {
    const initial = makeInitialState();
    const after = editorReducer(initial, { type: "CLEAR_SELECTION" });
    expect(after).toBe(initial);
  });

  it("CLEAR_SELECTION can preserve focused scope", () => {
    const state = applyActions([
      { type: "SET_FOCUSED_SCOPE", scopeId: "scope:0" },
      { type: "SELECT", id: "scope:0", additive: false },
      { type: "CLEAR_SELECTION", preserveFocusedScope: true }
    ]);
    expect(state.selectedElementIds.size).toBe(0);
    expect(state.focusedScopeId).toBe("scope:0");
  });

  it("SET_FOCUSED_SCOPE updates focus id", () => {
    const state = applyActions([{ type: "SET_FOCUSED_SCOPE", scopeId: "scope:1" }]);
    expect(state.focusedScopeId).toBe("scope:1");
  });

  it("SELECT_RANGE sets multiple ids", () => {
    const state = applyActions([
      { type: "SELECT_RANGE", ids: ["elem-1", "elem-2", "elem-3"] }
    ]);
    expect(state.selectedElementIds).toEqual(new Set(["elem-1", "elem-2", "elem-3"]));
  });

});

// ── SET_TOOL_MODE ──────────────────────────────────────────────────────────────

describe("editorReducer – SET_TOOL_MODE", () => {
  it("updates tool mode", () => {
    const state = applyActions([{ type: "SET_TOOL_MODE", mode: "addNode" }]);
    expect(state.toolMode).toBe("addNode");
  });

  it("is a no-op when mode is unchanged", () => {
    const initial = makeInitialState();
    expect(initial.toolMode).toBe("select");
    const after = editorReducer(initial, { type: "SET_TOOL_MODE", mode: "select" });
    expect(after).toBe(initial);
  });
});

describe("editorReducer – SET_FREEHAND_SMOOTHING", () => {
  it("updates freehand smoothing value", () => {
    const state = applyActions([{ type: "SET_FREEHAND_SMOOTHING", value: 20 }]);
    expect(state.freehandSmoothingPx).toBe(20);
  });

  it("clamps smoothing value to supported bounds", () => {
    const low = applyActions([{ type: "SET_FREEHAND_SMOOTHING", value: -5 }]);
    expect(low.freehandSmoothingPx).toBe(4);

    const high = applyActions([{ type: "SET_FREEHAND_SMOOTHING", value: 999 }], low);
    expect(high.freehandSmoothingPx).toBe(32);
  });

  it("is a no-op when smoothing value is unchanged", () => {
    const initial = makeInitialState();
    expect(initial.freehandSmoothingPx).toBe(16);
    const after = editorReducer(initial, { type: "SET_FREEHAND_SMOOTHING", value: 16 });
    expect(after).toBe(initial);
  });
});

// ── SET_CANVAS_TRANSFORM ───────────────────────────────────────────────────────

describe("editorReducer – SET_CANVAS_TRANSFORM", () => {
  it("updates canvas transform", () => {
    const transform = { translateX: 100, translateY: 50, scale: 2 };
    const state = applyActions([{ type: "SET_CANVAS_TRANSFORM", transform }]);
    expect(state.canvasTransform).toEqual(transform);
  });
});

describe("editorReducer – SET_HOVERED_ELEMENT", () => {
  it("updates hovered element id", () => {
    const state = applyActions([{ type: "SET_HOVERED_ELEMENT", id: "elem-1" }]);
    expect(state.hoveredElementId).toBe("elem-1");
  });

  it("is a no-op when hovered id is unchanged", () => {
    const initial = makeInitialState();
    const hovered = editorReducer(initial, { type: "SET_HOVERED_ELEMENT", id: "elem-1" });
    const unchanged = editorReducer(hovered, { type: "SET_HOVERED_ELEMENT", id: "elem-1" });
    expect(unchanged).toBe(hovered);
  });

  it("clears hovered element id", () => {
    const initial = makeInitialState();
    const hovered = editorReducer(initial, { type: "SET_HOVERED_ELEMENT", id: "elem-1" });
    const cleared = editorReducer(hovered, { type: "SET_HOVERED_ELEMENT", id: null });
    expect(cleared.hoveredElementId).toBeNull();
  });
});

// ── SET_PANEL_WIDTH ────────────────────────────────────────────────────────────

describe("editorReducer – layout", () => {
  it("SET_PANEL_WIDTH updates left panel width", () => {
    const state = applyActions([{ type: "SET_PANEL_WIDTH", panel: "left", width: 450 }]);
    expect(state.leftPanelWidth).toBe(450);
  });

  it("SET_PANEL_WIDTH updates right panel width", () => {
    const state = applyActions([{ type: "SET_PANEL_WIDTH", panel: "right", width: 350 }]);
    expect(state.rightPanelWidth).toBe(350);
  });

  it("TOGGLE_PANEL toggles source panel", () => {
    const initial = makeInitialState();
    expect(initial.showSourcePanel).toBe(true);
    const after = editorReducer(initial, { type: "TOGGLE_PANEL", panel: "source" });
    expect(after.showSourcePanel).toBe(false);
    const restored = editorReducer(after, { type: "TOGGLE_PANEL", panel: "source" });
    expect(restored.showSourcePanel).toBe(true);
  });

  it("TOGGLE_PANEL toggles inspector panel", () => {
    const initial = makeInitialState();
    expect(initial.showInspectorPanel).toBe(true);
    const after = editorReducer(initial, { type: "TOGGLE_PANEL", panel: "inspector" });
    expect(after.showInspectorPanel).toBe(false);
  });

  it("SET_RIGHT_SIDEBAR_TAB switches to objects and keeps the sidebar visible", () => {
    const initial = makeInitialState();
    const after = editorReducer(initial, { type: "SET_RIGHT_SIDEBAR_TAB", tab: "objects" });
    expect(after.rightSidebarTab).toBe("objects");
    expect(after.showInspectorPanel).toBe(true);
  });

  it("TOGGLE_CANVAS_AID toggles grid/rulers/guides visibility", () => {
    const initial = makeInitialState();
    expect(initial.showGrid).toBe(true);
    expect(initial.snapModes).toEqual({ grid: true, guides: true, points: true, gaps: true });
    expect(initial.showRulers).toBe(true);
    expect(initial.showGuides).toBe(true);

    const afterGrid = editorReducer(initial, { type: "TOGGLE_CANVAS_AID", aid: "grid" });
    expect(afterGrid.showGrid).toBe(false);
    expect(afterGrid.showRulers).toBe(true);
    expect(afterGrid.showGuides).toBe(true);

    const afterRulers = editorReducer(afterGrid, { type: "TOGGLE_CANVAS_AID", aid: "rulers" });
    expect(afterRulers.showGrid).toBe(false);
    expect(afterRulers.showRulers).toBe(false);
    expect(afterRulers.showGuides).toBe(true);

    const afterGuides = editorReducer(afterRulers, { type: "TOGGLE_CANVAS_AID", aid: "guides" });
    expect(afterGuides.showGrid).toBe(false);
    expect(afterGuides.showRulers).toBe(false);
    expect(afterGuides.showGuides).toBe(false);
    expect(afterGuides.snapModes).toEqual({ grid: true, guides: true, points: true, gaps: true });
  });

  it("TOGGLE_SNAP_MODE toggles each snapping mode independently", () => {
    const initial = makeInitialState();
    expect(initial.showGrid).toBe(true);
    expect(initial.snapModes).toEqual({ grid: true, guides: true, points: true, gaps: true });

    const hiddenGrid = editorReducer(initial, { type: "TOGGLE_CANVAS_AID", aid: "grid" });
    expect(hiddenGrid.showGrid).toBe(false);
    expect(hiddenGrid.snapModes).toEqual({ grid: true, guides: true, points: true, gaps: true });

    const snapOff = editorReducer(hiddenGrid, { type: "TOGGLE_SNAP_MODE", mode: "grid" });
    expect(snapOff.showGrid).toBe(false);
    expect(snapOff.snapModes).toEqual({ grid: false, guides: true, points: true, gaps: true });

    const guidesOff = editorReducer(snapOff, { type: "TOGGLE_SNAP_MODE", mode: "guides" });
    expect(guidesOff.snapModes).toEqual({ grid: false, guides: false, points: true, gaps: true });

    const pointsOff = editorReducer(guidesOff, { type: "TOGGLE_SNAP_MODE", mode: "points" });
    expect(pointsOff.snapModes).toEqual({ grid: false, guides: false, points: false, gaps: true });

    const gapsOff = editorReducer(pointsOff, { type: "TOGGLE_SNAP_MODE", mode: "gaps" });
    expect(gapsOff.snapModes).toEqual({ grid: false, guides: false, points: false, gaps: false });
  });

  it("REQUEST_FIT_TO_CONTENT increments request token", () => {
    const initial = makeInitialState();
    expect(initial.fitToContentRequestToken).toBe(0);

    const next = editorReducer(initial, { type: "REQUEST_FIT_TO_CONTENT" });
    expect(next.fitToContentRequestToken).toBe(1);

    const next2 = editorReducer(next, { type: "REQUEST_FIT_TO_CONTENT" });
    expect(next2.fitToContentRequestToken).toBe(2);
  });
});

// ── TOGGLE_DEV_PANEL ──────────────────────────────────────────────────────────

describe("editorReducer – TOGGLE_DEV_PANEL", () => {
  it("toggles dev panel visibility", () => {
    const initial = makeInitialState();
    expect(initial.showDevPanel).toBe(false);
    const after = editorReducer(initial, { type: "TOGGLE_DEV_PANEL" });
    expect(after.showDevPanel).toBe(true);
    const restored = editorReducer(after, { type: "TOGGLE_DEV_PANEL" });
    expect(restored.showDevPanel).toBe(false);
  });
});

describe("editorReducer – assistant integration", () => {
  it("applies assistant source updates to the active document", () => {
    const initial = makeInitialState();
    const next = editorReducer(initial, {
      type: "ASSISTANT_SOURCE_UPDATED",
      source: "\\draw (5,5)--(6,6);",
      revisionToken: "rev-1"
    });
    expect(next.source).toBe("\\draw (5,5)--(6,6);");
    expect(next.documents[next.activeDocumentId]?.assistantLastSourceRevision).toBe("rev-1");
  });

  it("coalesces assistant source updates into one undo entry per turn", () => {
    const initial = makeInitialState();
    const first = editorReducer(initial, {
      type: "ASSISTANT_SOURCE_UPDATED",
      source: "\\draw (1,1)--(2,2);",
      revisionToken: "rev-1",
      historyMergeKey: "assistant-turn:doc"
    });
    const second = editorReducer(first, {
      type: "ASSISTANT_SOURCE_UPDATED",
      source: "\\draw (3,3)--(4,4);",
      revisionToken: "rev-2",
      historyMergeKey: "assistant-turn:doc"
    });

    expect(second.history).toHaveLength(1);
    expect(second.history[0]?.label).toBe("AI assistant edit");
    expect(second.history[0]?.sourceBefore).toBe(DEFAULT_SOURCE);
    expect(second.history[0]?.sourceAfter).toBe("\\draw (3,3)--(4,4);");
  });

  it("blocks direct user edits while the assistant lock is active", () => {
    const initial = makeInitialState();
    const locked = editorReducer(initial, {
      type: "ASSISTANT_TURN_STATUS",
      status: "inProgress",
      turnId: "turn-1"
    });
    const afterEdit = editorReducer(locked, {
      type: "CODE_EDITED",
      source: "\\draw (9,9)--(10,10);"
    });
    expect(afterEdit.source).toBe(initial.source);
    expect(afterEdit.documents[afterEdit.activeDocumentId]?.assistantLockReason).toBeTruthy();
  });
});
