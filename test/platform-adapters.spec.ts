import { describe, expect, it } from "vitest";
import { APP_MENU_COMMAND_IDS, type EditorPlatform } from "../packages/app/src/index.js";
import { createBrowserPlatformAdapter } from "../apps/web/src/platform/browser-platform.js";
import { createDesktopPlatformAdapter } from "../apps/desktop/src/platform/desktop-platform.js";

function runPlatformContract(name: string, create: () => EditorPlatform) {
  describe(name, () => {
    it("round-trips persistence values", () => {
      const platform = create();
      platform.persistence.save("contract:key", "value-1");
      expect(platform.persistence.load("contract:key")).toBe("value-1");
      expect(platform.persistence.load("contract:missing")).toBeNull();
    });

    it("supports menu command hookup", () => {
      const platform = create();
      let seen: string | null = null;
      const dispose = platform.menu?.bindCommandHandler?.((commandId) => {
        seen = commandId;
      });
      platform.menu?.dispatchCommand?.(APP_MENU_COMMAND_IDS.UNDO, "platform");
      expect(seen).toBe(APP_MENU_COMMAND_IDS.UNDO);
      if (typeof dispose === "function") {
        dispose();
      }
    });
  });
}

describe("platform adapter contracts", () => {
  runPlatformContract("web adapter", () => {
    const storageMap = new Map<string, string>();
    let clipboardText = "";
    return createBrowserPlatformAdapter({
      storage: {
        getItem: (key) => storageMap.get(key) ?? null,
        setItem: (key, value) => {
          storageMap.set(key, value);
        }
      },
      clipboard: {
        readText: async () => clipboardText,
        writeText: async (text) => {
          clipboardText = text;
        }
      }
    });
  });

  runPlatformContract("desktop adapter", () => createDesktopPlatformAdapter());

  it("web adapter clipboard read/write uses provided environment", async () => {
    let clipboardText = "";
    const platform = createBrowserPlatformAdapter({
      clipboard: {
        readText: async () => clipboardText,
        writeText: async (text) => {
          clipboardText = text;
        }
      }
    });

    await platform.clipboard?.writeText?.("hello");
    const read = await platform.clipboard?.readText?.();
    expect(read).toBe("hello");
  });

  it("desktop adapter clipboard round-trips text", async () => {
    const platform = createDesktopPlatformAdapter();
    await platform.clipboard?.writeText?.("desktop-hello");
    const read = await platform.clipboard?.readText?.();
    expect(read).toBe("desktop-hello");
  });
});
