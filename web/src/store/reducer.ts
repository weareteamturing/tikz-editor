import { applyEditAction } from "tikz-editor/edit/actions";
import type { EditorState, EditorAction, HistoryEntry, CanvasTransform } from "./types";
import type { SessionSnapshot } from "../compute";
import { makeEmptySnapshot } from "../compute";

export const DEFAULT_SOURCE = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \draw (-3,-3) rectangle (3,3);

  \draw (-2.5, 2.5) -- (2.5, 2.5);

  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1.5, -0.5) {B};
  \node[draw] (C) at (0, 1.5) {C};
  \draw (A) edge (B)
        (B) edge (C)
        (C) edge (A);
\end{tikzpicture}`;

export const DEFAULT_CANVAS_TRANSFORM: CanvasTransform = {
  translateX: 0,
  translateY: 0,
  scale: 1
};

export function makeInitialState(): EditorState {
  return {
    source: DEFAULT_SOURCE,
    snapshot: makeEmptySnapshot(DEFAULT_SOURCE),
    pendingRequestId: null,

    history: [],
    historyIndex: -1,

    selectedElementIds: new Set(),
    internalClipboard: null,

    toolMode: "select",
    canvasTransform: DEFAULT_CANVAS_TRANSFORM,
    hoveredElementId: null,
    activeCanvasDragKind: null,

    leftPanelWidth: 340,
    rightPanelWidth: 280,
    showSourcePanel: true,
    showInspectorPanel: true,

    showDevPanel: false
  };
}

function actionLabel(kind: HistoryEntry["kind"]): string {
  switch (kind) {
    case "move": return "Moved element";
    case "move-handle": return "Edited handle";
    case "set-property": return "Changed property";
    case "add-element": return "Added element";
    case "delete": return "Deleted element";
    case "resize": return "Resized element";
    case "reorder": return "Reordered elements";
    case "align": return "Aligned elements";
    case "distribute": return "Distributed elements";
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    // ── Document ──────────────────────────────────────────────────────────────
    case "CODE_EDITED": {
      if (action.source === state.source) return state;
      // Canvas/WYSIWYG history entries are source-versioned snapshots.
      // Drop them on direct code edits to avoid stale undo restoring old text.
      return {
        ...state,
        source: action.source,
        history: [],
        historyIndex: -1
      };
    }

    case "COMPUTE_REQUESTED": {
      return { ...state, pendingRequestId: action.requestId };
    }

    case "SNAPSHOT_READY": {
      if (action.requestId !== state.pendingRequestId) return state;
      return {
        ...state,
        snapshot: action.snapshot,
        pendingRequestId: null
      };
    }

    case "APPLY_EDIT_ACTION": {
      const result = applyEditAction(
        state.source,
        state.snapshot.editHandles,
        action.action
      );

      if (result.kind !== "success" && result.kind !== "partial") {
        return state;
      }

      if (result.newSource === state.source) {
        return state;
      }

      const nextSelection = result.selectedSourceIds
        ? new Set(result.selectedSourceIds)
        : state.selectedElementIds;

      const historyKind: HistoryEntry["kind"] =
        action.action.kind === "moveElement" || action.action.kind === "moveElements" ? "move" :
        action.action.kind === "moveHandle" ? "move-handle" :
        action.action.kind === "setProperty" ? "set-property" :
        action.action.kind === "alignElements" ? "align" :
        action.action.kind === "distributeElements" ? "distribute" :
        action.action.kind === "reorderElements" ? "reorder" :
        action.action.kind === "addElement" ? "add-element" :
        action.action.kind === "duplicateElements" || action.action.kind === "pasteStatements" ? "add-element" :
        action.action.kind === "deleteElement" || action.action.kind === "deleteElements" ? "delete" :
        "resize";

      const truncated = state.history.slice(0, state.historyIndex + 1);
      const mergeKey = action.historyMergeKey;
      const lastIndex = truncated.length - 1;
      const lastEntry = truncated[lastIndex];

      if (
        mergeKey &&
        lastEntry &&
        lastEntry.mergeKey === mergeKey &&
        lastEntry.kind === historyKind
      ) {
        const nextHistory = [...truncated];
        nextHistory[lastIndex] = {
          ...lastEntry,
          label: actionLabel(historyKind),
          forward: result.patches,
          sourceAfter: result.newSource
        };

        return {
          ...state,
          source: result.newSource,
          selectedElementIds: nextSelection,
          history: nextHistory,
          historyIndex: lastIndex
        };
      }

      const entry: HistoryEntry = {
        kind: historyKind,
        label: actionLabel(historyKind),
        mergeKey,
        forward: result.patches,
        backward: result.patches,  // placeholder; proper undo patches added in Phase 1
        sourceBefore: state.source,
        sourceAfter: result.newSource
      };

      return {
        ...state,
        source: result.newSource,
        selectedElementIds: nextSelection,
        history: [...truncated, entry],
        historyIndex: truncated.length
      };
    }

    // ── History ───────────────────────────────────────────────────────────────
    case "UNDO": {
      if (state.historyIndex < 0) return state;
      const entry = state.history[state.historyIndex];
      if (!entry) return state;

      // Use stored sourceBefore for reliable undo
      return {
        ...state,
        source: entry.sourceBefore,
        historyIndex: state.historyIndex - 1
      };
    }

    case "REDO": {
      if (state.historyIndex >= state.history.length - 1) return state;
      const entry = state.history[state.historyIndex + 1];
      if (!entry) return state;

      return {
        ...state,
        source: entry.sourceAfter,
        historyIndex: state.historyIndex + 1
      };
    }

    // ── Selection ─────────────────────────────────────────────────────────────
    case "SELECT": {
      if (action.additive) {
        const next = new Set(state.selectedElementIds);
        if (next.has(action.id)) {
          next.delete(action.id);
        } else {
          next.add(action.id);
        }
        return { ...state, selectedElementIds: next };
      }
      if (state.selectedElementIds.size === 1 && state.selectedElementIds.has(action.id)) {
        return state;
      }
      return { ...state, selectedElementIds: new Set([action.id]) };
    }

    case "SELECT_RANGE": {
      return { ...state, selectedElementIds: new Set(action.ids) };
    }

    case "CLEAR_SELECTION": {
      if (state.selectedElementIds.size === 0) return state;
      return { ...state, selectedElementIds: new Set() };
    }

    case "SET_INTERNAL_CLIPBOARD": {
      if (action.clipboard == null) {
        if (state.internalClipboard == null) {
          return state;
        }
        return { ...state, internalClipboard: null };
      }
      return {
        ...state,
        internalClipboard: {
          snippets: [...action.clipboard.snippets],
          plainText: action.clipboard.plainText,
          copiedAt: action.clipboard.copiedAt
        }
      };
    }

    // ── Canvas ────────────────────────────────────────────────────────────────
    case "SET_TOOL_MODE": {
      if (state.toolMode === action.mode) return state;
      return { ...state, toolMode: action.mode };
    }

    case "SET_CANVAS_TRANSFORM": {
      return { ...state, canvasTransform: action.transform };
    }

    case "SET_HOVERED_ELEMENT": {
      if (state.hoveredElementId === action.id) return state;
      return { ...state, hoveredElementId: action.id };
    }

    case "SET_ACTIVE_CANVAS_DRAG": {
      if (state.activeCanvasDragKind === action.kind) return state;
      return { ...state, activeCanvasDragKind: action.kind };
    }

    // ── Layout ────────────────────────────────────────────────────────────────
    case "SET_PANEL_WIDTH": {
      if (action.panel === "left") {
        return { ...state, leftPanelWidth: action.width };
      }
      return { ...state, rightPanelWidth: action.width };
    }

    case "TOGGLE_PANEL": {
      if (action.panel === "source") {
        return { ...state, showSourcePanel: !state.showSourcePanel };
      }
      return { ...state, showInspectorPanel: !state.showInspectorPanel };
    }

    // ── Debug ─────────────────────────────────────────────────────────────────
    case "TOGGLE_DEV_PANEL": {
      return { ...state, showDevPanel: !state.showDevPanel };
    }
  }
}
