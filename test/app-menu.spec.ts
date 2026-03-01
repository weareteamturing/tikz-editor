import { describe, expect, it } from "vitest";
import { APP_MENU_COMMAND_IDS, APP_MENU_DEFINITION } from "../src/app-menu/index.js";

describe("app menu definition", () => {
  it("defines an open-example command id", () => {
    expect(APP_MENU_COMMAND_IDS.OPEN_EXAMPLE).toBe("file.open-example");
  });

  it("defines svg export command ids", () => {
    expect(APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD).toBe("file.export-svg-download");
    expect(APP_MENU_COMMAND_IDS.EXPORT_SVG_COPY).toBe("file.export-svg-copy");
  });

  it("keeps the legacy export command id", () => {
    expect(APP_MENU_COMMAND_IDS.EXPORT_TIKZ).toBe("file.export-tikz");
  });

  it("defines a snap-to-grid command id", () => {
    expect(APP_MENU_COMMAND_IDS.TOGGLE_SNAP_TO_GRID).toBe("view.toggle-snap-to-grid");
  });

  it("defines a bezier insert command id", () => {
    expect(APP_MENU_COMMAND_IDS.INSERT_BEZIER).toBe("insert.bezier");
  });

  it("exposes Open Example in the File menu", () => {
    const fileSection = APP_MENU_DEFINITION.find((section) => section.id === "file");
    expect(fileSection).toBeDefined();
    const items = fileSection?.items ?? [];
    const commandItem = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.OPEN_EXAMPLE
    );
    expect(commandItem).toBeDefined();
    if (!commandItem || commandItem.kind !== "command") {
      throw new Error("Expected file.open-example command item in File menu.");
    }
    expect(commandItem.label).toBe("Open Example...");
  });

  it("exposes Export SVG in the File menu", () => {
    const fileSection = APP_MENU_DEFINITION.find((section) => section.id === "file");
    expect(fileSection).toBeDefined();
    const items = fileSection?.items ?? [];
    const commandItem = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD
    );
    expect(commandItem).toBeDefined();
    if (!commandItem || commandItem.kind !== "command") {
      throw new Error("Expected file.export-svg-download command item in File menu.");
    }
    expect(commandItem.label).toBe("Export SVG...");
  });

  it("exposes Copy SVG in the File menu", () => {
    const fileSection = APP_MENU_DEFINITION.find((section) => section.id === "file");
    expect(fileSection).toBeDefined();
    const items = fileSection?.items ?? [];
    const commandItem = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.EXPORT_SVG_COPY
    );
    expect(commandItem).toBeDefined();
    if (!commandItem || commandItem.kind !== "command") {
      throw new Error("Expected file.export-svg-copy command item in File menu.");
    }
    expect(commandItem.label).toBe("Copy SVG");
  });

  it("exposes Snap to Grid in the View menu", () => {
    const viewSection = APP_MENU_DEFINITION.find((section) => section.id === "view");
    expect(viewSection).toBeDefined();
    const items = viewSection?.items ?? [];
    const commandItem = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.TOGGLE_SNAP_TO_GRID
    );
    expect(commandItem).toBeDefined();
    if (!commandItem || commandItem.kind !== "command") {
      throw new Error("Expected view.toggle-snap-to-grid command item in View menu.");
    }
    expect(commandItem.label).toBe("Snap to Grid");
  });

  it("exposes Bezier in the Insert menu", () => {
    const insertSection = APP_MENU_DEFINITION.find((section) => section.id === "insert");
    expect(insertSection).toBeDefined();
    const items = insertSection?.items ?? [];
    const commandItem = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.INSERT_BEZIER
    );
    expect(commandItem).toBeDefined();
    if (!commandItem || commandItem.kind !== "command") {
      throw new Error("Expected insert.bezier command item in Insert menu.");
    }
    expect(commandItem.label).toBe("Bezier");
  });
});
