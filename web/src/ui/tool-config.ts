import type { SnapToolPointerKind } from "tikz-editor/edit/snapping";
import type { ToolMode } from "../store/types";

export type ToolButtonDef = {
  mode: ToolMode;
  label: string;
  title: string;
  shortcut?: string;
};

export const TOOL_BUTTONS: readonly ToolButtonDef[] = [
  { mode: "select", label: "↖ Select", title: "Select and move elements (V)", shortcut: "v" },
  { mode: "addNode", label: "+ Node", title: "Place a text node (N)", shortcut: "n" },
  { mode: "addLine", label: "/ Line", title: "Draw a line (L)", shortcut: "l" },
  { mode: "addArrow", label: "→ Arrow", title: "Draw an arrow (A)", shortcut: "a" },
  { mode: "addRect", label: "□ Rect", title: "Draw a rectangle (R). Hold Shift to constrain to a square.", shortcut: "r" },
  { mode: "addEllipse", label: "⬭ Ellipse", title: "Draw an ellipse (E). Hold Shift to constrain to a circle.", shortcut: "e" },
  { mode: "addCircle", label: "○ Circle", title: "Draw a circle from center (C)", shortcut: "c" }
];

export const TOOL_CREATE_MODES = ["addLine", "addArrow", "addRect", "addEllipse", "addCircle"] as const;

export type ToolCreateMode = (typeof TOOL_CREATE_MODES)[number];

const TOOL_SHORTCUT_MAP = new Map<string, ToolMode>(
  TOOL_BUTTONS.flatMap((tool) => (tool.shortcut ? [[tool.shortcut, tool.mode] as const] : []))
);

const TOOL_CREATE_MODE_SET = new Set<ToolCreateMode>(TOOL_CREATE_MODES);

export function toolModeFromShortcut(key: string): ToolMode | null {
  return TOOL_SHORTCUT_MAP.get(key.toLowerCase()) ?? null;
}

export function isToolCreateMode(mode: ToolMode): mode is ToolCreateMode {
  return TOOL_CREATE_MODE_SET.has(mode as ToolCreateMode);
}

export function toolCreateSnapKind(mode: ToolCreateMode): SnapToolPointerKind {
  if (mode === "addRect" || mode === "addEllipse") {
    return "rect-corner";
  }
  if (mode === "addCircle") {
    return "circle-edge";
  }
  return "line-end";
}

export function shouldConstrainToolCreateToSquare(mode: ToolCreateMode): boolean {
  return mode === "addRect" || mode === "addEllipse";
}
