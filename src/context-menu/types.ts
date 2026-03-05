import type { AppMenuCommandId, AppMenuItem } from "../app-menu/types.js";

export type CanvasContextMenuTarget = "canvas-empty" | "selection-single" | "selection-multi";

export type CanvasContextMenuCommandId = AppMenuCommandId;

export type CanvasContextMenuDefinition = Readonly<Record<CanvasContextMenuTarget, readonly AppMenuItem[]>>;
