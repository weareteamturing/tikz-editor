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
        showGrid: true,
        showTransparencyGrid: false,
        showDocumentBounds: true
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.UNDO].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.REDO].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PASTE].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.ROTATE_LEFT_90].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.FLIP_HORIZONTAL].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_REVERSE].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_GRID].checked).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_TRANSPARENCY_GRID].checked).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_INFINITE_CANVAS].checked).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GRID].checked).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GUIDES].checked).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_POINTS].checked).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_GAPS].checked).toBe(true);
  });

  it("dispatches per-mode snap toggles", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        snapModes: {
          grid: false,
          guides: true,
          points: false,
          gaps: true
        }
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GRID].checked).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_POINTS].checked).toBe(false);

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_TRANSPARENCY_GRID, "menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "TOGGLE_CANVAS_AID", aid: "transparencyGrid" });
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_INFINITE_CANVAS, "menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "TOGGLE_CANVAS_AID", aid: "documentBounds" });
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GUIDES, "menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "TOGGLE_SNAP_MODE", mode: "guides" });
  });

  it("routes rotate-left through grouped transform edits", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=90] (0,0) -- (1,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set(["path:0"]),
        historyIndex: 0,
        historyLength: 1
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.ROTATE_LEFT_90, "menu");

    expect(ran).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "rotate",
        value: "180",
        clearKeys: ["/tikz/rotate"]
      }
    }));
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

  it("enables point-targeted path commands when a matching active handle is set", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const activeHandleId = rendered.semantic.editHandles.find(
      (handle) => source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to) === "(1,0)"
    )?.id ?? null;

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set(["path:0"]),
        activeHandleId
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_SPLIT].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_REVERSE].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_DELETE_POINT].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_POINT_SMOOTH].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_POINT_CORNER].enabled).toBe(false);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.PATH_SPLIT, "menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "splitPath",
        elementId: "path:0",
        handleId: activeHandleId
      }
    });
  });

  it("runs reverse path without requiring an active path point", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(["path:0"]),
        activeHandleId: null
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_REVERSE].enabled).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.PATH_REVERSE, "menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "reversePath",
        elementId: "path:0"
      }
    });
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

  it("routes the insert equation command to modal callback", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenInsertEquation = vi.fn();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        onOpenInsertEquation
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.INSERT_EQUATION, "menu");

    expect(ran).toBe(true);
    expect(onOpenInsertEquation).toHaveBeenCalledTimes(1);
  });

  it("enables edit equation only for single selected math-only node", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {$x+y$};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenEditEquation = vi.fn();
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set(["path:0"]),
        onOpenEditEquation
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.EDIT_EQUATION].enabled).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.EDIT_EQUATION, "context-menu")).toBe(true);
    expect(onOpenEditEquation).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: "path:0",
      latex: "x+y"
    }));
  });

  it("routes zoom commands to zoom requests", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
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

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.ZOOM_IN, "shortcut")).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.ZOOM_OUT, "menu")).toBe(true);
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "REQUEST_ZOOM", direction: "in" });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "REQUEST_ZOOM", direction: "out" });
  });

  it("routes open settings command to host callback", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenSettings = vi.fn();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        onOpenSettings
      })
    );

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.OPEN_SETTINGS, "shortcut")).toBe(true);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
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
    expect(ran).toBe(true);

    await vi.waitFor(() => {
      expect(svgToTikzMock).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "NEW_DOCUMENT" }));
    });

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
    expect(ran).toBe(true);

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "NEW_DOCUMENT" }));
    });

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

function makeSnapshot(rendered: ReturnType<typeof renderTikzToSvg>, source = SOURCE) {
  return {
    source,
    revision: 1,
    figures: rendered.parse.figures,
    activeFigureId: rendered.parse.activeFigureId,
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
  source = SOURCE,
  snapshot,
  selectedElementIds,
  activeHandleId = null,
  historyIndex,
  historyLength,
  showGrid = false,
  showTransparencyGrid = false,
  snapModes = { grid: true, guides: true, points: true, gaps: true },
  showRulers = true,
  showGuides = true,
  showDocumentBounds = true,
  showSourcePanel = true,
  showInspectorPanel = true,
  showDevPanel = false,
  snapHapticsEnabled = true,
  updateCanvasSettings = () => undefined,
  onOpenExample,
  onOpenSvgExport,
  onOpenPngExport,
  onOpenSettings,
  onOpenInsertEquation,
  onOpenEditEquation
}: {
  dispatch: (action: EditorAction) => void;
  source?: string;
  snapshot: ReturnType<typeof makeSnapshot>;
  selectedElementIds: ReadonlySet<string>;
  activeHandleId?: string | null;
  historyIndex?: number;
  historyLength?: number;
  showGrid?: boolean;
  showTransparencyGrid?: boolean;
  snapModes?: {
    grid: boolean;
    guides: boolean;
    points: boolean;
    gaps: boolean;
  };
  showRulers?: boolean;
  showGuides?: boolean;
  showDocumentBounds?: boolean;
  showSourcePanel?: boolean;
  showInspectorPanel?: boolean;
  showDevPanel?: boolean;
  snapHapticsEnabled?: boolean;
  updateCanvasSettings?: (patch: { snapHapticsEnabled?: boolean }) => void;
  onOpenExample?: () => void;
  onOpenSvgExport?: (svgResult: ReturnType<typeof renderTikzToSvg>["svg"]) => void;
  onOpenPngExport?: (svgResult: ReturnType<typeof renderTikzToSvg>["svg"]) => void;
  onOpenSettings?: () => void;
  onOpenInsertEquation?: () => void;
  onOpenEditEquation?: (target: any) => void;
}) {
  const activeFigureId = snapshot.parseResult?.activeFigureId ?? null;

  return {
    source,
    activeFigureId,
    editAnalysisView: null,
    snapshot,
    toolMode: "select" as const,
    selectedElementIds,
    activeHandleId,
    historyIndex: historyIndex ?? -1,
    historyLength: historyLength ?? 0,
    activeDocumentId: "doc-1",
    tabCount: 1,
    dirty: false,
    fileRef: null,
    rightSidebarTab: "inspector" as const,
    assistantAvailable: true,
    assistantRunning: false,
    showGrid,
    showTransparencyGrid,
    snapModes,
    snapHapticsEnabled,
    showRulers,
    showGuides,
    showDocumentBounds,
    showSourcePanel,
    showInspectorPanel,
    showDevPanel,
    updateCanvasSettings,
    dispatch,
    onOpenExample,
    onOpenSvgExport,
    onOpenPngExport,
    onOpenSettings,
    onOpenInsertEquation,
    onOpenEditEquation
  };
}
