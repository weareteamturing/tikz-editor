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
  return {
    saved,
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
      setWindowTitle: async () => undefined,
      closeWindow: async () => undefined,
      openExternalUrl: async () => true,
      listRecentFiles: async () => [opened.path],
      onWindowCloseRequest: async () => () => undefined
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
});
