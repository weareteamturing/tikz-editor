import { describe, expect, it, vi } from "vitest";
import { APP_MENU_COMMAND_IDS } from "../../src/app-menu/index.js";
import { renderTikzToSvg } from "../../src/render/index.js";
import { createEditorCommandRuntime } from "../../web/src/ui/editor-command-runtime.js";
import type { EditorAction, InternalClipboard } from "../../web/src/store/types.js";

const SOURCE = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

describe("editor-command-runtime", () => {
  it("computes enabled and checked states for menu commands", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(["path:0"]),
        internalClipboard: {
          snippets: ["\\draw (0,0) -- (1,0);"],
          plainText: "\\draw (0,0) -- (1,0);",
          copiedAt: 1,
          pasteBehavior: "offset"
        },
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
        internalClipboard: null,
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
        internalClipboard: null,
        historyIndex: -1,
        historyLength: 0
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.UNDO].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.COPY].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PASTE].enabled).toBe(false);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.UNDO, "shortcut")).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
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
        internalClipboard: null,
        historyIndex: -1,
        historyLength: 0,
        onOpenExample
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.OPEN_EXAMPLE, "menu");

    expect(ran).toBe(true);
    expect(onOpenExample).toHaveBeenCalledTimes(1);
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
  internalClipboard,
  historyIndex,
  historyLength,
  showGrid = false,
  snapToGrid = true,
  showRulers = true,
  showGuides = true,
  showSourcePanel = true,
  showInspectorPanel = true,
  showDevPanel = false,
  onOpenExample
}: {
  dispatch: (action: EditorAction) => void;
  snapshot: ReturnType<typeof makeSnapshot>;
  selectedElementIds: ReadonlySet<string>;
  internalClipboard: InternalClipboard | null;
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
}) {
  return {
    source: SOURCE,
    snapshot,
    toolMode: "select" as const,
    selectedElementIds,
    internalClipboard,
    historyIndex,
    historyLength,
    showGrid,
    snapToGrid,
    showRulers,
    showGuides,
    showSourcePanel,
    showInspectorPanel,
    showDevPanel,
    dispatch,
    onOpenExample
  };
}
