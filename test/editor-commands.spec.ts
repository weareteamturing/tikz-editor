import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alignSelection,
  copySelection,
  distributeSelection,
  isCodeMirrorEventTarget,
  pasteSelectionAnchor
} from "../web/src/ui/editor-commands.js";
import { renderTikzToSvg } from "../src/render/index.js";
import type { EditorAction } from "../web/src/store/types.js";

const SOURCE = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

describe("editor-commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("copySelection stores internal clipboard and writes plain text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didCopy = await copySelection({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:1", "path:0"]),
      dispatch
    });

    expect(didCopy).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0]?.[0];
    expect(action?.type).toBe("SET_INTERNAL_CLIPBOARD");
    if (!action || action.type !== "SET_INTERNAL_CLIPBOARD" || !action.clipboard) {
      throw new Error("Expected clipboard action payload.");
    }
    expect(action.clipboard.snippets).toEqual([
      "\\draw (0,0) -- (1,0);",
      "\\draw (0,1) -- (1,1);"
    ]);
    expect(action.clipboard.copiedAt).toEqual(expect.any(Number));
    expect(writeText).toHaveBeenCalledWith(action.clipboard.plainText);
  });

  it("pasteSelectionAnchor no-ops without internal clipboard", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didPaste = pasteSelectionAnchor({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0"]),
      internalClipboard: null,
      dispatch
    });

    expect(didPaste).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("alignSelection dispatches when availability says the action is enabled", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,1) -- (3,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();

    const didAlign = alignSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0", "path:1"]),
      dispatch
    }, "left");

    expect(didAlign).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "alignElements",
        elementIds: ["path:0", "path:1"],
        mode: "left"
      }
    });
  });

  it("alignSelection does not dispatch when selection contains non-rewritable elements", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (A) at (2,0);
  \coordinate (B) at (3,0);
  \draw (0,0) -- (1,0);
  \draw (A) -- (B);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();

    const didAlign = alignSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:2", "path:3"]),
      dispatch
    }, "left");

    expect(didAlign).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("distributeSelection does not dispatch when the distribution is a no-op", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,4) -- (1,4);
  \draw (0,2) -- (1,2);
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();

    const didDistribute = distributeSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0", "path:1", "path:2"]),
      dispatch
    }, "vertical");

    expect(didDistribute).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("detects CodeMirror targets so keyboard commands can bail out", () => {
    const target = {
      closest: vi.fn((selector: string) => (selector === ".cm-editor" ? {} : null))
    };

    expect(isCodeMirrorEventTarget(target as unknown as EventTarget)).toBe(true);
    expect(isCodeMirrorEventTarget(null)).toBe(false);
  });
});
