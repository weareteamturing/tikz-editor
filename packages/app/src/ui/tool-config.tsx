import React from "react";
import { BASIC_PICKER_COLORS } from "../color-palette";
import type { SnapToolPointerKind } from "tikz-editor/edit/snapping";
import type { ToolMode } from "../store/types";

// ── Custom Tool Icons ─────────────────────────────────────────────────────────
// All icons use a consistent 20x20 viewBox with 1.5px stroke width

function SelectIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 2L5 14L8.5 10.5L11 16L13 15L10.5 9.5L15 9L5 2Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function NodeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="16" height="14" stroke="#666" strokeDasharray="2 2" />
      <text x="10" y="13.5" fontSize="11" fontWeight="600" textAnchor="middle" fill="currentColor" stroke="none">A</text>
    </svg>
  );
}

function ShapeIcon({ size = 20 }: { size?: number }) {
  // Two overlapping shapes: star in back (lighter), thick arrow in front (darker)
  return (
    <svg viewBox="0 0 20 20" width={size} height={size}>
      {/* 5-point star in back, lighter gray, stretched right */}
      <polygon fill="#777" points="7,0 9,5 14,5 10,8.5 12,14 7,11 2,14 3.5,8.5 0,5 5,5" />
      {/* Thick right arrow in front, darker gray */}
      <polygon fill="#444" points="7,10 14,10 14,7 19,13 14,19 14,16 7,16" />
    </svg>
  );
}

function PathIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 16L8 8L12 12L17 4" />
      <circle cx="3" cy="16" r="1.5" fill="currentColor" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="17" cy="4" r="1.5" fill="currentColor" />
    </svg>
  );
}

function FreehandIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 14C5 10 7 8 10 9C13 10 14 14 17 6" />
    </svg>
  );
}

function LineIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="16" x2="16" y2="4" />
    </svg>
  );
}

function ArrowIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="16" x2="16" y2="4" />
      <polyline points="10,4 16,4 16,10" />
    </svg>
  );
}

function BezierIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 15C3 15 7 3 10 10C13 17 17 5 17 5" />
      <circle cx="3" cy="15" r="1.5" fill="currentColor" />
      <circle cx="17" cy="5" r="1.5" fill="currentColor" />
    </svg>
  );
}

function GridIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="14" height="14" />
      <line x1="3" y1="10" x2="17" y2="10" />
      <line x1="10" y1="3" x2="10" y2="17" />
    </svg>
  );
}

function RectIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="14" height="10" />
    </svg>
  );
}

function EllipseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="10" cy="10" rx="7" ry="4.5" />
    </svg>
  );
}

function CircleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="6.5" />
    </svg>
  );
}

function BucketIcon({ size = 20 }: { size?: number }) {
  // Paint bucket icon from Remix Design (RiPaintFill) in gray
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#666">
      <path d="M19.2277 18.7323L20.9955 16.9645L22.7632 18.7323C23.7395 19.7086 23.7395 21.2915 22.7632 22.2678C21.7869 23.2441 20.204 23.2441 19.2277 22.2678C18.2514 21.2915 18.2514 19.7086 19.2277 18.7323ZM8.87861 1.07971L20.1923 12.3934C20.5828 12.7839 20.5828 13.4171 20.1923 13.8076L11.707 22.2929C11.3165 22.6834 10.6833 22.6834 10.2928 22.2929L1.80754 13.8076C1.41702 13.4171 1.41702 12.7839 1.80754 12.3934L9.58572 4.61525L7.4644 2.49393L8.87861 1.07971ZM10.9999 6.02946L3.92886 13.1005H18.071L10.9999 6.02946Z" />
    </svg>
  );
}

function CaretDownIcon({ size = 8 }: { size?: number }) {
  return (
    <svg viewBox="0 0 8 8" width={size} height={size} fill="currentColor">
      <path d="M1 2.5L4 5.5L7 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export { CaretDownIcon };

type ToolIconType = ({ size }: { size?: number }) => React.ReactElement;

export type ToolButtonDef = {
  mode: ToolMode;
  label: string;
  title: string;
  shortcut?: string;
  icon: ToolIconType;
  popupKind?: ToolPopupKind;
  autoOpenPopup?: boolean;
};

export type ToolPopupKind = "bucket-color" | "shape-picker";

export const TOOL_COLOR_OPTIONS = BASIC_PICKER_COLORS;

// Tool buttons in display order (bucket moved to end)
export const TOOL_BUTTONS: readonly ToolButtonDef[] = [
  { mode: "select",     label: "Select",   title: "Select and move elements (V)",                     shortcut: "v", icon: SelectIcon },
  { mode: "addNode",    label: "Node",     title: "Place a text node (N)",                            shortcut: "n", icon: NodeIcon },
  { mode: "addShape",   label: "Shape",    title: "Place a shaped node (S).",                         shortcut: "s", icon: ShapeIcon, popupKind: "shape-picker" },
  { mode: "addPath",    label: "Path",     title: "Draw a multi-segment path (P). Click to add points, drag to bend, click start to close.", shortcut: "p", icon: PathIcon },
  { mode: "addFreehand", label: "Freehand", title: "Draw a freehand curve (F). Press and drag to draw one stroke.", shortcut: "f", icon: FreehandIcon },
  { mode: "addLine",    label: "Line",     title: "Draw a line (L)",                                  shortcut: "l", icon: LineIcon },
  { mode: "addArrow",   label: "Arrow",    title: "Draw an arrow (A)",                                shortcut: "a", icon: ArrowIcon },
  { mode: "addBezier",  label: "Bezier",   title: "Draw a cubic Bezier curve (B) with two drags",    shortcut: "b", icon: BezierIcon },
  { mode: "addGrid",    label: "Grid",     title: "Draw a grid. Hold Shift to constrain to a square.",                icon: GridIcon },
  { mode: "addRect",    label: "Rect",     title: "Draw a rectangle (R). Hold Shift to constrain to a square.", shortcut: "r", icon: RectIcon },
  { mode: "addEllipse", label: "Ellipse",  title: "Draw an ellipse (E). Hold Shift to constrain to a circle.", shortcut: "e", icon: EllipseIcon },
  { mode: "addCircle",  label: "Circle",   title: "Draw a circle from center (C)",                   shortcut: "c", icon: CircleIcon },
  { mode: "addBucket",  label: "Bucket",   title: "Fill a shape with the selected color.",                           icon: BucketIcon, popupKind: "bucket-color" },
];

export const TOOL_CREATE_MODES = ["addPath", "addLine", "addArrow", "addBezier", "addGrid", "addRect", "addEllipse", "addCircle", "addShape"] as const;

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

export function toolModeAutoOpensPopup(mode: ToolMode): boolean {
  // Shape tool no longer auto-opens; it opens on click but doesn't activate until selection
  return false;
}

export function isToolCreateMode(mode: ToolMode): mode is ToolCreateMode {
  return TOOL_CREATE_MODE_SET.has(mode as ToolCreateMode);
}

export function toolCreateSnapKind(mode: ToolCreateMode): SnapToolPointerKind {
  if (mode === "addGrid" || mode === "addRect" || mode === "addEllipse" || mode === "addShape") {
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

export const TOOL_HINTS: Partial<Record<ToolMode, string>> = {
  addRect: "Hold Shift to constrain to a square",
  addEllipse: "Hold Shift to constrain to a circle",
  addGrid: "Hold Shift to constrain to a square",
  addCircle: "Drag from center to edge",
  addPath: "Click to add points, drag to bend. Click start to close, or press Enter/Esc to finish.",
  addFreehand: "Press and drag to draw",
  addBezier: "Two drags: endpoints then curve",
  addLine: "Drag to set length and angle",
  addArrow: "Drag to set length and angle",
  addShape: "Drag to set size",
  addNode: "Click to place text",
};

export function isCreationToolMode(mode: ToolMode): boolean {
  return mode !== "select";
}

export function toolSupportsStroke(mode: ToolMode): boolean {
  return mode !== "select" && mode !== "addBucket";
}

export function toolSupportsFill(mode: ToolMode): boolean {
  return mode === "addRect" || mode === "addEllipse" || mode === "addCircle" || mode === "addShape";
}

export function getToolLabel(mode: ToolMode): string {
  const def = TOOL_BUTTONS.find((b) => b.mode === mode);
  return def?.label ?? mode;
}
