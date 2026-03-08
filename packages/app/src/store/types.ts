import type { SessionSnapshot } from "../compute";
import type { EditAction, EditActionResult } from "tikz-editor/edit/actions";

export type ToolMode =
  | "select"
  | "addNode"
  | "addPath"
  | "addFreehand"
  | "addLine"
  | "addGrid"
  | "addRect"
  | "addEllipse"
  | "addCircle"
  | "addArrow"
  | "addBezier";
export type CanvasDragKind = "element" | "resize" | "rotate" | "handle" | "pan" | "marquee" | "tool-create" | "text-select";
export type CanvasAid = "grid" | "rulers" | "guides";

export type CanvasTransform = {
  translateX: number;
  translateY: number;
  scale: number;
};

export type HistoryEntry = {
  kind: "move" | "move-handle" | "set-property" | "add-element" | "delete" | "resize" | "reorder" | "align" | "distribute";
  label: string;
  /** Optional key used to coalesce drag updates into one undo step. */
  mergeKey?: string;
  /** Patches to apply to go backward (undo). */
  backward: import("tikz-editor/edit/types").SourcePatch[];
  /** Patches to apply to go forward (redo). */
  forward: import("tikz-editor/edit/types").SourcePatch[];
  /** Source before the action (for full undo). */
  sourceBefore: string;
  /** Source after the action (for full redo). */
  sourceAfter: string;
};

export type DocumentFileRef = {
  kind: "virtual" | "file" | "browser-file";
  name: string;
  handleId?: string;
  provider?: "browser-fsa" | "download";
};

export type DocumentSession = {
  id: string;
  title: string;
  source: string;
  snapshot: SessionSnapshot;
  pendingRequestId: string | null;
  lastEditChangedSourceIds: string[] | null;
  lastEditChangeToken: number;
  history: HistoryEntry[];
  historyIndex: number;
  selectedElementIds: ReadonlySet<string>;
  fileRef: DocumentFileRef | null;
  savedSource: string;
  dirty: boolean;
};

export type WorkspacePersistedState = {
  workspaceVersion: number;
  documents: Record<string, DocumentSession>;
  tabOrder: string[];
  activeDocumentId: string;
  recentDocumentIds: string[];
};

export type WorkspaceEphemeralState = {
  // ── canvas slice ─────────────────────────────────────────────────────────────
  toolMode: ToolMode;
  canvasTransform: CanvasTransform;
  hoveredElementId: string | null;
  activeCanvasDragKind: CanvasDragKind | null;
  /** Source id currently being edited via source-number scrubbing. */
  activeSourceScrubSourceId: string | null;
  showGrid: boolean;
  snapToGrid: boolean;
  showRulers: boolean;
  showGuides: boolean;
  /** Monotonic token used to request a fit-to-content operation from CanvasPanel. */
  fitToContentRequestToken: number;

  // ── layout slice ─────────────────────────────────────────────────────────────
  leftPanelWidth: number;
  rightPanelWidth: number;
  showSourcePanel: boolean;
  showInspectorPanel: boolean;

  // ── debug ─────────────────────────────────────────────────────────────────────
  showDevPanel: boolean;
};

export type EditorState = {
  workspace: WorkspacePersistedState;
  ui: WorkspaceEphemeralState;

  // ── document slice ──────────────────────────────────────────────────────────
  source: string;
  snapshot: SessionSnapshot;
  /** Request ID of the most recently triggered compute; null if up-to-date. */
  pendingRequestId: string | null;
  /** Latest edit-derived source ids changed by WYSIWYG actions (used for drag invalidation hints). */
  lastEditChangedSourceIds: string[] | null;
  /** Monotonic token incremented when `lastEditChangedSourceIds` is updated. */
  lastEditChangeToken: number;

  // ── history slice ────────────────────────────────────────────────────────────
  /** WYSIWYG undo history (code edits use CodeMirror's built-in history). */
  history: HistoryEntry[];
  /** Points to the last applied entry; -1 means nothing to undo. */
  historyIndex: number;

  // ── selection slice ──────────────────────────────────────────────────────────
  selectedElementIds: ReadonlySet<string>;
  activeDocumentId: string;
  tabOrder: string[];
  documents: Record<string, DocumentSession>;
  workspaceVersion: number;

  // ── canvas slice ─────────────────────────────────────────────────────────────
  toolMode: ToolMode;
  canvasTransform: CanvasTransform;
  hoveredElementId: string | null;
  activeCanvasDragKind: CanvasDragKind | null;
  /** Source id currently being edited via source-number scrubbing. */
  activeSourceScrubSourceId: string | null;
  showGrid: boolean;
  snapToGrid: boolean;
  showRulers: boolean;
  showGuides: boolean;
  /** Monotonic token used to request a fit-to-content operation from CanvasPanel. */
  fitToContentRequestToken: number;

  // ── layout slice ─────────────────────────────────────────────────────────────
  leftPanelWidth: number;
  rightPanelWidth: number;
  showSourcePanel: boolean;
  showInspectorPanel: boolean;

  // ── debug ─────────────────────────────────────────────────────────────────────
  showDevPanel: boolean;
};

export type EditorAction =
  // Document
  | { type: "CODE_EDITED"; source: string }
  | { type: "NEW_DOCUMENT"; source?: string; title?: string }
  | { type: "SWITCH_DOCUMENT"; documentId: string }
  | { type: "CLOSE_DOCUMENT"; documentId?: string }
  | { type: "CLOSE_ALL_DOCUMENTS" }
  | { type: "OPEN_EXAMPLE_IN_NEW_TAB"; source: string; title: string }
  | { type: "MARK_DOCUMENT_SAVED"; documentId?: string; fileRef?: DocumentFileRef | null }
  | {
      type: "APPLY_EDIT_ACTION";
      action: EditAction;
      historyMergeKey?: string;
      /** False for transient UI previews that should not affect undo/redo history. */
      recordInHistory?: boolean;
      precomputedResult?: Extract<EditActionResult, { kind: "success" | "partial" }>;
    }
  | {
      type: "SET_SOURCE_TRANSIENT";
      source: string;
      changedSourceIds?: string[] | null;
    }
  | { type: "COMPUTE_REQUESTED"; requestId: string; documentId?: string }
  | { type: "SNAPSHOT_READY"; requestId: string; snapshot: SessionSnapshot; documentId?: string }
  // History
  | { type: "UNDO" }
  | { type: "REDO" }
  // Selection
  | { type: "SELECT"; id: string; additive: boolean }
  | { type: "SELECT_RANGE"; ids: string[] }
  | { type: "CLEAR_SELECTION" }
  // Canvas
  | { type: "SET_TOOL_MODE"; mode: ToolMode }
  | { type: "SET_CANVAS_TRANSFORM"; transform: CanvasTransform }
  | { type: "SET_HOVERED_ELEMENT"; id: string | null }
  | { type: "SET_ACTIVE_CANVAS_DRAG"; kind: CanvasDragKind | null }
  | { type: "SET_ACTIVE_SOURCE_SCRUB"; sourceId: string | null }
  | { type: "TOGGLE_CANVAS_AID"; aid: CanvasAid }
  | { type: "TOGGLE_SNAP_TO_GRID" }
  | { type: "REQUEST_FIT_TO_CONTENT" }
  // Layout
  | { type: "SET_PANEL_WIDTH"; panel: "left" | "right"; width: number }
  | { type: "TOGGLE_PANEL"; panel: "source" | "inspector" }
  // Debug
  | { type: "TOGGLE_DEV_PANEL" };
