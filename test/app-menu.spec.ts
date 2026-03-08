import { describe, expect, it } from "vitest";
import { APP_MENU_COMMAND_IDS, APP_MENU_DEFINITION } from "../packages/app/src/app-menu/index.js";

describe("app menu definition", () => {
  it("defines file lifecycle command ids", () => {
    expect(APP_MENU_COMMAND_IDS.NEW_DOCUMENT).toBe("file.new-document");
    expect(APP_MENU_COMMAND_IDS.OPEN_DOCUMENT).toBe("file.open-document");
    expect(APP_MENU_COMMAND_IDS.SAVE_DOCUMENT).toBe("file.save-document");
    expect(APP_MENU_COMMAND_IDS.SAVE_DOCUMENT_AS).toBe("file.save-document-as");
    expect(APP_MENU_COMMAND_IDS.CLOSE_DOCUMENT).toBe("file.close-document");
    expect(APP_MENU_COMMAND_IDS.CLOSE_ALL_DOCUMENTS).toBe("file.close-all-documents");
  });

  it("defines an open-example command id", () => {
    expect(APP_MENU_COMMAND_IDS.OPEN_EXAMPLE).toBe("file.open-example");
  });

  it("defines open-example-in-new-tab command id", () => {
    expect(APP_MENU_COMMAND_IDS.OPEN_EXAMPLE_IN_NEW_TAB).toBe("file.open-example-in-new-tab");
  });

  it("defines svg export command ids", () => {
    expect(APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD).toBe("file.export-svg-download");
    expect(APP_MENU_COMMAND_IDS.EXPORT_STANDALONE_LATEX_DOWNLOAD).toBe("file.export-standalone-latex-download");
    expect(APP_MENU_COMMAND_IDS.EXPORT_PDF_DOWNLOAD).toBe("file.export-pdf-download");
    expect(APP_MENU_COMMAND_IDS.EXPORT_PNG_DOWNLOAD).toBe("file.export-png-download");
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
    expect(commandItem.accelerator).toBe("P");
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
    expect(commandItem.accelerator).toBe("F");
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
    expect(commandItem.accelerator).toBeUndefined();
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

  it("places Format TikZ below Duplicate with dividers above and below", () => {
    const editSection = APP_MENU_DEFINITION.find((section) => section.id === "edit");
    expect(editSection).toBeDefined();
    const items = editSection?.items ?? [];

    const duplicateIndex = items.findIndex(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.DUPLICATE
    );
    const formatIndex = items.findIndex(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.FORMAT_TIKZ
    );

    expect(duplicateIndex).toBeGreaterThanOrEqual(0);
    expect(formatIndex).toBe(duplicateIndex + 2);
    expect(items[duplicateIndex + 1]?.kind).toBe("separator");
    expect(items[formatIndex + 1]?.kind).toBe("separator");
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
