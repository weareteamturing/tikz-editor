import { describe, expect, it } from "vitest";
import { APP_MENU_COMMAND_IDS, APP_MENU_DEFINITION } from "../packages/app/src/app-menu/index.js";

describe("app menu definition", () => {
  it("defines file lifecycle command ids", () => {
    expect(APP_MENU_COMMAND_IDS.NEW_DOCUMENT).toBe("file.new-document");
    expect(APP_MENU_COMMAND_IDS.OPEN_DOCUMENT).toBe("file.open-document");
    expect(APP_MENU_COMMAND_IDS.IMPORT_POWERPOINT).toBe("file.import-powerpoint");
    expect(APP_MENU_COMMAND_IDS.IMPORT_SVG).toBe("file.import-svg");
    expect(APP_MENU_COMMAND_IDS.SAVE_DOCUMENT).toBe("file.save-document");
    expect(APP_MENU_COMMAND_IDS.SAVE_DOCUMENT_AS).toBe("file.save-document-as");
    expect(APP_MENU_COMMAND_IDS.CLOSE_DOCUMENT).toBe("file.close-document");
    expect(APP_MENU_COMMAND_IDS.CLOSE_ALL_DOCUMENTS).toBe("file.close-all-documents");
  });

  it("defines an open-example command id", () => {
    expect(APP_MENU_COMMAND_IDS.OPEN_EXAMPLE).toBe("file.open-example");
  });

  it("defines svg export command ids", () => {
    expect(APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD).toBe("file.export-svg-download");
    expect(APP_MENU_COMMAND_IDS.EXPORT_STANDALONE_LATEX_DOWNLOAD).toBe("file.export-standalone-latex-download");
    expect(APP_MENU_COMMAND_IDS.EXPORT_PDF_DOWNLOAD).toBe("file.export-pdf-download");
    expect(APP_MENU_COMMAND_IDS.EXPORT_PNG_DOWNLOAD).toBe("file.export-png-download");
    expect(APP_MENU_COMMAND_IDS.EXPORT_SVG_COPY).toBe("file.export-svg-copy");
  });

  it("defines snapping command ids", () => {
    expect(APP_MENU_COMMAND_IDS.TOGGLE_TRANSPARENCY_GRID).toBe("view.toggle-transparency-grid");
    expect(APP_MENU_COMMAND_IDS.TOGGLE_INFINITE_CANVAS).toBe("view.toggle-infinite-canvas");
    expect(APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GRID).toBe("view.toggle-snap-grid");
    expect(APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GUIDES).toBe("view.toggle-snap-guides");
    expect(APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_POINTS).toBe("view.toggle-snap-object-points");
    expect(APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_GAPS).toBe("view.toggle-snap-object-gaps");
    expect(APP_MENU_COMMAND_IDS.TOGGLE_SNAP_HAPTICS).toBe("view.toggle-snap-haptics");
  });

  it("defines zoom command ids", () => {
    expect(APP_MENU_COMMAND_IDS.ZOOM_IN).toBe("view.zoom-in");
    expect(APP_MENU_COMMAND_IDS.ZOOM_OUT).toBe("view.zoom-out");
  });

  it("defines a bezier insert command id", () => {
    expect(APP_MENU_COMMAND_IDS.INSERT_BEZIER).toBe("insert.bezier");
  });

  it("defines an equation insert command id", () => {
    expect(APP_MENU_COMMAND_IDS.INSERT_EQUATION).toBe("insert.equation");
  });

  it("defines an equation edit command id", () => {
    expect(APP_MENU_COMMAND_IDS.EDIT_EQUATION).toBe("edit.equation");
  });

  it("defines a path insert command id", () => {
    expect(APP_MENU_COMMAND_IDS.INSERT_PATH).toBe("insert.path");
  });

  it("defines a freehand insert command id", () => {
    expect(APP_MENU_COMMAND_IDS.INSERT_FREEHAND).toBe("insert.freehand");
  });

  it("defines a grid insert command id", () => {
    expect(APP_MENU_COMMAND_IDS.INSERT_GRID).toBe("insert.grid");
  });

  it("defines a format command id", () => {
    expect(APP_MENU_COMMAND_IDS.FORMAT_TIKZ).toBe("edit.format-tikz");
  });

  it("defines group and ungroup command ids", () => {
    expect(APP_MENU_COMMAND_IDS.GROUP).toBe("edit.group");
    expect(APP_MENU_COMMAND_IDS.UNGROUP).toBe("edit.ungroup");
  });

  it("defines path editing command ids", () => {
    expect(APP_MENU_COMMAND_IDS.PATH_SPLIT).toBe("path.split");
    expect(APP_MENU_COMMAND_IDS.PATH_JOIN).toBe("path.join");
    expect(APP_MENU_COMMAND_IDS.PATH_REVERSE).toBe("path.reverse");
    expect(APP_MENU_COMMAND_IDS.PATH_CLOSE).toBe("path.close");
    expect(APP_MENU_COMMAND_IDS.PATH_OPEN).toBe("path.open");
    expect(APP_MENU_COMMAND_IDS.PATH_DELETE_POINT).toBe("path.delete-point");
    expect(APP_MENU_COMMAND_IDS.PATH_POINT_CORNER).toBe("path.point-corner");
    expect(APP_MENU_COMMAND_IDS.PATH_POINT_SMOOTH).toBe("path.point-smooth");
  });

  it("defines a help manual command id", () => {
    expect(APP_MENU_COMMAND_IDS.OPEN_PGF_TIKZ_MANUAL).toBe("help.open-pgf-tikz-manual");
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

  it("places Open Example directly below Open in the File menu", () => {
    const fileSection = APP_MENU_DEFINITION.find((section) => section.id === "file");
    expect(fileSection).toBeDefined();
    const items = fileSection?.items ?? [];
    const openIndex = items.findIndex(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.OPEN_DOCUMENT
    );
    const openExampleIndex = items.findIndex(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.OPEN_EXAMPLE
    );

    expect(openIndex).toBeGreaterThanOrEqual(0);
    expect(openExampleIndex).toBe(openIndex + 1);
  });

  it("exposes PowerPoint and SVG import commands in the File > Import submenu", () => {
    const fileSection = APP_MENU_DEFINITION.find((section) => section.id === "file");
    expect(fileSection).toBeDefined();
    const items = fileSection?.items ?? [];
    const importMenu = items.find(
      (item) => item.kind === "submenu" && item.label === "Import"
    );
    expect(importMenu).toBeDefined();
    if (!importMenu || importMenu.kind !== "submenu") {
      throw new Error("Expected Import submenu in File menu.");
    }

    const powerpointItem = importMenu.items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.IMPORT_POWERPOINT
    );
    const svgItem = importMenu.items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.IMPORT_SVG
    );
    expect(powerpointItem).toBeDefined();
    expect(svgItem).toBeDefined();
    if (
      !powerpointItem ||
      powerpointItem.kind !== "command" ||
      !svgItem ||
      svgItem.kind !== "command"
    ) {
      throw new Error("Expected file.import-powerpoint and file.import-svg commands in File > Import.");
    }
    expect(powerpointItem.label).toBe("PowerPoint (.pptx)");
    expect(svgItem.label).toBe("SVG...");
  });

  it("groups Import submenu directly above Export in the File menu", () => {
    const fileSection = APP_MENU_DEFINITION.find((section) => section.id === "file");
    expect(fileSection).toBeDefined();
    const items = fileSection?.items ?? [];
    const importIndex = items.findIndex((item) => item.kind === "submenu" && item.label === "Import");
    const exportIndex = items.findIndex((item) => item.kind === "submenu" && item.label === "Export");

    expect(importIndex).toBeGreaterThanOrEqual(0);
    expect(exportIndex).toBe(importIndex + 1);
  });

  it("exposes Export SVG, Standalone LaTeX, PDF, and PNG in the File > Export submenu", () => {
    const fileSection = APP_MENU_DEFINITION.find((section) => section.id === "file");
    expect(fileSection).toBeDefined();
    const items = fileSection?.items ?? [];
    const exportMenu = items.find(
      (item) => item.kind === "submenu" && item.label === "Export"
    );
    expect(exportMenu).toBeDefined();
    if (!exportMenu || exportMenu.kind !== "submenu") {
      throw new Error("Expected Export submenu in File menu.");
    }

    const svgItem = exportMenu.items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD
    );
    const pdfItem = exportMenu.items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.EXPORT_PDF_DOWNLOAD
    );
    const pngItem = exportMenu.items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.EXPORT_PNG_DOWNLOAD
    );
    const standaloneLatexItem = exportMenu.items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.EXPORT_STANDALONE_LATEX_DOWNLOAD
    );

    expect(svgItem).toBeDefined();
    expect(standaloneLatexItem).toBeDefined();
    expect(pdfItem).toBeDefined();
    expect(pngItem).toBeDefined();
    if (
      !svgItem ||
      svgItem.kind !== "command" ||
      !standaloneLatexItem ||
      standaloneLatexItem.kind !== "command" ||
      !pdfItem ||
      pdfItem.kind !== "command" ||
      !pngItem ||
      pngItem.kind !== "command"
    ) {
      throw new Error("Expected SVG, Standalone LaTeX, PDF, and PNG export commands in File > Export.");
    }
    expect(svgItem.label).toBe("SVG");
    expect(standaloneLatexItem.label).toBe("Standalone LaTeX");
    expect(pdfItem.label).toBe("PDF");
    expect(pngItem.label).toBe("PNG");
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
    expect(commandItem.label).toBe("Copy as SVG");
  });

  it("exposes a Snapping submenu in the View menu", () => {
    const viewSection = APP_MENU_DEFINITION.find((section) => section.id === "view");
    expect(viewSection).toBeDefined();
    const items = viewSection?.items ?? [];
    const snappingMenu = items.find(
      (item) => item.kind === "submenu" && item.label === "Snapping"
    );
    expect(snappingMenu).toBeDefined();
    if (!snappingMenu || snappingMenu.kind !== "submenu") {
      throw new Error("Expected Snapping submenu in View menu.");
    }

    const snapGrid = snappingMenu.items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GRID
    );
    const snapGuides = snappingMenu.items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GUIDES
    );
    const snapPoints = snappingMenu.items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_POINTS
    );
    const snapGaps = snappingMenu.items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_GAPS
    );

    expect(snapGrid).toBeDefined();
    expect(snapGuides).toBeDefined();
    expect(snapPoints).toBeDefined();
    expect(snapGaps).toBeDefined();
  });

  it("exposes transparency and document bounds toggles in the View menu", () => {
    const viewSection = APP_MENU_DEFINITION.find((section) => section.id === "view");
    expect(viewSection).toBeDefined();
    const items = viewSection?.items ?? [];
    const transparency = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.TOGGLE_TRANSPARENCY_GRID
    );
    const infiniteCanvas = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.TOGGLE_INFINITE_CANVAS
    );

    expect(transparency).toBeDefined();
    expect(infiniteCanvas).toBeDefined();
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

  it("exposes Path in the Insert menu", () => {
    const insertSection = APP_MENU_DEFINITION.find((section) => section.id === "insert");
    expect(insertSection).toBeDefined();
    const items = insertSection?.items ?? [];
    const commandItem = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.INSERT_PATH
    );
    expect(commandItem).toBeDefined();
    if (!commandItem || commandItem.kind !== "command") {
      throw new Error("Expected insert.path command item in Insert menu.");
    }
    expect(commandItem.label).toBe("Path");
    expect((commandItem as any).accelerator).toBe("P");
  });

  it("exposes Equation in the Insert menu", () => {
    const insertSection = APP_MENU_DEFINITION.find((section) => section.id === "insert");
    expect(insertSection).toBeDefined();
    const items = insertSection?.items ?? [];
    const commandItem = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.INSERT_EQUATION
    );
    expect(commandItem).toBeDefined();
    if (!commandItem || commandItem.kind !== "command") {
      throw new Error("Expected insert.equation command item in Insert menu.");
    }
    expect(commandItem.label).toBe("Equation");
    expect((commandItem as any).accelerator).toBe("CmdOrCtrl+Shift+E");
  });

  it("exposes Freehand in the Insert menu", () => {
    const insertSection = APP_MENU_DEFINITION.find((section) => section.id === "insert");
    expect(insertSection).toBeDefined();
    const items = insertSection?.items ?? [];
    const commandItem = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.INSERT_FREEHAND
    );
    expect(commandItem).toBeDefined();
    if (!commandItem || commandItem.kind !== "command") {
      throw new Error("Expected insert.freehand command item in Insert menu.");
    }
    expect(commandItem.label).toBe("Freehand");
    expect((commandItem as any).accelerator).toBe("F");
  });

  it("exposes Grid in the Insert menu without an accelerator", () => {
    const insertSection = APP_MENU_DEFINITION.find((section) => section.id === "insert");
    expect(insertSection).toBeDefined();
    const items = insertSection?.items ?? [];
    const commandItem = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.INSERT_GRID
    );
    expect(commandItem).toBeDefined();
    if (!commandItem || commandItem.kind !== "command") {
      throw new Error("Expected insert.grid command item in Insert menu.");
    }
    expect(commandItem.label).toBe("Grid");
    expect((commandItem as any).accelerator).toBeUndefined();
  });

  it("exposes Format TikZ Code in the Edit menu", () => {
    const editSection = APP_MENU_DEFINITION.find((section) => section.id === "edit");
    expect(editSection).toBeDefined();
    const items = editSection?.items ?? [];
    const commandItem = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.FORMAT_TIKZ
    );
    expect(commandItem).toBeDefined();
    if (!commandItem || commandItem.kind !== "command") {
      throw new Error("Expected edit.format-tikz command item in Edit menu.");
    }
    expect(commandItem.label).toBe("Format TikZ Code");
  });

  it("places Group/Ungroup below Duplicate with a divider and keeps Format TikZ separated", () => {
    const editSection = APP_MENU_DEFINITION.find((section) => section.id === "edit");
    expect(editSection).toBeDefined();
    const items = editSection?.items ?? [];

    const duplicateIndex = items.findIndex(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.DUPLICATE
    );
    const groupIndex = items.findIndex(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.GROUP
    );
    const ungroupIndex = items.findIndex(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.UNGROUP
    );
    const formatIndex = items.findIndex(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.FORMAT_TIKZ
    );

    expect(duplicateIndex).toBeGreaterThanOrEqual(0);
    expect(items[duplicateIndex + 1]?.kind).toBe("separator");
    expect(groupIndex).toBe(duplicateIndex + 2);
    expect(ungroupIndex).toBe(groupIndex + 1);
    expect(items[ungroupIndex + 1]?.kind).toBe("separator");
    expect(formatIndex).toBe(ungroupIndex + 2);
    expect(items[formatIndex + 1]?.kind).toBe("separator");

    const groupItem = items[groupIndex];
    const ungroupItem = items[ungroupIndex];
    if (!groupItem || groupItem.kind !== "command" || !ungroupItem || ungroupItem.kind !== "command") {
      throw new Error("Expected Group and Ungroup command items in Edit menu.");
    }
    expect(groupItem.accelerator).toBe("CmdOrCtrl+G");
    expect(ungroupItem.accelerator).toBe("CmdOrCtrl+Shift+G");
  });

  it("groups Transform with Align, Distribute, and Reorder in the Edit menu", () => {
    const editSection = APP_MENU_DEFINITION.find((section) => section.id === "edit");
    expect(editSection).toBeDefined();
    const items = editSection?.items ?? [];
    const submenuLabels = items.flatMap((item) => (item.kind === "submenu" ? [item.label] : []));

    expect(submenuLabels).toEqual(["Align", "Transform", "Distribute", "Reorder"]);
    expect(items[items.length - 5]).toEqual({ kind: "separator" });
    expect(items.slice(-4).every((item) => item.kind === "submenu")).toBe(true);
  });

  it("exposes Zoom In/Out directly below Fit to Content in the View menu", () => {
    const viewSection = APP_MENU_DEFINITION.find((section) => section.id === "view");
    expect(viewSection).toBeDefined();
    const items = viewSection?.items ?? [];

    const fitIndex = items.findIndex(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.FIT_TO_CONTENT
    );
    const zoomInIndex = items.findIndex(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.ZOOM_IN
    );
    const zoomOutIndex = items.findIndex(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.ZOOM_OUT
    );

    expect(fitIndex).toBeGreaterThanOrEqual(0);
    expect(zoomInIndex).toBe(fitIndex + 1);
    expect(zoomOutIndex).toBe(zoomInIndex + 1);

    const zoomInItem = items[zoomInIndex];
    const zoomOutItem = items[zoomOutIndex];
    if (!zoomInItem || zoomInItem.kind !== "command" || !zoomOutItem || zoomOutItem.kind !== "command") {
      throw new Error("Expected zoom command items in View menu.");
    }
    expect("accelerator" in zoomInItem ? zoomInItem.accelerator : undefined).toBe("CmdOrCtrl+=");
    expect("accelerator" in zoomOutItem ? zoomOutItem.accelerator : undefined).toBe("CmdOrCtrl+-");
  });

  it("assigns CmdOrCtrl+0 accelerator to Fit to Content", () => {
    const viewSection = APP_MENU_DEFINITION.find((section) => section.id === "view");
    expect(viewSection).toBeDefined();
    const fitItem = (viewSection?.items ?? []).find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.FIT_TO_CONTENT
    );
    expect(fitItem).toBeDefined();
    if (!fitItem || fitItem.kind !== "command") {
      throw new Error("Expected fit-to-content command item in View menu.");
    }
    expect("accelerator" in fitItem ? fitItem.accelerator : undefined).toBe("CmdOrCtrl+0");
  });

  it("exposes Settings with CmdOrCtrl+, in the File menu", () => {
    const fileSection = APP_MENU_DEFINITION.find((section) => section.id === "file");
    expect(fileSection).toBeDefined();
    const settingsItem = (fileSection?.items ?? []).find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.OPEN_SETTINGS
    );
    expect(settingsItem).toBeDefined();
    if (!settingsItem || settingsItem.kind !== "command") {
      throw new Error("Expected open settings command item in File menu.");
    }
    expect("accelerator" in settingsItem ? settingsItem.accelerator : undefined).toBe("CmdOrCtrl+,");
  });

  it("exposes path editing actions in a dedicated Path menu", () => {
    const pathSection = APP_MENU_DEFINITION.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    const commandIds = (pathSection?.items ?? []).flatMap((item) => (item.kind === "command" ? [item.commandId] : []));
    expect(commandIds).toEqual([
      APP_MENU_COMMAND_IDS.PATH_SPLIT,
      APP_MENU_COMMAND_IDS.PATH_JOIN,
      APP_MENU_COMMAND_IDS.PATH_REVERSE,
      APP_MENU_COMMAND_IDS.PATH_CLOSE,
      APP_MENU_COMMAND_IDS.PATH_OPEN,
      APP_MENU_COMMAND_IDS.PATH_DELETE_POINT,
      APP_MENU_COMMAND_IDS.PATH_POINT_CORNER,
      APP_MENU_COMMAND_IDS.PATH_POINT_SMOOTH
    ]);
  });

  it("exposes Open PGF/TikZ Manual in the Help menu", () => {
    const helpSection = APP_MENU_DEFINITION.find((section) => section.id === "help");
    expect(helpSection).toBeDefined();
    const items = helpSection?.items ?? [];
    const commandItem = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.OPEN_PGF_TIKZ_MANUAL
    );
    expect(commandItem).toBeDefined();
    if (!commandItem || commandItem.kind !== "command") {
      throw new Error("Expected help.open-pgf-tikz-manual command item in Help menu.");
    }
    expect(commandItem.label).toBe("Open PGF/TikZ Manual");
  });
});
