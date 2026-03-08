import type { AppMenuCommandId, DocumentFileRef, EditorPlatform, MenuCommandHandler } from "@tikz-editor/app";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

type DesktopOpenTextResult = {
  source: string;
  path: string;
  name: string;
};

type DesktopSaveTextResult = {
  ok: boolean;
  path: string | null;
  name: string | null;
};

type DesktopBridge = {
  openText: (path?: string | null) => Promise<DesktopOpenTextResult | null>;
  saveText: (params: {
    text: string;
    suggestedName?: string;
    path?: string | null;
    forceSaveAs: boolean;
  }) => Promise<DesktopSaveTextResult>;
  exportFile: (params: {
    fileName: string;
    mimeType: string;
    bytesBase64: string;
  }) => Promise<boolean>;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  setWindowTitle: (title: string) => Promise<void>;
  closeWindow: () => Promise<void>;
  onMenuCommand: (handler: (commandId: AppMenuCommandId) => void) => Promise<() => void>;
  onOpenRecent: (handler: (path: string) => void) => Promise<() => void>;
  onWindowCloseRequest: (handler: () => void) => Promise<() => void>;
};

export type DesktopPlatformEnvironment = {
  storage?: StorageLike;
  bridge?: DesktopBridge;
};

type BrowserLikeGlobal = typeof globalThis & {
  __TIKZ_EDITOR_DESKTOP_PLATFORM_ENV__?: DesktopPlatformEnvironment;
  __TIKZ_EDITOR_DESKTOP_TEST_API__?: {
    setBridgeOverride: (bridge: DesktopBridge | null) => void;
    dispatchCommand: (commandId: AppMenuCommandId) => void;
    triggerOpenRequest: (opened: { source: string; path: string; name: string }) => void;
    triggerWindowCloseRequest: () => void;
  };
};

function readInjectedTestEnvironment(): DesktopPlatformEnvironment {
  return ((globalThis as BrowserLikeGlobal).__TIKZ_EDITOR_DESKTOP_PLATFORM_ENV__) ?? {};
}

function resolveStorage(env: DesktopPlatformEnvironment): StorageLike {
  if (env.storage) {
    return env.storage;
  }
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    }
  };
}

function toDesktopFileRef(path: string, name: string): DocumentFileRef {
  return {
    kind: "file",
    name,
    path,
    provider: "desktop-fs"
  };
}

function base64FromBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function createDefaultBridge(): DesktopBridge {
  return {
    openText: async (path) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DesktopOpenTextResult | null>("desktop_open_text", { path });
    },
    saveText: async ({ text, suggestedName, path, forceSaveAs }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DesktopSaveTextResult>("desktop_save_text", {
        text,
        suggestedName,
        path,
        forceSaveAs
      });
    },
    exportFile: async ({ fileName, mimeType, bytesBase64 }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("desktop_export_file", { fileName, mimeType, bytesBase64 });
    },
    readClipboard: async () => {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return await readText();
    },
    writeClipboard: async (text) => {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
    },
    setWindowTitle: async (title) => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setTitle(title);
    },
    closeWindow: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_confirm_window_close");
    },
    onMenuCommand: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<string>("desktop-menu-command", (event) => {
        if (typeof event.payload === "string") {
          handler(event.payload as AppMenuCommandId);
        }
      });
    },
    onOpenRecent: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<string>("desktop-open-recent", (event) => {
        if (typeof event.payload === "string") {
          handler(event.payload);
        }
      });
    },
    onWindowCloseRequest: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen("desktop-window-close-request", () => {
        handler();
      });
    }
  };
}

export function createDesktopPlatformAdapter(env: DesktopPlatformEnvironment = {}): EditorPlatform {
  const mergedEnv = { ...readInjectedTestEnvironment(), ...env };
  const storage = resolveStorage(mergedEnv);
  const defaultBridge = mergedEnv.bridge ?? createDefaultBridge();
  let bridgeOverride: DesktopBridge | null = null;
  const getBridge = () => bridgeOverride ?? readInjectedTestEnvironment().bridge ?? mergedEnv.bridge ?? defaultBridge;
  let menuHandler: MenuCommandHandler | null = null;
  let openRequestHandler: ((opened: { source: string; fileRef: DocumentFileRef | null }) => void) | null = null;
  let closeRequestHandler: (() => void) | null = null;
  let menuUnlistenPromise: Promise<(() => void) | null> | null = null;
  let openRecentUnlistenPromise: Promise<(() => void) | null> | null = null;
  let windowCloseUnlistenPromise: Promise<(() => void) | null> | null = null;

  function ensureNativeEventHooks(): void {
    if (!menuUnlistenPromise) {
      menuUnlistenPromise = getBridge().onMenuCommand((commandId) => {
        menuHandler?.(commandId, "platform");
      }).catch(() => null);
    }
    if (!openRecentUnlistenPromise) {
      openRecentUnlistenPromise = getBridge().onOpenRecent((path) => {
        if (!openRequestHandler) {
          return;
        }
        void getBridge().openText(path).then((opened) => {
          if (!opened) {
            return;
          }
          openRequestHandler?.({
            source: opened.source,
            fileRef: toDesktopFileRef(opened.path, opened.name)
          });
        });
      }).catch(() => null);
    }
    if (!windowCloseUnlistenPromise) {
      windowCloseUnlistenPromise = getBridge().onWindowCloseRequest(() => {
        closeRequestHandler?.();
      }).catch(() => null);
    }
  }

  ensureNativeEventHooks();

  (globalThis as BrowserLikeGlobal).__TIKZ_EDITOR_DESKTOP_TEST_API__ = {
    setBridgeOverride: (bridge) => {
      bridgeOverride = bridge;
    },
    dispatchCommand: (commandId) => {
      menuHandler?.(commandId, "platform");
    },
    triggerOpenRequest: (opened) => {
      openRequestHandler?.({
        source: opened.source,
        fileRef: toDesktopFileRef(opened.path, opened.name)
      });
    },
    triggerWindowCloseRequest: () => {
      closeRequestHandler?.();
    }
  };

  return {
    id: "desktop-tauri",
    persistence: {
      load: (key) => storage.getItem(key),
      save: (key, value) => {
        storage.setItem(key, value);
      }
    },
    clipboard: {
      readText: async () => await getBridge().readClipboard(),
      writeText: async (text) => {
        await getBridge().writeClipboard(text);
      }
    },
    menu: {
      bindCommandHandler: (handler) => {
        menuHandler = handler;
        ensureNativeEventHooks();
        return () => {
          if (menuHandler === handler) {
            menuHandler = null;
          }
        };
      },
      dispatchCommand: (commandId, origin = "platform") => {
        menuHandler?.(commandId, origin);
      }
    },
    window: {
      setDocumentState: ({ title, dirty }) => {
        const baseTitle = title ?? "TikZ Editor";
        const fullTitle = dirty ? `• ${baseTitle}` : baseTitle;
        void getBridge().setWindowTitle(fullTitle);
      },
      bindCloseRequest: (handler) => {
        closeRequestHandler = handler;
        ensureNativeEventHooks();
        return () => {
          if (closeRequestHandler === handler) {
            closeRequestHandler = null;
          }
        };
      },
      close: async () => {
        await getBridge().closeWindow();
      }
    },
    files: {
      bindOpenRequest: (handler) => {
        openRequestHandler = handler;
        ensureNativeEventHooks();
        return () => {
          if (openRequestHandler === handler) {
            openRequestHandler = null;
          }
        };
      },
      openText: async () => {
        const opened = await getBridge().openText(null);
        if (!opened) {
          return null;
        }
        return {
          source: opened.source,
          fileRef: toDesktopFileRef(opened.path, opened.name)
        };
      },
      saveText: async (text, options) => {
        const mode = options?.mode ?? "save";
        const currentRef = options?.fileRef ?? null;
        let result: DesktopSaveTextResult;
        try {
          result = await getBridge().saveText({
            text,
            suggestedName: options?.suggestedName ?? currentRef?.name ?? "tikz-document.tex",
            path: currentRef?.provider === "desktop-fs" ? (currentRef.path ?? null) : null,
            forceSaveAs: mode === "save-as"
          });
        } catch (error) {
          return { status: "failed", fileRef: currentRef };
        }
        if (!result.ok || !result.path || !result.name) {
          return { status: "cancelled", fileRef: currentRef };
        }
        return {
          status: "saved",
          fileRef: toDesktopFileRef(result.path, result.name)
        };
      },
      exportFile: async (content, options) => {
        const blob = new Blob(content, { type: options.mimeType });
        const arrayBuffer = await blob.arrayBuffer();
        return await getBridge().exportFile({
          fileName: options.fileName,
          mimeType: options.mimeType,
          bytesBase64: base64FromBytes(new Uint8Array(arrayBuffer))
        });
      }
    }
  };
}
