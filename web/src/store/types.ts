import type { SessionSnapshot } from "../compute";
import type { EditAction, EditActionResult } from "tikz-editor/edit/actions";

export type ToolMode = "select" | "addNode" | "addLine" | "addRect" | "addCircle" | "addArrow";
export type CanvasDragKind = "element" | "resize" | "handle" | "pan" | "marquee" | "tool-create" | "text-select";

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

export type InternalClipboard = {
  snippets: string[];
  plainText: string;
  copiedAt: number;
};

export type EditorState = {
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
  internalClipboard: InternalClipboard | null;

  // ── canvas slice ─────────────────────────────────────────────────────────────
  toolMode: ToolMode;
  canvasTransform: CanvasTransform;
  hoveredElementId: string | null;
  activeCanvasDragKind: CanvasDragKind | null;
  /** Source id currently being edited via source-number scrubbing. */
  activeSourceScrubSourceId: string | null;

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
  | {
      type: "APPLY_EDIT_ACTION";
      action: EditAction;
      historyMergeKey?: string;
      precomputedResult?: Extract<EditActionResult, { kind: "success" | "partial" }>;
    }
  | { type: "COMPUTE_REQUESTED"; requestId: string }
  | { type: "SNAPSHOT_READY"; requestId: string; snapshot: SessionSnapshot }
  // History
  | { type: "UNDO" }
  | { type: "REDO" }
  // Selection
  | { type: "SELECT"; id: string; additive: boolean }
  | { type: "SELECT_RANGE"; ids: string[] }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_INTERNAL_CLIPBOARD"; clipboard: InternalClipboard | null }
  // Canvas
  | { type: "SET_TOOL_MODE"; mode: ToolMode }
  | { type: "SET_CANVAS_TRANSFORM"; transform: CanvasTransform }
  | { type: "SET_HOVERED_ELEMENT"; id: string | null }
  | { type: "SET_ACTIVE_CANVAS_DRAG"; kind: CanvasDragKind | null }
  | { type: "SET_ACTIVE_SOURCE_SCRUB"; sourceId: string | null }
  // Layout
  | { type: "SET_PANEL_WIDTH"; panel: "left" | "right"; width: number }
  | { type: "TOGGLE_PANEL"; panel: "source" | "inspector" }
  // Debug
  | { type: "TOGGLE_DEV_PANEL" };
