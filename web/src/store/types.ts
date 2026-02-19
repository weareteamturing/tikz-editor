import type { SessionSnapshot } from "../compute";
import type { EditAction } from "tikz-editor/edit/actions";

export type ToolMode = "select" | "addNode" | "addLine" | "addRect" | "addCircle" | "addArrow";

export type CanvasTransform = {
  translateX: number;
  translateY: number;
  scale: number;
};

export type HistoryEntry = {
  kind: "move" | "move-handle" | "set-property" | "add-element" | "delete" | "resize";
  label: string;
  /** Patches to apply to go backward (undo). */
  backward: import("tikz-editor/edit/types").SourcePatch[];
  /** Patches to apply to go forward (redo). */
  forward: import("tikz-editor/edit/types").SourcePatch[];
  /** Source before the action (for full undo). */
  sourceBefore: string;
  /** Source after the action (for full redo). */
  sourceAfter: string;
};

export type EditorState = {
  // ── document slice ──────────────────────────────────────────────────────────
  source: string;
  snapshot: SessionSnapshot;
  /** Request ID of the most recently triggered compute; null if up-to-date. */
  pendingRequestId: string | null;

  // ── history slice ────────────────────────────────────────────────────────────
  /** WYSIWYG undo history (code edits use CodeMirror's built-in history). */
  history: HistoryEntry[];
  /** Points to the last applied entry; -1 means nothing to undo. */
  historyIndex: number;

  // ── selection slice ──────────────────────────────────────────────────────────
  selectedElementIds: ReadonlySet<string>;

  // ── canvas slice ─────────────────────────────────────────────────────────────
  toolMode: ToolMode;
  canvasTransform: CanvasTransform;
  hoveredElementId: string | null;

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
  | { type: "APPLY_EDIT_ACTION"; action: EditAction }
  | { type: "COMPUTE_REQUESTED"; requestId: string }
  | { type: "SNAPSHOT_READY"; requestId: string; snapshot: SessionSnapshot }
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
  // Layout
  | { type: "SET_PANEL_WIDTH"; panel: "left" | "right"; width: number }
  | { type: "TOGGLE_PANEL"; panel: "source" | "inspector" }
  // Debug
  | { type: "TOGGLE_DEV_PANEL" };
