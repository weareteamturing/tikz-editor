import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_MENU_COMMAND_IDS } from "../../packages/app/src/app-menu/index.js";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";
import { createEditorCommandRuntime } from "../../packages/app/src/ui/editor-command-runtime.js";
import type { EditorAction } from "../../packages/app/src/store/types.js";
import { setActiveEditorPlatform } from "../../packages/app/src/platform/current.js";

const svgToTikzMock = vi.hoisted(() => vi.fn<(source: string) => string>());

vi.mock("svg2tikz", () => ({
  svgToTikz: svgToTikzMock
}));

const SOURCE = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

describe("editor-command-runtime", () => {
  afterEach(() => {
    svgToTikzMock.mockReset();
    setActiveEditorPlatform({
      id: "test-platform",
      persistence: {
        load: () => null,
        save: () => undefined
      }
    });
  });

  it("computes enabled and checked states for menu commands", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(["path:0"]),
        historyIndex: 0,
        historyLength: 2,
        showGrid: true
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.UNDO].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.REDO].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PASTE].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_GRID].checked).toBe(true);
  });

  it("runs commands through one shared entrypoint for menu and shortcut origins", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(["path:0"]),
        historyIndex: 0,
        historyLength: 1
      })
    );

    const ranMenu = runtime.runCommand(APP_MENU_COMMAND_IDS.UNDO, "menu");
    const ranShortcut = runtime.runCommand(APP_MENU_COMMAND_IDS.UNDO, "shortcut");

    expect(ranMenu).toBe(true);
    expect(ranShortcut).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "UNDO" });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "UNDO" });
  });

  it("disables commands when prerequisites are missing", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: -1,
        historyLength: 0
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.UNDO].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.COPY].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PASTE].enabled).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.UNDO, "shortcut")).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("routes the insert path command to addPath tool mode", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: -1,
        historyLength: 0
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.INSERT_PATH, "menu");

    expect(ran).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_TOOL_MODE", mode: "addPath" });
  });

  it("routes the insert freehand command to addFreehand tool mode", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: -1,
        historyLength: 0
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.INSERT_FREEHAND, "menu");

    expect(ran).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_TOOL_MODE", mode: "addFreehand" });
  });

  it("routes open example command to host callback", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenExample = vi.fn();
    const rendered = renderTikzToSvg(SOURCE);

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: -1,
        historyLength: 0,
        onOpenExample
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.OPEN_EXAMPLE, "menu");

    expect(ran).toBe(true);
    expect(onOpenExample).toHaveBeenCalledTimes(1);
  });

  it("enables SVG, PDF, and PNG export commands when SVG output is available", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenSvgExport = vi.fn();
    const onOpenPngExport = vi.fn();
    const rendered = renderTikzToSvg(SOURCE);

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: 0,
        historyLength: 1,
        onOpenSvgExport,
        onOpenPngExport
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.EXPORT_STANDALONE_LATEX_DOWNLOAD].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.EXPORT_PDF_DOWNLOAD].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.EXPORT_PNG_DOWNLOAD].enabled).toBe(true);
  });

  it("routes SVG export through the host callback", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenSvgExport = vi.fn();
    const rendered = renderTikzToSvg(SOURCE);

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: 0,
        historyLength: 1,
        onOpenSvgExport
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD, "menu");

    expect(ran).toBe(true);
    expect(onOpenSvgExport).toHaveBeenCalledTimes(1);
    expect(onOpenSvgExport).toHaveBeenCalledWith(rendered.svg);
  });

  it("shows a warning when menu paste cannot read system clipboard", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    vi.stubGlobal("navigator", {
      clipboard: {
        read: vi.fn().mockRejectedValue(new Error("blocked"))
      }
    });
    const alert = vi.fn();
    vi.stubGlobal("alert", alert);
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: 0,
        historyLength: 1
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.PASTE, "menu");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ran).toBe(true);
    expect(alert).toHaveBeenCalledWith("Clipboard access was blocked. Focus the canvas and press Cmd/Ctrl+V to paste.");
  });

  it("routes import svg command through svg conversion and opens a new document", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    svgToTikzMock.mockReturnValue(String.raw`\begin{tikzpicture}
  \draw (4,4)--(5,5);
\end{tikzpicture}`);
    setActiveEditorPlatform({
      id: "test-platform",
      persistence: {
        load: () => null,
        save: () => undefined
      },
      files: {
        openText: async () => ({
          source: `<svg xmlns="http://www.w3.org/2000/svg"></svg>`,
          fileRef: { kind: "file", name: "shape.svg" }
        })
      }
    });

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: 0,
        historyLength: 1
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.IMPORT_SVG, "menu");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ran).toBe(true);
    expect(svgToTikzMock).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "NEW_DOCUMENT",
      source: String.raw`\begin{tikzpicture}
  \draw (4,4)--(5,5);
\end{tikzpicture}`,
      title: "shape.tex"
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "MARK_DOCUMENT_SAVED",
      fileRef: { kind: "virtual", name: "shape.tex" }
    });
  });

  it("keeps non-svg open path unchanged", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    setActiveEditorPlatform({
      id: "test-platform",
      persistence: {
        load: () => null,
        save: () => undefined
      },
      files: {
        openText: async () => ({
          source: "\\draw (9,9)--(10,10);",
          fileRef: { kind: "file", name: "opened.tex", provider: "download" }
        })
      }
    });

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: 0,
        historyLength: 1
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.OPEN_DOCUMENT, "menu");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ran).toBe(true);
    expect(svgToTikzMock).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "NEW_DOCUMENT",
      source: "\\draw (9,9)--(10,10);",
      title: "opened.tex"
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "MARK_DOCUMENT_SAVED",
      fileRef: { kind: "file", name: "opened.tex", provider: "download" }
    });
  });
});

function makeSnapshot(rendered: ReturnType<typeof renderTikzToSvg>) {
  return {
    source: SOURCE,
    revision: 1,
    editHandles: rendered.semantic.editHandles,
    scene: rendered.semantic.scene,
    svg: rendered.svg,
    svgModel: rendered.svg.model,
    parseResult: rendered.parse,
    semanticResult: rendered.semantic,
    incremental: null
  };
}

function makeInput({
  dispatch,
  snapshot,
  selectedElementIds,
  historyIndex,
  historyLength,
  showGrid = false,
  snapToGrid = true,
  showRulers = true,
  showGuides = true,
  showSourcePanel = true,
  showInspectorPanel = true,
  showDevPanel = false,
  onOpenExample,
  onOpenSvgExport,
  onOpenPngExport
}: {
  dispatch: (action: EditorAction) => void;
  snapshot: ReturnType<typeof makeSnapshot>;
  selectedElementIds: ReadonlySet<string>;
  historyIndex: number;
  historyLength: number;
  showGrid?: boolean;
  snapToGrid?: boolean;
  showRulers?: boolean;
  showGuides?: boolean;
  showSourcePanel?: boolean;
  showInspectorPanel?: boolean;
  showDevPanel?: boolean;
  onOpenExample?: () => void;
  onOpenSvgExport?: (svgResult: ReturnType<typeof renderTikzToSvg>["svg"]) => void;
  onOpenPngExport?: () => void;
}) {
  return {
    source: SOURCE,
    snapshot,
    toolMode: "select" as const,
    selectedElementIds,
    historyIndex,
    historyLength,
    activeDocumentId: "doc-1",
    tabCount: 1,
    dirty: false,
    fileRef: null,
    rightSidebarTab: "inspector" as const,
    assistantAvailable: true,
    assistantRunning: false,
    showGrid,
    snapToGrid,
    showRulers,
    showGuides,
    showSourcePanel,
    showInspectorPanel,
    showDevPanel,
    dispatch,
    onOpenExample,
    onOpenSvgExport,
    onOpenPngExport
  };
}
