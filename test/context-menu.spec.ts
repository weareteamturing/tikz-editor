import { describe, expect, it } from "vitest";
import { APP_MENU_COMMAND_IDS } from "../packages/app/src/app-menu/index.js";
import { CANVAS_CONTEXT_MENU_DEFINITION, buildCanvasContextMenuDefinition } from "../packages/app/src/context-menu/index.js";
import type { AppMenuItem } from "../packages/app/src/app-menu/types.js";

describe("canvas context menu definition", () => {
  it("defines entries for all context menu targets", () => {
    expect(Object.keys(CANVAS_CONTEXT_MENU_DEFINITION).sort()).toEqual([
      "canvas-empty",
      "selection-multi",
      "selection-single",
      "selection-single-node",
      "selection-single-node-tree",
      "selection-single-path-point",
      "selection-single-path-point-tree",
      "selection-single-tree"
    ]);
  });

  it("uses only known app command ids", () => {
    const knownCommandIds = new Set(Object.values(APP_MENU_COMMAND_IDS));
    const commandIds = collectCommandIds(CANVAS_CONTEXT_MENU_DEFINITION["canvas-empty"])
      .concat(collectCommandIds(CANVAS_CONTEXT_MENU_DEFINITION["selection-single-path-point"]))
      .concat(collectCommandIds(CANVAS_CONTEXT_MENU_DEFINITION["selection-single-path-point-tree"]))
      .concat(collectCommandIds(CANVAS_CONTEXT_MENU_DEFINITION["selection-single-node"]))
      .concat(collectCommandIds(CANVAS_CONTEXT_MENU_DEFINITION["selection-single-node-tree"]))
      .concat(collectCommandIds(CANVAS_CONTEXT_MENU_DEFINITION["selection-single-tree"]))
      .concat(collectCommandIds(CANVAS_CONTEXT_MENU_DEFINITION["selection-single"]))
      .concat(collectCommandIds(CANVAS_CONTEXT_MENU_DEFINITION["selection-multi"]));

    for (const commandId of commandIds) {
      expect(knownCommandIds.has(commandId as any)).toBe(true);
    }
  });

  it("defines canvas-empty with edit and view actions", () => {
    const items = CANVAS_CONTEXT_MENU_DEFINITION["canvas-empty"];
    const commandIds = collectCommandIds(items);

    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.UNDO);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.REDO);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.PASTE);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.FIT_TO_CONTENT);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.TOGGLE_GRID);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GRID);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GUIDES);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_POINTS);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_GAPS);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.TOGGLE_RULERS);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.TOGGLE_GUIDES);
  });

  it("defines selection-single with reorder submenu", () => {
    const items = CANVAS_CONTEXT_MENU_DEFINITION["selection-single"];
    const reorder = items.find((item) => item.kind === "submenu" && item.label === "Reorder");
    const path = items.find((item) => item.kind === "submenu" && item.label === "Path");

    expect(reorder).toBeDefined();
    expect(path).toBeDefined();
    expect(items.some((item) => item.kind === "submenu" && (item.label as string) === "Align")).toBe(false);
    expect(items.some((item) => item.kind === "submenu" && (item.label as string) === "Distribute")).toBe(false);
    if (!path || path.kind !== "submenu") {
      throw new Error("Expected Path submenu on single selection context menu.");
    }
    expect(collectCommandIds(items)).not.toContain(APP_MENU_COMMAND_IDS.TREE_ADD_CHILD);
    expect(collectCommandIds(items)).not.toContain(APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_BEFORE);
    expect(collectCommandIds(items)).not.toContain(APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_AFTER);
    expect(collectCommandIds(path.items)).toContain(APP_MENU_COMMAND_IDS.PATH_REVERSE);
  });

  it("defines selection-single-tree with tree actions at the top", () => {
    const items = CANVAS_CONTEXT_MENU_DEFINITION["selection-single-tree"];
    expect(items.slice(0, 3).map((item) => item.kind === "command" ? item.commandId : null)).toEqual([
      APP_MENU_COMMAND_IDS.TREE_ADD_CHILD,
      APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_BEFORE,
      APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_AFTER
    ]);
    expect(items[3]).toEqual({ kind: "separator" });
  });

  it("defines selection-single-node with label and pin insertion commands", () => {
    const items = CANVAS_CONTEXT_MENU_DEFINITION["selection-single-node"];
    const commandIds = collectCommandIds(items);

    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.ADD_LABEL);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.ADD_PIN);
    expect(commandIds).not.toContain(APP_MENU_COMMAND_IDS.EDIT_EQUATION);
    expect(commandIds).not.toContain(APP_MENU_COMMAND_IDS.TREE_ADD_CHILD);
    expect(commandIds).not.toContain(APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_BEFORE);
    expect(commandIds).not.toContain(APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_AFTER);
    expect(items.slice(0, 2).map((item) => item.kind === "command" ? item.commandId : null)).toEqual([
      APP_MENU_COMMAND_IDS.ADD_LABEL,
      APP_MENU_COMMAND_IDS.ADD_PIN
    ]);
    expect(items[2]).toEqual({ kind: "separator" });
  });

  it("defines selection-single-node-tree with tree actions above node actions", () => {
    const items = CANVAS_CONTEXT_MENU_DEFINITION["selection-single-node-tree"];
    const commandIds = collectCommandIds(items);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.ADD_LABEL);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.ADD_PIN);
    expect(items.slice(0, 3).map((item) => item.kind === "command" ? item.commandId : null)).toEqual([
      APP_MENU_COMMAND_IDS.TREE_ADD_CHILD,
      APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_BEFORE,
      APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_AFTER
    ]);
    expect(items[3]).toEqual({ kind: "separator" });
    expect(items.slice(4, 6).map((item) => item.kind === "command" ? item.commandId : null)).toEqual([
      APP_MENU_COMMAND_IDS.ADD_LABEL,
      APP_MENU_COMMAND_IDS.ADD_PIN
    ]);
    expect(items[6]).toEqual({ kind: "separator" });
  });

  it("adds Edit Equation for selection-single-node when opted in", () => {
    const withEdit = buildCanvasContextMenuDefinition({ includeEditEquationForSingleNode: true });
    const items = withEdit["selection-single-node-tree"];
    const commandIds = collectCommandIds(items);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.EDIT_EQUATION);
    expect(items.slice(0, 3).map((item) => item.kind === "command" ? item.commandId : null)).toEqual([
      APP_MENU_COMMAND_IDS.TREE_ADD_CHILD,
      APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_BEFORE,
      APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_AFTER
    ]);
    expect(items[3]).toEqual({ kind: "separator" });
    expect(items.slice(4, 7).map((item) => item.kind === "command" ? item.commandId : null)).toEqual([
      APP_MENU_COMMAND_IDS.EDIT_EQUATION,
      APP_MENU_COMMAND_IDS.ADD_LABEL,
      APP_MENU_COMMAND_IDS.ADD_PIN
    ]);
    expect(items[7]).toEqual({ kind: "separator" });
  });

  it("defines selection-single-path-point with point-editing commands up front", () => {
    const items = CANVAS_CONTEXT_MENU_DEFINITION["selection-single-path-point"];
    const commandItems = items.filter((item) => item.kind === "command");

    expect(commandItems.slice(0, 4).map((item) => item.commandId)).toEqual([
      APP_MENU_COMMAND_IDS.PATH_DELETE_POINT,
      APP_MENU_COMMAND_IDS.PATH_POINT_CORNER,
      APP_MENU_COMMAND_IDS.PATH_POINT_SMOOTH,
      APP_MENU_COMMAND_IDS.PATH_SPLIT
    ]);
  });

  it("defines selection-single-path-point-tree with tree actions before point-editing commands", () => {
    const items = CANVAS_CONTEXT_MENU_DEFINITION["selection-single-path-point-tree"];
    const commandItems = items.filter((item) => item.kind === "command");

    expect(commandItems.slice(0, 3).map((item) => item.commandId)).toEqual([
      APP_MENU_COMMAND_IDS.TREE_ADD_CHILD,
      APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_BEFORE,
      APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_AFTER
    ]);
    expect(commandItems.slice(3, 7).map((item) => item.commandId)).toEqual([
      APP_MENU_COMMAND_IDS.PATH_DELETE_POINT,
      APP_MENU_COMMAND_IDS.PATH_POINT_CORNER,
      APP_MENU_COMMAND_IDS.PATH_POINT_SMOOTH,
      APP_MENU_COMMAND_IDS.PATH_SPLIT
    ]);
  });

  it("defines selection-multi with align, distribute, and reorder submenus", () => {
    const items = CANVAS_CONTEXT_MENU_DEFINITION["selection-multi"];

    expect(items.some((item) => item.kind === "submenu" && item.label === "Align")).toBe(true);
    expect(items.some((item) => item.kind === "submenu" && item.label === "Transform")).toBe(true);
    expect(items.some((item) => item.kind === "submenu" && item.label === "Distribute")).toBe(true);
    expect(items.some((item) => item.kind === "submenu" && item.label === "Reorder")).toBe(true);
  });

  it("separates Group/Ungroup from clipboard actions with a divider under Duplicate", () => {
    const targets: Array<keyof typeof CANVAS_CONTEXT_MENU_DEFINITION> = [
      "selection-single",
      "selection-single-node",
      "selection-multi"
    ];

    for (const target of targets) {
      const items = CANVAS_CONTEXT_MENU_DEFINITION[target];
      const duplicateIndex = items.findIndex(
        (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.DUPLICATE
      );
      expect(duplicateIndex).toBeGreaterThanOrEqual(0);
      expect(items[duplicateIndex + 1]).toEqual({ kind: "separator" });
    }
  });

  it("groups selection-multi transform with align, distribute, and reorder without separators", () => {
    const items = CANVAS_CONTEXT_MENU_DEFINITION["selection-multi"];
    const submenuLabels = items.filter((item) => item.kind === "submenu").map((item) => item.label);

    expect(submenuLabels.slice(-4)).toEqual(["Align", "Transform", "Distribute", "Reorder"]);
    expect(items[items.length - 5]).toEqual({ kind: "separator" });
    expect(items.slice(-4).every((item) => item.kind === "submenu")).toBe(true);
  });
});

function collectCommandIds(items: readonly AppMenuItem[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    if (item.kind === "command") {
      result.push(item.commandId);
      continue;
    }
    if (item.kind === "submenu") {
      result.push(...collectCommandIds(item.items));
    }
  }
  return result;
}
