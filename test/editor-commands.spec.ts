import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copySelection,
  isCodeMirrorEventTarget,
  pasteSelectionAnchor
} from "../web/src/ui/editor-commands.js";
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

    const didCopy = await copySelection({
      source: SOURCE,
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

    const didPaste = pasteSelectionAnchor({
      source: SOURCE,
      selectedElementIds: new Set(["path:0"]),
      internalClipboard: null,
      dispatch
    });

    expect(didPaste).toBe(false);
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
