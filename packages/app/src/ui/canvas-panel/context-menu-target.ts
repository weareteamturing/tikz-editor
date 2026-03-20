import type { CanvasContextMenuTarget } from "../../context-menu";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import { parseTikzForEdit } from "tikz-editor/edit/parse-options";
import type { PathStatement, Statement } from "tikz-editor/ast/types";
import type { ToolMode } from "../../store/types";

export type ContextMenuSelectionAction =
  | { kind: "preserve" }
  | { kind: "clear" }
  | { kind: "select-only"; sourceId: string };

export type ResolveCanvasContextMenuTargetInput = {
  source: string;
  toolMode: ToolMode;
  clickedSourceId: string | null;
  selectedElementIds: ReadonlySet<string>;
};

export type ResolveCanvasContextMenuTargetResult = {
  target: CanvasContextMenuTarget;
  selectionAction: ContextMenuSelectionAction;
};

export function resolveCanvasContextMenuTarget(
  input: ResolveCanvasContextMenuTargetInput
): ResolveCanvasContextMenuTargetResult {
  const { clickedSourceId, selectedElementIds, source } = input;

  if (!clickedSourceId) {
    return {
      target: "canvas-empty",
      selectionAction: { kind: "clear" }
    };
  }

  if (selectedElementIds.has(clickedSourceId)) {
    const treeTarget = isTreeContextTarget(source, clickedSourceId);
    return {
      target:
        selectedElementIds.size > 1
          ? "selection-multi"
          : isNodeContextTarget(source, clickedSourceId)
            ? (treeTarget ? "selection-single-node-tree" : "selection-single-node")
            : (treeTarget ? "selection-single-tree" : "selection-single"),
      selectionAction: { kind: "preserve" }
    };
  }

  const treeTarget = isTreeContextTarget(source, clickedSourceId);
  return {
    target: isNodeContextTarget(source, clickedSourceId)
      ? (treeTarget ? "selection-single-node-tree" : "selection-single-node")
      : (treeTarget ? "selection-single-tree" : "selection-single"),
    selectionAction: { kind: "select-only", sourceId: clickedSourceId }
  };
}

function isNodeContextTarget(source: string, targetId: string): boolean {
  const resolved = resolvePropertyTarget(source, targetId);
  if (resolved.kind === "not-found") {
    return false;
  }
  return (
    resolved.target.kind === "node-item" ||
    (resolved.target.kind === "path-statement" && resolved.target.pathCommand === "node")
  );
}

function isTreeContextTarget(source: string, targetId: string): boolean {
  const resolved = resolvePropertyTarget(source, targetId);
  if (resolved.kind === "not-found") {
    return false;
  }
  if (resolved.target.kind === "tree-child") {
    return true;
  }
  if (resolved.target.kind !== "path-statement") {
    return false;
  }
  const parsed = parseTikzForEdit(source);
  const statement = findPathStatementById(parsed.figure.body, targetId);
  if (!statement) {
    return false;
  }
  return statement.items.some((item) => item.kind === "ChildOperation");
}

function findPathStatementById(statements: readonly Statement[], sourceId: string): PathStatement | null {
  for (const statement of statements) {
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, sourceId);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (statement.kind === "Path" && statement.id === sourceId) {
      return statement;
    }
  }
  return null;
}

export type ContextMenuAnchor = {
  x: number;
  y: number;
};

export type ContextMenuSize = {
  width: number;
  height: number;
};

export type ContextMenuBounds = {
  width: number;
  height: number;
};

export function clampContextMenuAnchor(
  anchor: ContextMenuAnchor,
  menuSize: ContextMenuSize,
  bounds: ContextMenuBounds,
  padding = 4
): ContextMenuAnchor {
  const maxX = Math.max(padding, bounds.width - menuSize.width - padding);
  const maxY = Math.max(padding, bounds.height - menuSize.height - padding);

  return {
    x: clamp(anchor.x, padding, maxX),
    y: clamp(anchor.y, padding, maxY)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
