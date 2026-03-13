import React from "react";
import type { SnapToolPointerKind } from "tikz-editor/edit/snapping";
import type { ToolMode } from "../store/types";
import {
  RiCursorLine,
  RiText,
  RiPencilLine,
  RiBrushLine,
  RiSubtractLine,
  RiArrowRightLine,
  RiPenNibLine,
  RiGridLine,
  RiRectangleLine,
  RiCircleLine,
} from "@remixicon/react";
import type { RemixiconComponentType } from "@remixicon/react";

// Matches Remix icon style: fill="currentColor", dual-path ring (outer CCW + inner CW).
// Outer ellipse rx=10 ry=5.5, inner rx=8 ry=3.5 — same 2-unit ring thickness as RiCircleLine.
function EllipseIcon({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor">
      <path d="M12 17.5C6.4772 17.5 2 15.0376 2 12C2 8.9624 6.4772 6.5 12 6.5C17.5228 6.5 22 8.9624 22 12C22 15.0376 17.5228 17.5 12 17.5ZM12 15.5C16.4183 15.5 20 13.933 20 12C20 10.067 16.4183 8.5 12 8.5C7.5817 8.5 4 10.067 4 12C4 13.933 7.5817 15.5 12 15.5Z" />
    </svg>
  );
}

type AnyIconType = RemixiconComponentType | (({ size }: { size?: number }) => React.ReactElement);

export type ToolButtonDef = {
  mode: ToolMode;
  label: string;
  title: string;
  shortcut?: string;
  icon: AnyIconType;
  popupKind?: ToolPopupKind;
};

export type ToolPopupKind = "freehand-smoothing";

export const TOOL_BUTTONS: readonly ToolButtonDef[] = [
  { mode: "select",     label: "Select",  title: "Select and move elements (V)",                     shortcut: "v", icon: RiCursorLine },
  { mode: "addNode",    label: "Node",    title: "Place a text node (N)",                            shortcut: "n", icon: RiText },
  { mode: "addPath",    label: "Path",    title: "Draw a multi-segment path (P). Click to add points, drag to bend, click start to close.", shortcut: "p", icon: RiPencilLine },
  {
    mode: "addFreehand",
    label: "Freehand",
    title: "Draw a freehand curve (F). Press and drag to draw one stroke.",
    shortcut: "f",
    icon: RiBrushLine,
    popupKind: "freehand-smoothing"
  },
  { mode: "addLine",    label: "Line",    title: "Draw a line (L)",                                  shortcut: "l", icon: RiSubtractLine },
  { mode: "addArrow",   label: "Arrow",   title: "Draw an arrow (A)",                                shortcut: "a", icon: RiArrowRightLine },
  { mode: "addBezier",  label: "Bezier",  title: "Draw a cubic Bezier curve (B) with two drags",    shortcut: "b", icon: RiPenNibLine },
  { mode: "addGrid",    label: "Grid",    title: "Draw a grid. Hold Shift to constrain to a square.",                icon: RiGridLine },
  { mode: "addRect",    label: "Rect",    title: "Draw a rectangle (R). Hold Shift to constrain to a square.", shortcut: "r", icon: RiRectangleLine },
  { mode: "addEllipse", label: "Ellipse", title: "Draw an ellipse (E). Hold Shift to constrain to a circle.", shortcut: "e", icon: EllipseIcon },
  { mode: "addCircle",  label: "Circle",  title: "Draw a circle from center (C)",                   shortcut: "c", icon: RiCircleLine },
];

export const TOOL_CREATE_MODES = ["addPath", "addLine", "addArrow", "addBezier", "addGrid", "addRect", "addEllipse", "addCircle"] as const;

export type ToolCreateMode = (typeof TOOL_CREATE_MODES)[number];

const TOOL_SHORTCUT_MAP = new Map<string, ToolMode>(
  TOOL_BUTTONS.flatMap((tool) => (tool.shortcut ? [[tool.shortcut, tool.mode] as const] : []))
);
const TOOL_POPUP_KIND_MAP = new Map<ToolMode, ToolPopupKind>(
  TOOL_BUTTONS.flatMap((tool) => (tool.popupKind ? [[tool.mode, tool.popupKind] as const] : []))
);

const TOOL_CREATE_MODE_SET = new Set<ToolCreateMode>(TOOL_CREATE_MODES);

export function toolModeFromShortcut(key: string): ToolMode | null {
  return TOOL_SHORTCUT_MAP.get(key.toLowerCase()) ?? null;
}

export function resolveToolbarToolMode(currentMode: ToolMode, clickedMode: ToolMode): ToolMode {
  if (clickedMode !== "select" && clickedMode === currentMode && !toolModeHasPopup(clickedMode)) {
    return "select";
  }
  return clickedMode;
}

export function toolModePopupKind(mode: ToolMode): ToolPopupKind | null {
  return TOOL_POPUP_KIND_MAP.get(mode) ?? null;
}

export function toolModeHasPopup(mode: ToolMode): boolean {
  return toolModePopupKind(mode) != null;
}

export function isToolCreateMode(mode: ToolMode): mode is ToolCreateMode {
  return TOOL_CREATE_MODE_SET.has(mode as ToolCreateMode);
}

export function toolCreateSnapKind(mode: ToolCreateMode): SnapToolPointerKind {
  if (mode === "addGrid" || mode === "addRect" || mode === "addEllipse") {
    return "rect-corner";
  }
  if (mode === "addCircle") {
    return "circle-edge";
  }
  return "line-end";
}

export function shouldConstrainToolCreateToSquare(mode: ToolCreateMode): boolean {
  return mode === "addGrid" || mode === "addRect" || mode === "addEllipse";
}
