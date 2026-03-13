import { describe, expect, it } from "vitest";
import { APP_MENU_COMMAND_IDS } from "../packages/app/src/app-menu/index.js";
import { CANVAS_CONTEXT_MENU_DEFINITION } from "../packages/app/src/context-menu/index.js";
import type { AppMenuItem } from "../packages/app/src/app-menu/types.js";

describe("canvas context menu definition", () => {
  it("defines entries for all context menu targets", () => {
    expect(Object.keys(CANVAS_CONTEXT_MENU_DEFINITION).sort()).toEqual([
      "canvas-empty",
      "selection-multi",
      "selection-single",
      "selection-single-node"
    ]);
  });

  it("uses only known app command ids", () => {
    const knownCommandIds = new Set(Object.values(APP_MENU_COMMAND_IDS));
    const commandIds = collectCommandIds(CANVAS_CONTEXT_MENU_DEFINITION["canvas-empty"])
      .concat(collectCommandIds(CANVAS_CONTEXT_MENU_DEFINITION["selection-single-node"]))
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
  });

  it("defines selection-single-node with label and pin insertion commands", () => {
    const commandIds = collectCommandIds(CANVAS_CONTEXT_MENU_DEFINITION["selection-single-node"]);

    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.ADD_LABEL);
    expect(commandIds).toContain(APP_MENU_COMMAND_IDS.ADD_PIN);
  });

  it("defines selection-multi with align, distribute, and reorder submenus", () => {
    const items = CANVAS_CONTEXT_MENU_DEFINITION["selection-multi"];

    expect(items.some((item) => item.kind === "submenu" && item.label === "Align")).toBe(true);
    expect(items.some((item) => item.kind === "submenu" && item.label === "Transform")).toBe(true);
    expect(items.some((item) => item.kind === "submenu" && item.label === "Distribute")).toBe(true);
    expect(items.some((item) => item.kind === "submenu" && item.label === "Reorder")).toBe(true);
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
