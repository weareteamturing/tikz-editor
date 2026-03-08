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
  let menuHandler: ((commandId: string) => void) | null = null;
  let recentHandler: ((path: string) => void) | null = null;
  return {
    saved,
    emitMenu(commandId: string) {
      menuHandler?.(commandId);
    },
    emitRecent(path: string) {
      recentHandler?.(path);
    },
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
      onMenuCommand: async (handler: (commandId: string) => void) => {
        menuHandler = handler;
        return () => {
          if (menuHandler === handler) {
            menuHandler = null;
          }
        };
      },
      onOpenRecent: async (handler: (path: string) => void) => {
        recentHandler = handler;
        return () => {
          if (recentHandler === handler) {
            recentHandler = null;
          }
        };
      }
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
    mock.emitMenu(APP_MENU_COMMAND_IDS.UNDO);
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
    expect(saved?.ok).toBe(true);
    expect(mock.saved).toContain("hello");
    expect(saved?.fileRef?.provider).toBe("desktop-fs");
  });

  it("handles native Open Recent events as open requests", async () => {
    const mock = makeMockBridge();
    const platform = createDesktopPlatformAdapter({
      storage: { getItem: () => null, setItem: () => undefined },
      bridge: mock.bridge
    });

    let seenSource = "";
    const unbind = platform.files?.bindOpenRequest?.((opened) => {
      seenSource = opened.source;
    });
    mock.emitRecent("/tmp/diagram.tex");
    await Promise.resolve();
    await Promise.resolve();
    expect(seenSource).toContain("\\draw");
    if (typeof unbind === "function") {
      unbind();
    }
  });
});
