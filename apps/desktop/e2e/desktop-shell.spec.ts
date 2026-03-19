import { describe, expect, it, vi } from "vitest";
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
  const assistantStartTurnPayloads: unknown[] = [];
  const pendingOpenRequests: Array<{ source: string; path: string; name: string }> = [];
  const pendingOpenFailures: Array<{ path: string; message: string }> = [];
  let snapHapticCalls = 0;
  let contextMenuCommandHandler: ((payload: { requestId: string; commandId: string }) => void) | null = null;
  let pendingOpenChangedHandler: (() => void) | null = null;
  return {
    saved,
    contextMenuPayloads,
    assistantStartTurnPayloads,
    getSnapHapticCalls: () => snapHapticCalls,
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
      readCustomClipboardBytes: async () => null,
      writeClipboardBundle: async () => undefined,
      setWindowTitle: async () => undefined,
      closeWindow: async () => undefined,
      openExternalUrl: async () => true,
      performSnapHaptic: async () => {
        snapHapticCalls += 1;
      },
      listRecentFiles: async () => [opened.path],
      onWindowCloseRequest: async () => () => undefined,
      takePendingOpenRequests: async () => pendingOpenRequests.splice(0, pendingOpenRequests.length),
      takePendingOpenFailures: async () => pendingOpenFailures.splice(0, pendingOpenFailures.length),
      onPendingOpenRequestsChanged: async (handler) => {
        pendingOpenChangedHandler = handler;
        return () => {
          if (pendingOpenChangedHandler === handler) {
            pendingOpenChangedHandler = null;
          }
        };
      },
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
      assistantStartTurn: async (params: {
        documentId: string;
        prompt: string;
        source: string;
        pngBase64?: string | null;
        pastedImages?: Array<{ base64: string; mimeType: string; fileName: string }>;
      }) => {
        assistantStartTurnPayloads.push(params);
        return { turnId: "turn-123" };
      },
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
    },
    queuePendingOpenRequest: (payload: { source: string; path: string; name: string }) => {
      pendingOpenRequests.push(payload);
      pendingOpenChangedHandler?.();
    },
    queuePendingOpenFailure: (payload: { path: string; message: string }) => {
      pendingOpenFailures.push(payload);
      pendingOpenChangedHandler?.();
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

  it("flushes pending open requests queued before bind", async () => {
    const mock = makeMockBridge();
    mock.queuePendingOpenRequest({
      source: "\\draw (0,0)--(2,2);",
      path: "/tmp/pending.tex",
      name: "pending.tex"
    });
    const platform = createDesktopPlatformAdapter({
      storage: { getItem: () => null, setItem: () => undefined },
      bridge: mock.bridge
    });

    await Promise.resolve();
    await Promise.resolve();

    let seenSource = "";
    const unbind = platform.files?.bindOpenRequest?.((openedRequest) => {
      seenSource = openedRequest.source;
    });

    await vi.waitFor(() => {
      expect(seenSource).toContain("\\draw (0,0)--(2,2);");
    });
    if (typeof unbind === "function") {
      unbind();
    }
  });

  it("opens successes and shows one aggregated failure alert", async () => {
    const mock = makeMockBridge();
    const originalAlert = (globalThis as { alert?: (message?: string) => void }).alert;
    const alertSpy = vi.fn();
    (globalThis as { alert?: (message?: string) => void }).alert = alertSpy;
    try {
      const platform = createDesktopPlatformAdapter({
        storage: { getItem: () => null, setItem: () => undefined },
        bridge: mock.bridge
      });

      const openedSources: string[] = [];
      const unbind = platform.files?.bindOpenRequest?.((openedRequest) => {
        openedSources.push(openedRequest.source);
      });

      mock.queuePendingOpenRequest({
        source: "\\draw (0,0)--(3,3);",
        path: "/tmp/good-1.tikz",
        name: "good-1.tikz"
      });
      mock.queuePendingOpenRequest({
        source: "\\draw (1,1)--(2,2);",
        path: "/tmp/good-2.tex",
        name: "good-2.tex"
      });
      mock.queuePendingOpenFailure({
        path: "/tmp/missing-1.tikz",
        message: "No such file or directory"
      });
      mock.queuePendingOpenFailure({
        path: "/tmp/missing-2.tex",
        message: "Permission denied"
      });

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      await vi.waitFor(() => {
        expect(openedSources).toEqual([
          "\\draw (0,0)--(3,3);",
          "\\draw (1,1)--(2,2);"
        ]);
      });
      await vi.waitFor(() => {
        expect(alertSpy).toHaveBeenCalledTimes(1);
      });
      expect(alertSpy.mock.calls[0]?.[0]).toContain("Some files could not be opened:");
      expect(alertSpy.mock.calls[0]?.[0]).toContain("/tmp/missing-1.tikz");
      expect(alertSpy.mock.calls[0]?.[0]).toContain("/tmp/missing-2.tex");

      await Promise.resolve();
      expect(alertSpy).toHaveBeenCalledTimes(1);

      if (typeof unbind === "function") {
        unbind();
      }
    } finally {
      (globalThis as { alert?: (message?: string) => void }).alert = originalAlert;
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
      pngBase64: null,
      pastedImages: [{ base64: "Zm9v", mimeType: "image/png", fileName: "one.png" }]
    });
    expect(turn?.turnId).toBe("turn-123");
    expect(mock.assistantStartTurnPayloads).toHaveLength(1);
    expect(mock.assistantStartTurnPayloads[0]).toEqual(expect.objectContaining({
      pastedImages: [{ base64: "Zm9v", mimeType: "image/png", fileName: "one.png" }]
    }));

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

  it("exposes haptic feedback bridge method", async () => {
    const mock = makeMockBridge();
    const platform = createDesktopPlatformAdapter({
      storage: { getItem: () => null, setItem: () => undefined },
      bridge: mock.bridge
    });

    await platform.haptics?.performSnapFeedback?.();
    expect(mock.getSnapHapticCalls()).toBe(1);
  });
});
