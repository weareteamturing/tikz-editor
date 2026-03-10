import { describe, expect, it } from "vitest";
import { APP_MENU_COMMAND_IDS } from "@tikz-editor/app";
import { createDesktopPlatformAdapter } from "../src/platform/desktop-platform";

function makeMockBridge() {
  const opened = {
    source: "\\draw (0,0)--(1,1);",
    path: "/tmp/diagram.tex",
    name: "diagram.tex"
  };
  const saved: string[] = [];
  const contextMenuPayloads: unknown[] = [];
  let contextMenuCommandHandler: ((payload: { requestId: string; commandId: string }) => void) | null = null;
  return {
    saved,
    contextMenuPayloads,
    bridge: {
      openText: async (path?: string | null) => {
        if (path && path !== opened.path) {
          return null;
        }
        return opened;
      },
      saveText: async (params: { text: string; suggestedName?: string; path?: string | null; forceSaveAs: boolean }) => {
        saved.push(params.text);
        return {
          ok: true,
          path: params.path ?? "/tmp/new-diagram.tex",
          name: params.path ? "diagram.tex" : (params.suggestedName ?? "new-diagram.tex")
        };
      },
      exportFile: async () => true,
      readClipboard: async () => "mock-clipboard",
      writeClipboard: async () => undefined,
      readCustomClipboardText: async () => null,
      writeClipboardBundle: async () => undefined,
      setWindowTitle: async () => undefined,
      closeWindow: async () => undefined,
      openExternalUrl: async () => true,
      listRecentFiles: async () => [opened.path],
      onWindowCloseRequest: async () => () => undefined,
      showContextMenu: async (payload) => {
        contextMenuPayloads.push(payload);
      },
      onContextMenuCommand: async (handler) => {
        contextMenuCommandHandler = handler;
        return () => {
          if (contextMenuCommandHandler === handler) {
            contextMenuCommandHandler = null;
          }
        };
      },
      assistantEnsureDocumentThread: async ({ documentId }) => ({
        threadId: `thr-${documentId}`,
        workspacePath: `/tmp/${documentId}`,
        figurePath: `/tmp/${documentId}/figure.tex`,
        previewPath: `/tmp/${documentId}/current.png`
      }),
      assistantStartTurn: async () => ({ turnId: "turn-123" }),
      assistantInterruptTurn: async () => undefined,
      assistantSyncSource: async () => undefined,
      assistantRespondToApproval: async () => undefined,
      assistantRespondToDynamicToolCall: async () => undefined,
      assistantLoadThreadState: async ({ documentId }) => ({
        threadId: `thr-${documentId}`,
        workspacePath: `/tmp/${documentId}`,
        figurePath: `/tmp/${documentId}/figure.tex`,
        previewPath: `/tmp/${documentId}/current.png`,
        items: [{ type: "agentMessage", id: "item-1", text: "hello" }]
      }),
      onAssistantEvent: async (handler) => {
        handler({ type: "error", documentId: "doc-1", message: "mock-event" });
        return () => undefined;
      }
    },
    emitContextMenuCommand: (payload: { requestId: string; commandId: string }) => {
      contextMenuCommandHandler?.(payload);
    }
  };
}

describe("desktop shell flows", () => {
  it("bridges native menu command events to app commands", async () => {
    const mock = makeMockBridge();
    const platform = createDesktopPlatformAdapter({
      storage: { getItem: () => null, setItem: () => undefined },
      bridge: mock.bridge
    });

    let received: string | null = null;
    platform.menu?.bindCommandHandler?.((commandId) => {
      received = commandId;
    });
    platform.menu?.dispatchCommand?.(APP_MENU_COMMAND_IDS.UNDO, "platform");
    await Promise.resolve();
    expect(received).toBe(APP_MENU_COMMAND_IDS.UNDO);
  });

  it("reports native context menu support on desktop", () => {
    const mock = makeMockBridge();
    const platform = createDesktopPlatformAdapter({
      storage: { getItem: () => null, setItem: () => undefined },
      bridge: mock.bridge
    });

    expect(platform.menu?.usesNativeContextMenus).toBe(true);
  });

  it("exposes a native canvas context menu hook on desktop", () => {
    const mock = makeMockBridge();
    const platform = createDesktopPlatformAdapter({
      storage: { getItem: () => null, setItem: () => undefined },
      bridge: mock.bridge
    });

    expect(typeof platform.menu?.showNativeContextMenu).toBe("function");
  });

  it("serializes context menu payloads through the bridge", async () => {
    const mock = makeMockBridge();
    const platform = createDesktopPlatformAdapter({
      storage: { getItem: () => null, setItem: () => undefined },
      bridge: mock.bridge
    });

    await platform.menu?.showNativeContextMenu?.({
      items: [
        { kind: "command", commandId: APP_MENU_COMMAND_IDS.UNDO, label: "Undo", accelerator: "CmdOrCtrl+Z" },
        { kind: "separator" },
        { kind: "submenu", label: "View", items: [{ kind: "command", commandId: APP_MENU_COMMAND_IDS.TOGGLE_GRID, label: "Grid" }] }
      ],
      commandStates: {
        [APP_MENU_COMMAND_IDS.UNDO]: { enabled: true },
        [APP_MENU_COMMAND_IDS.TOGGLE_GRID]: { enabled: true, checked: true }
      } as Record<string, { enabled: boolean; checked?: boolean }>
    });

    expect(mock.contextMenuPayloads).toHaveLength(1);
    expect(mock.contextMenuPayloads[0]).toEqual(expect.objectContaining({
      items: [
        expect.objectContaining({ kind: "command", commandId: APP_MENU_COMMAND_IDS.UNDO, enabled: true }),
        { kind: "separator" },
        expect.objectContaining({
          kind: "submenu",
          label: "View",
          items: [expect.objectContaining({ commandId: APP_MENU_COMMAND_IDS.TOGGLE_GRID, checked: true })]
        })
      ]
    }));
  });

  it("routes rust-owned context menu command events to app commands", async () => {
    const mock = makeMockBridge();
    const platform = createDesktopPlatformAdapter({
      storage: { getItem: () => null, setItem: () => undefined },
      bridge: mock.bridge
    });

    let received: { commandId: string; origin: string } | null = null;
    platform.menu?.bindCommandHandler?.((commandId, origin) => {
      received = { commandId, origin };
    });

    mock.emitContextMenuCommand({
      requestId: "ctx-123",
      commandId: APP_MENU_COMMAND_IDS.UNDO
    });

    await Promise.resolve();
    expect(received).toEqual({
      commandId: APP_MENU_COMMAND_IDS.UNDO,
      origin: "context-menu"
    });
  });

  it("opens and saves with desktop-backed file refs", async () => {
    const mock = makeMockBridge();
    const platform = createDesktopPlatformAdapter({
      storage: { getItem: () => null, setItem: () => undefined },
      bridge: mock.bridge
    });

    const opened = await platform.files?.openText?.();
    expect(opened?.fileRef).toMatchObject({
      kind: "file",
      provider: "desktop-fs",
      path: "/tmp/diagram.tex",
      name: "diagram.tex"
    });
    const saved = await platform.files?.saveText?.("hello", {
      mode: "save",
      fileRef: opened?.fileRef ?? null,
      suggestedName: "diagram.tex"
    });
    expect(saved?.status).toBe("saved");
    expect(mock.saved).toContain("hello");
    expect(saved?.fileRef?.provider).toBe("desktop-fs");
  });

  it("handles bridge open requests", async () => {
    const mock = makeMockBridge();
    const platform = createDesktopPlatformAdapter({
      storage: { getItem: () => null, setItem: () => undefined },
      bridge: mock.bridge
    });

    let seenSource = "";
    const unbind = platform.files?.bindOpenRequest?.((openedRequest) => {
      seenSource = openedRequest.source;
    });
    (
      globalThis as typeof globalThis & {
        __TIKZ_EDITOR_DESKTOP_TEST_API__?: {
          triggerOpenRequest: (opened: { source: string; path: string; name: string }) => void;
        };
      }
    ).__TIKZ_EDITOR_DESKTOP_TEST_API__?.triggerOpenRequest({
      source: "\\draw (0,0)--(1,1);",
      path: "/tmp/diagram.tex",
      name: "diagram.tex"
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(seenSource).toContain("\\draw");
    if (typeof unbind === "function") {
      unbind();
    }
  });

  it("exposes assistant bridge methods", async () => {
    const mock = makeMockBridge();
    const platform = createDesktopPlatformAdapter({
      storage: { getItem: () => null, setItem: () => undefined },
      bridge: mock.bridge
    });

    const summary = await platform.assistant?.ensureDocumentThread?.({
      documentId: "doc-1",
      source: "\\draw (0,0)--(1,1);"
    });
    expect(summary?.threadId).toBe("thr-doc-1");

    const turn = await platform.assistant?.startTurn?.({
      documentId: "doc-1",
      prompt: "help",
      source: "\\draw (0,0)--(1,1);",
      pngBase64: null
    });
    expect(turn?.turnId).toBe("turn-123");

    const state = await platform.assistant?.loadThreadState?.({ documentId: "doc-1" });
    expect(state?.items).toHaveLength(1);

    let seenMessage = "";
    const unbind = platform.assistant?.bindEvents?.((event) => {
      if (event.type === "error") {
        seenMessage = event.message;
      }
    });
    await Promise.resolve();
    expect(seenMessage).toBe("mock-event");
    if (typeof unbind === "function") {
      unbind();
    }
  });
});
