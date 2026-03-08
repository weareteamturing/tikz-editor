import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alignSelection,
  copySelection,
  copySelectionToClipboardData,
  cutSelection,
  cutSelectionToClipboardData,
  deleteSelection,
  distributeSelection,
  isCodeMirrorEventTarget,
  pasteSelectionFromClipboardData,
  pasteSelectionFromSystemClipboard
} from "../apps/web/src/ui/editor-commands.js";
import { PT_PER_CM } from "../packages/core/src/edit/format.js";
import {
  SVG_CLIPBOARD_MIME,
  PLAIN_TEXT_CLIPBOARD_MIME,
  TIKZ_CLIPBOARD_MIME
} from "../apps/web/src/ui/editor-clipboard.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import type { EditorAction } from "../apps/web/src/store/types.js";

const SOURCE = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

describe("editor-commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("copySelection writes custom + plain payloads to the system clipboard", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    class ClipboardItemMock {
      constructor(public data: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    vi.stubGlobal("navigator", { clipboard: { write } });
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
    expect(dispatch).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    const writtenItems = write.mock.calls[0]?.[0] as ClipboardItemMock[];
    expect(Array.isArray(writtenItems)).toBe(true);
    expect(writtenItems[0]?.data[TIKZ_CLIPBOARD_MIME]).toBeInstanceOf(Blob);
    expect(writtenItems[0]?.data[PLAIN_TEXT_CLIPBOARD_MIME]).toBeInstanceOf(Blob);
    expect(writtenItems[0]?.data[SVG_CLIPBOARD_MIME]).toBeInstanceOf(Blob);
  });

  it("copySelection falls back to writeText when multi-format write is unavailable", async () => {
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
    expect(writeText).toHaveBeenCalledWith("\\draw (0,0) -- (1,0);\n\\draw (0,1) -- (1,1);");
  });

  it("copySelection retries clipboard write without SVG when SVG MIME is rejected", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("svg unsupported"))
      .mockResolvedValueOnce(undefined);
    class ClipboardItemMock {
      constructor(public data: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    vi.stubGlobal("navigator", { clipboard: { write } });
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
    expect(write).toHaveBeenCalledTimes(2);
    const firstItems = write.mock.calls[0]?.[0] as ClipboardItemMock[];
    const secondItems = write.mock.calls[1]?.[0] as ClipboardItemMock[];
    expect(firstItems[0]?.data[SVG_CLIPBOARD_MIME]).toBeInstanceOf(Blob);
    expect(secondItems[0]?.data[SVG_CLIPBOARD_MIME]).toBeUndefined();
    expect(secondItems[0]?.data[TIKZ_CLIPBOARD_MIME]).toBeInstanceOf(Blob);
    expect(secondItems[0]?.data[PLAIN_TEXT_CLIPBOARD_MIME]).toBeInstanceOf(Blob);
  });

  it("copySelectionToClipboardData writes custom and text payloads without navigator permission flow", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (mime: string, value: string) => {
        data.set(mime, value);
      }
    } as unknown as DataTransfer;

    const didCopy = copySelectionToClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:1", "path:0"]),
      dispatch
    }, dataTransfer);

    expect(didCopy).toBe(true);
    expect(data.get(TIKZ_CLIPBOARD_MIME)).toBeTypeOf("string");
    expect(data.get(PLAIN_TEXT_CLIPBOARD_MIME)).toBe("\\draw (0,0) -- (1,0);\n\\draw (0,1) -- (1,1);");
  });

  it("cutSelectionToClipboardData copies and deletes selection", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const dataTransfer = {
      setData: vi.fn()
    } as unknown as DataTransfer;

    const didCut = cutSelectionToClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0"]),
      dispatch
    }, dataTransfer);

    expect(didCut).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "deleteElement",
        elementId: "path:0"
      }
    });
  });

  it("pasteSelectionFromClipboardData no-ops for empty payloads", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didPaste = await pasteSelectionFromClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0"]),
      dispatch
    }, {
      getData: () => ""
    } as unknown as DataTransfer);

    expect(didPaste).toEqual({ kind: "failure", reason: "empty" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("pasteSelectionFromClipboardData preserves position for preserve payloads", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const payload = {
      version: 1,
      snippets: ["\\draw (0,0) -- (1,0);"],
      plainText: "\\draw (0,0) -- (1,0);",
      pasteBehavior: "preserve",
      pasteCount: 0
    };

    const didPaste = await pasteSelectionFromClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(),
      dispatch
    }, {
      getData: (mime: string) => mime === TIKZ_CLIPBOARD_MIME ? JSON.stringify(payload) : ""
    } as unknown as DataTransfer);

    expect(didPaste).toEqual({ kind: "success" });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: expect.objectContaining({
        kind: "pasteStatements",
        snippets: ["\\draw (0,0) -- (1,0);"],
        anchorElementId: undefined,
        delta: { x: 0, y: 0 }
      })
    }));
  });

  it("pasteSelectionFromClipboardData increases offset based on payload pasteCount", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const payload = {
      version: 1,
      snippets: ["\\draw (0,0) -- (1,0);"],
      plainText: "\\draw (0,0) -- (1,0);",
      pasteBehavior: "offset",
      pasteCount: 2
    };
    const didPaste = await pasteSelectionFromClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(),
      dispatch
    }, {
      getData: (mime: string) => mime === TIKZ_CLIPBOARD_MIME ? JSON.stringify(payload) : ""
    } as unknown as DataTransfer);

    expect(didPaste).toEqual({ kind: "success" });
    const expectedStep = 0.25 * PT_PER_CM;
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: expect.objectContaining({
        kind: "pasteStatements",
        delta: { x: expectedStep * 3, y: -expectedStep * 3 }
      })
    }));
  });

  it("pasteSelectionFromClipboardData falls back to text/plain payloads", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didPaste = await pasteSelectionFromClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(),
      dispatch
    }, {
      getData: (mime: string) => mime === PLAIN_TEXT_CLIPBOARD_MIME ? "\\draw (2,2) -- (3,3);" : ""
    } as unknown as DataTransfer);

    expect(didPaste).toEqual({ kind: "success" });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: expect.objectContaining({
        kind: "pasteStatements",
        snippets: ["\\draw (2,2) -- (3,3);"]
      })
    }));
  });

  it("pasteSelectionFromClipboardData rejects invalid custom JSON safely", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didPaste = await pasteSelectionFromClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(),
      dispatch
    }, {
      getData: (mime: string) => mime === TIKZ_CLIPBOARD_MIME ? "{bad json" : ""
    } as unknown as DataTransfer);

    expect(didPaste).toEqual({ kind: "failure", reason: "invalid" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("pasteSelectionFromSystemClipboard reads custom MIME payloads", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const payload = {
      version: 1,
      snippets: ["\\draw (4,4) -- (5,5);"],
      plainText: "\\draw (4,4) -- (5,5);",
      pasteBehavior: "offset",
      pasteCount: 0
    };
    vi.stubGlobal("navigator", {
      clipboard: {
        read: vi.fn().mockResolvedValue([
          {
            types: [TIKZ_CLIPBOARD_MIME],
            getType: async () => new Blob([JSON.stringify(payload)], { type: TIKZ_CLIPBOARD_MIME })
          }
        ])
      }
    });

    const didPaste = await pasteSelectionFromSystemClipboard({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(),
      dispatch
    });

    expect(didPaste).toEqual({ kind: "success" });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: expect.objectContaining({
        snippets: ["\\draw (4,4) -- (5,5);"]
      })
    }));
  });

  it("deleteSelection dispatches delete action and clears selection", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didDelete = deleteSelection({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0", "path:1"]),
      dispatch
    });

    expect(didDelete).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "deleteElements",
        elementIds: ["path:0", "path:1"]
      }
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "CLEAR_SELECTION" });
  });

  it("cutSelection copies then deletes the selection", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didCut = await cutSelection({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0"]),
      dispatch
    });

    expect(didCut).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "deleteElement",
        elementId: "path:0"
      }
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "CLEAR_SELECTION" });
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
