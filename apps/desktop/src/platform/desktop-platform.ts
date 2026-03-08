import {
  APP_MENU_COMMAND_IDS,
  type AppMenuCommandId,
  type AppMenuDefinition,
  type AppMenuItem,
  type DocumentFileRef,
  type EditorPlatform,
  type MenuCommandHandler
} from "@tikz-editor/app";

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
  listRecentFiles: () => Promise<string[]>;
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

type NativeCommandState = {
  enabled: boolean;
  checked?: boolean;
};

type NativeMenuSyncPayload = {
  definition: AppMenuDefinition;
  commandStates: Record<AppMenuCommandId, NativeCommandState>;
};

type NativeCommandRef = {
  kind: "command" | "check";
  item: {
    setEnabled: (enabled: boolean) => Promise<void>;
    setChecked?: (checked: boolean) => Promise<void>;
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

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /(mac|iphone|ipad)/i.test(navigator.platform);
}

function hasModifierAccelerator(accelerator: string | undefined): accelerator is string {
  if (!accelerator) {
    return false;
  }
  return /cmd|ctrl|alt|shift|meta|option|super/i.test(accelerator);
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/g);
  const last = segments[segments.length - 1];
  return last && last.trim() ? last : path;
}

function createNativeDesktopMenuManager(options: {
  getBridge: () => DesktopBridge;
  dispatchCommand: (commandId: AppMenuCommandId) => void;
  dispatchOpenRecent: (path: string) => void;
}) {
  const { getBridge, dispatchCommand, dispatchOpenRecent } = options;
  const commandRefs = new Map<AppMenuCommandId, NativeCommandRef[]>();
  let currentMenu: { setAsAppMenu: () => Promise<unknown> } | null = null;
  let latestPayload: NativeMenuSyncPayload | null = null;
  let definitionKey: string | null = null;
  let recentsDirty = true;
  let syncQueue = Promise.resolve();

  function addCommandRef(commandId: AppMenuCommandId, ref: NativeCommandRef): void {
    const known = commandRefs.get(commandId) ?? [];
    known.push(ref);
    commandRefs.set(commandId, known);
  }

  async function applyCommandStates(commandStates: Record<AppMenuCommandId, NativeCommandState>): Promise<void> {
    for (const [commandId, refs] of commandRefs.entries()) {
      const state = commandStates[commandId] ?? { enabled: false };
      for (const ref of refs) {
        await ref.item.setEnabled(state.enabled);
        if (ref.kind === "check") {
          await ref.item.setChecked?.(Boolean(state.checked));
        }
      }
    }
  }

  async function buildMenuItem(
    item: AppMenuItem,
    commandStates: Record<AppMenuCommandId, NativeCommandState>,
    recentFiles: readonly string[]
  ): Promise<unknown | null> {
    const menuApi = await import("@tauri-apps/api/menu");

    if (item.kind === "separator") {
      return await menuApi.PredefinedMenuItem.new({ item: "Separator" });
    }

    if (item.kind === "recent-files") {
      const recentItems = recentFiles.length > 0
        ? await Promise.all(
          recentFiles.map(async (path, index) =>
            await menuApi.MenuItem.new({
              id: `file.open-recent.${index}`,
              text: basename(path),
              action: () => {
                dispatchOpenRecent(path);
              }
            })
          )
        )
        : [
          await menuApi.MenuItem.new({
            id: "file.open-recent.empty",
            text: "No Recent Files",
            enabled: false
          })
        ];
      return await menuApi.Submenu.new({
        id: "file.open-recent",
        text: item.label,
        items: recentItems
      });
    }

    if (item.kind === "submenu") {
      const builtItems = (
        await Promise.all(item.items.map(async (child) => await buildMenuItem(child, commandStates, recentFiles)))
      ).filter((child): child is NonNullable<typeof child> => child != null);

      if (builtItems.length === 0) {
        return null;
      }

      return await menuApi.Submenu.new({
        text: item.label,
        items: builtItems
      });
    }

    const state = commandStates[item.commandId] ?? { enabled: false };
    const accelerator = hasModifierAccelerator(item.accelerator) ? item.accelerator : undefined;

    if (state.checked != null) {
      const checkItem = await menuApi.CheckMenuItem.new({
        id: item.commandId,
        text: item.label,
        checked: state.checked,
        enabled: state.enabled,
        accelerator,
        action: (id) => {
          dispatchCommand(id as AppMenuCommandId);
        }
      });
      addCommandRef(item.commandId, { kind: "check", item: checkItem });
      return checkItem;
    }

    const commandItem = await menuApi.MenuItem.new({
      id: item.commandId,
      text: item.label,
      enabled: state.enabled,
      accelerator,
      action: (id) => {
        dispatchCommand(id as AppMenuCommandId);
      }
    });
    addCommandRef(item.commandId, { kind: "command", item: commandItem });
    return commandItem;
  }

  async function buildMacApplicationSubmenu(
    commandStates: Record<AppMenuCommandId, NativeCommandState>
  ): Promise<unknown> {
    const menuApi = await import("@tauri-apps/api/menu");
    const aboutItem = await menuApi.PredefinedMenuItem.new({ item: { About: null } });
    const separator1 = await menuApi.PredefinedMenuItem.new({ item: "Separator" });
    const separator2 = await menuApi.PredefinedMenuItem.new({ item: "Separator" });
    const quitItem = await menuApi.PredefinedMenuItem.new({ item: "Quit" });

    const settingsState = commandStates[APP_MENU_COMMAND_IDS.OPEN_SETTINGS] ?? { enabled: false };
    const settingsItem = await menuApi.MenuItem.new({
      id: "app.open-settings",
      text: "Settings...",
      enabled: settingsState.enabled,
      action: () => {
        dispatchCommand(APP_MENU_COMMAND_IDS.OPEN_SETTINGS);
      }
    });
    addCommandRef(APP_MENU_COMMAND_IDS.OPEN_SETTINGS, { kind: "command", item: settingsItem });

    return await menuApi.Submenu.new({
      id: "app",
      text: "App",
      items: [aboutItem, separator1, settingsItem, separator2, quitItem]
    });
  }

  async function rebuildMenu(payload: NativeMenuSyncPayload): Promise<void> {
    const menuApi = await import("@tauri-apps/api/menu");
    const recentFiles = await getBridge().listRecentFiles().catch(() => [] as string[]);

    commandRefs.clear();
    const topLevelItems: unknown[] = [];

    if (isMacPlatform()) {
      topLevelItems.push(await buildMacApplicationSubmenu(payload.commandStates));
    }

    for (const section of payload.definition) {
      const sectionItems = (
        await Promise.all(
          section.items.map(async (item) => await buildMenuItem(item, payload.commandStates, recentFiles))
        )
      ).filter((item): item is NonNullable<typeof item> => item != null);

      if (sectionItems.length === 0) {
        continue;
      }

      topLevelItems.push(
        await menuApi.Submenu.new({
          id: `section.${section.id}`,
          text: section.label,
          items: sectionItems
        })
      );
    }

    const menu = await menuApi.Menu.new({ items: topLevelItems });
    await menu.setAsAppMenu();
    currentMenu = menu;
    await applyCommandStates(payload.commandStates);
  }

  async function performSync(): Promise<void> {
    if (!latestPayload) {
      return;
    }
    const nextDefinitionKey = JSON.stringify(latestPayload.definition);
    if (!currentMenu || recentsDirty || definitionKey !== nextDefinitionKey) {
      await rebuildMenu(latestPayload);
      definitionKey = nextDefinitionKey;
      recentsDirty = false;
      return;
    }

    await applyCommandStates(latestPayload.commandStates);
  }

  function enqueueSync(): void {
    syncQueue = syncQueue.then(async () => {
      await performSync();
    }).catch(() => undefined);
  }

  return {
    sync(payload: NativeMenuSyncPayload): Promise<void> {
      latestPayload = payload;
      enqueueSync();
      return syncQueue;
    },
    refreshRecents(): void {
      recentsDirty = true;
      if (!latestPayload) {
        return;
      }
      enqueueSync();
    }
  };
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
    listRecentFiles: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string[]>("desktop_list_recent_files");
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
  let windowCloseUnlistenPromise: Promise<(() => void) | null> | null = null;

  const nativeMenuManager = createNativeDesktopMenuManager({
    getBridge,
    dispatchCommand: (commandId) => {
      menuHandler?.(commandId, "platform");
    },
    dispatchOpenRecent: (path) => {
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
        nativeMenuManager.refreshRecents();
      });
    }
  });

  function ensureNativeEventHooks(): void {
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
      usesNativeMenuBar: true,
      bindCommandHandler: (handler) => {
        menuHandler = handler;
        return () => {
          if (menuHandler === handler) {
            menuHandler = null;
          }
        };
      },
      dispatchCommand: (commandId, origin = "platform") => {
        menuHandler?.(commandId, origin);
      },
      syncNativeMenu: async (payload) => {
        await nativeMenuManager.sync(payload);
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
        nativeMenuManager.refreshRecents();
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
        } catch {
          return { status: "failed", fileRef: currentRef };
        }
        if (!result.ok || !result.path || !result.name) {
          return { status: "cancelled", fileRef: currentRef };
        }
        nativeMenuManager.refreshRecents();
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
