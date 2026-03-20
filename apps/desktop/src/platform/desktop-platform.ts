import {
  APP_MENU_COMMAND_IDS,
  type AssistantAccountSnapshot,
  type DesktopContextMenuItem,
  type DesktopContextMenuPayload,
  type AssistantDynamicToolResult,
  type AssistantEvent,
  type AssistantModelOption,
  type AssistantThreadState,
  type AssistantThreadSummary,
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

type DesktopOpenBinaryResult = {
  bytesBase64: string;
  path: string;
  name: string;
};

type DesktopOpenTextFailureResult = {
  path: string;
  message: string;
};

type DesktopSaveTextResult = {
  ok: boolean;
  path: string | null;
  name: string | null;
};

type DesktopBridge = {
  openText: (path?: string | null) => Promise<DesktopOpenTextResult | null>;
  openBinary?: (path?: string | null) => Promise<DesktopOpenBinaryResult | null>;
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
  readCustomClipboardText: (
    formats: readonly string[]
  ) => Promise<{ format: string; text: string } | null>;
  readCustomClipboardBytes: (
    formats: readonly string[]
  ) => Promise<{ format: string; bytesBase64: string } | null>;
  writeClipboardBundle: (payload: {
    plainText: string;
    tikzJson?: string | null;
    svgText?: string | null;
  }) => Promise<void>;
  setWindowTitle: (title: string) => Promise<void>;
  closeWindow: () => Promise<void>;
  confirmUnsavedChanges: (message: string) => Promise<"save" | "discard" | "cancel">;
  openExternalUrl: (url: string) => Promise<boolean>;
  performSnapHaptic?: () => Promise<void>;
  listRecentFiles: () => Promise<string[]>;
  clearRecentFiles: () => Promise<void>;
  takePendingOpenRequests: () => Promise<DesktopOpenTextResult[]>;
  takePendingOpenFailures: () => Promise<DesktopOpenTextFailureResult[]>;
  onPendingOpenRequestsChanged: (handler: () => void) => Promise<() => void>;
  onWindowCloseRequest: (handler: () => void) => Promise<() => void>;
  showContextMenu: (payload: DesktopContextMenuPayload) => Promise<void>;
  onContextMenuCommand: (handler: (payload: { requestId: string; commandId: AppMenuCommandId }) => void) => Promise<() => void>;
  assistantEnsureDocumentThread?: (params: {
    documentId: string;
    source: string;
    threadId?: string | null;
    workspacePath?: string | null;
    figurePath?: string | null;
    previewPath?: string | null;
  }) => Promise<AssistantThreadSummary>;
  assistantStartTurn?: (params: {
    documentId: string;
    prompt: string;
    source: string;
    pngBase64?: string | null;
    pastedImages?: Array<{ base64: string; mimeType: string; fileName: string }>;
    threadId?: string | null;
    workspacePath?: string | null;
    figurePath?: string | null;
    previewPath?: string | null;
    model?: string | null;
    figureContext?: string | null;
    diagnosticsText?: string | null;
  }) => Promise<{ turnId: string | null }>;
  assistantInterruptTurn?: (params: { documentId: string }) => Promise<void>;
  assistantSyncSource?: (params: { documentId: string; source: string }) => Promise<void>;
  assistantRespondToApproval?: (params: {
    documentId: string;
    requestId: string;
    decision: "accept" | "acceptForSession" | "decline" | "cancel";
  }) => Promise<void>;
  assistantRespondToDynamicToolCall?: (params: {
    documentId: string;
    requestId: string;
    result: AssistantDynamicToolResult;
  }) => Promise<void>;
  assistantLoadThreadState?: (params: { documentId: string }) => Promise<AssistantThreadState | null>;
  assistantListModels?: () => Promise<AssistantModelOption[]>;
  assistantReadAccountSnapshot?: () => Promise<AssistantAccountSnapshot | null>;
  onAssistantEvent?: (handler: (event: AssistantEvent) => void) => Promise<() => void>;
};

export type DesktopPlatformEnvironment = {
  storage?: StorageLike;
  bridge?: DesktopBridge;
};

type BrowserLikeGlobal = typeof globalThis & {
  __TIKZ_EDITOR_DESKTOP_PLATFORM_ENV__?: DesktopPlatformEnvironment;
  __TIKZ_EDITOR_DESKTOP_TEST_API__?: {
    setBridgeOverride: (bridge: DesktopBridge | null) => void;
    dispatchCommand: (commandId: AppMenuCommandId) => boolean;
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

function bytesFromBase64(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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

const DESKTOP_OPEN_REQUESTS_CHANGED_EVENT = "desktop-open-requests-changed";

function basename(path: string): string {
  const segments = path.split(/[\\/]/g);
  const last = segments[segments.length - 1];
  return last && last.trim() ? last : path;
}

function serializeDesktopContextMenuItems(
  items: readonly AppMenuItem[],
  commandStates: Record<AppMenuCommandId, NativeCommandState>
): DesktopContextMenuItem[] {
  const serialized: DesktopContextMenuItem[] = [];

  for (const item of items) {
    if (item.kind === "separator") {
      serialized.push({ kind: "separator" });
      continue;
    }
    if (item.kind === "recent-files") {
      continue;
    }
    if (item.kind === "submenu") {
      const children = serializeDesktopContextMenuItems(item.items, commandStates);
      if (children.length === 0) {
        continue;
      }
      serialized.push({
        kind: "submenu",
        label: item.label,
        items: children
      });
      continue;
    }

    const state = commandStates[item.commandId] ?? { enabled: false };
    serialized.push({
      kind: "command",
      commandId: item.commandId,
      label: item.label,
      enabled: state.enabled,
      checked: state.checked,
      accelerator: hasModifierAccelerator(item.accelerator) ? item.accelerator : undefined
    });
  }

  return serialized;
}

function createNativeDesktopMenuManager(options: {
  getBridge: () => DesktopBridge;
  dispatchCommand: (commandId: AppMenuCommandId, origin: "platform" | "context-menu") => void;
  dispatchOpenRecent: (path: string) => void;
}) {
  const APP_DISPLAY_NAME = "TikZ Editor";
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

  function nativeClipboardPredefinedItemFor(commandId: AppMenuCommandId): "Cut" | "Copy" | "Paste" | null {
    if (commandId === APP_MENU_COMMAND_IDS.CUT) {
      return "Cut";
    }
    if (commandId === APP_MENU_COMMAND_IDS.COPY) {
      return "Copy";
    }
    if (commandId === APP_MENU_COMMAND_IDS.PASTE) {
      return "Paste";
    }
    return null;
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

  async function buildMenuItems(
    items: readonly AppMenuItem[],
    commandStates: Record<AppMenuCommandId, NativeCommandState>,
    recentFiles: readonly string[],
    origin: "platform" | "context-menu"
  ): Promise<any[]> {
    return (
      await Promise.all(items.map(async (item) => await buildMenuItem(item, commandStates, recentFiles, origin)))
    ).filter((item): item is NonNullable<typeof item> => item != null);
  }

  async function buildMenuItem(
    item: AppMenuItem,
    commandStates: Record<AppMenuCommandId, NativeCommandState>,
    recentFiles: readonly string[],
    origin: "platform" | "context-menu"
  ): Promise<any | null> {
    const menuApi = await import("@tauri-apps/api/menu");

    if (item.kind === "separator") {
      return await menuApi.PredefinedMenuItem.new({ item: "Separator" });
    }

    if (item.kind === "recent-files") {
      const recentItems: any[] = [];
      if (recentFiles.length > 0) {
        for (let i = 0; i < recentFiles.length; i += 1) {
          const path = recentFiles[i]!;
          recentItems.push(
            await menuApi.MenuItem.new({
              id: `file.open-recent.${i}`,
              text: basename(path),
              action: () => {
                dispatchOpenRecent(path);
              }
            })
          );
        }
        recentItems.push(await menuApi.PredefinedMenuItem.new({ item: "Separator" }));
        recentItems.push(
          await menuApi.MenuItem.new({
            id: APP_MENU_COMMAND_IDS.CLEAR_RECENT_FILES,
            text: "Clear Open Recent",
            action: () => {
              void getBridge()
                .clearRecentFiles()
                .then(() => {
                  refreshRecents();
                });
            }
          })
        );
      } else {
        recentItems.push(
          await menuApi.MenuItem.new({
            id: "file.open-recent.empty",
            text: "No Recent Files",
            enabled: false
          })
        );
      }

      return await menuApi.Submenu.new({
        id: "file.open-recent",
        text: item.label,
        items: recentItems
      });
    }

    if (item.kind === "submenu") {
      const builtItems = await buildMenuItems(item.items, commandStates, recentFiles, origin);

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
    const predefinedClipboardItem = nativeClipboardPredefinedItemFor(item.commandId);

    // Use native clipboard menu roles so Tauri/WebView performs standard copy/cut/paste
    // for focused text controls and emits DOM clipboard events for the focused canvas.
    if (predefinedClipboardItem) {
      return await menuApi.PredefinedMenuItem.new({ item: predefinedClipboardItem });
    }

    if (state.checked != null) {
      const checkItem = await menuApi.CheckMenuItem.new({
        id: item.commandId,
        text: item.label,
        checked: state.checked,
        enabled: state.enabled,
        accelerator,
        action: (id) => {
          dispatchCommand(id as AppMenuCommandId, origin);
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
        dispatchCommand(id as AppMenuCommandId, origin);
      }
    });
    addCommandRef(item.commandId, { kind: "command", item: commandItem });
    return commandItem;
  }

  async function buildMacApplicationSubmenu(
    commandStates: Record<AppMenuCommandId, NativeCommandState>
  ): Promise<any> {
    const menuApi = await import("@tauri-apps/api/menu");
    const aboutItem = await menuApi.PredefinedMenuItem.new({
      text: `About ${APP_DISPLAY_NAME}`,
      item: {
        About: {
          name: APP_DISPLAY_NAME
        }
      }
    });
    const separator1 = await menuApi.PredefinedMenuItem.new({ item: "Separator" });
    const separator2 = await menuApi.PredefinedMenuItem.new({ item: "Separator" });
    const quitItem = await menuApi.PredefinedMenuItem.new({
      text: `Quit ${APP_DISPLAY_NAME}`,
      item: "Quit"
    });

    const settingsState = commandStates[APP_MENU_COMMAND_IDS.OPEN_SETTINGS] ?? { enabled: false };
    const settingsItem = await menuApi.MenuItem.new({
      id: "app.open-settings",
      text: "Settings...",
      enabled: settingsState.enabled,
      accelerator: "CmdOrCtrl+,",
      action: () => {
        dispatchCommand(APP_MENU_COMMAND_IDS.OPEN_SETTINGS, "platform");
      }
    });
    addCommandRef(APP_MENU_COMMAND_IDS.OPEN_SETTINGS, { kind: "command", item: settingsItem });

    return await menuApi.Submenu.new({
      id: "app",
      text: APP_DISPLAY_NAME,
      items: [aboutItem, separator1, settingsItem, separator2, quitItem]
    });
  }

  async function rebuildMenu(payload: NativeMenuSyncPayload): Promise<void> {
    const menuApi = await import("@tauri-apps/api/menu");
    const recentFiles = await getBridge().listRecentFiles().catch(() => [] as string[]);

    commandRefs.clear();
    const topLevelItems: any[] = [];

    if (isMacPlatform()) {
      topLevelItems.push(await buildMacApplicationSubmenu(payload.commandStates));
    }

    for (const section of payload.definition) {
      const sectionItems = await buildMenuItems(section.items, payload.commandStates, recentFiles, "platform");

      if (sectionItems.length === 0) {
        continue;
      }

      const submenu = await menuApi.Submenu.new({
        id: `section.${section.id}`,
        text: section.label,
        items: sectionItems
      });
      if (isMacPlatform() && section.id === "help") {
        await submenu.setAsHelpMenuForNSApp();
      }
      topLevelItems.push(submenu);
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

  function refreshRecents(): void {
    recentsDirty = true;
    if (!latestPayload) {
      return;
    }
    enqueueSync();
  }

  return {
    sync(payload: NativeMenuSyncPayload): Promise<void> {
      latestPayload = payload;
      enqueueSync();
      return syncQueue;
    },
    refreshRecents(): void {
      refreshRecents();
    }
  };
}

function createDefaultBridge(): DesktopBridge {
  return {
    openText: async (path) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DesktopOpenTextResult | null>("desktop_open_text", { path });
    },
    openBinary: async (path) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DesktopOpenBinaryResult | null>("desktop_open_binary", { path });
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
      const { readText } = await import("tauri-plugin-clipboard-x-api");
      return await readText();
    },
    writeClipboard: async (text) => {
      const { writeText } = await import("tauri-plugin-clipboard-x-api");
      await writeText(text);
    },
    readCustomClipboardText: async (formats) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<{ format: string; text: string } | null>("desktop_read_custom_clipboard_text", {
        formats
      });
    },
    readCustomClipboardBytes: async (formats) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<{ format: string; bytesBase64: string } | null>("desktop_read_custom_clipboard_bytes", {
        formats
      });
    },
    writeClipboardBundle: async (payload) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_write_clipboard_bundle", {
        payload
      });
    },
    setWindowTitle: async (title) => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setTitle(title);
    },
    closeWindow: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_confirm_window_close");
    },
    confirmUnsavedChanges: async (message) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<"save" | "discard" | "cancel">("desktop_confirm_unsaved_changes", { message });
    },
    openExternalUrl: async (url) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("desktop_open_external", { url });
    },
    performSnapHaptic: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_perform_snap_haptic");
    },
    listRecentFiles: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string[]>("desktop_list_recent_files");
    },
    clearRecentFiles: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_clear_recent_files");
    },
    takePendingOpenRequests: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DesktopOpenTextResult[]>("desktop_take_pending_open_requests");
    },
    takePendingOpenFailures: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DesktopOpenTextFailureResult[]>("desktop_take_pending_open_failures");
    },
    onPendingOpenRequestsChanged: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen(DESKTOP_OPEN_REQUESTS_CHANGED_EVENT, () => {
        handler();
      });
    },
    onWindowCloseRequest: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen("desktop-window-close-request", () => {
        handler();
      });
    },
    showContextMenu: async (payload) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_show_context_menu", { payload });
    },
    onContextMenuCommand: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<{ requestId: string; commandId: AppMenuCommandId }>("desktop-context-menu-command", (event) => {
        handler(event.payload);
      });
    },
    assistantEnsureDocumentThread: async ({ documentId, source, threadId, workspacePath, figurePath, previewPath }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AssistantThreadSummary>("desktop_assistant_ensure_document_thread", {
        documentId,
        source,
        threadId,
        workspacePath,
        figurePath,
        previewPath
      });
    },
    assistantStartTurn: async ({ documentId, prompt, source, pngBase64, pastedImages, threadId, workspacePath, figurePath, previewPath, model, figureContext, diagnosticsText }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<{ turnId: string | null }>("desktop_assistant_start_turn", {
        documentId,
        prompt,
        source,
        pngBase64,
        pastedImages,
        threadId,
        workspacePath,
        figurePath,
        previewPath,
        model,
        figureContext,
        diagnosticsText
      });
    },
    assistantInterruptTurn: async ({ documentId }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_assistant_interrupt_turn", { documentId });
    },
    assistantSyncSource: async ({ documentId, source }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_assistant_sync_source", { documentId, source });
    },
    assistantRespondToApproval: async ({ documentId, requestId, decision }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_assistant_respond_to_approval", { documentId, requestId, decision });
    },
    assistantRespondToDynamicToolCall: async ({ documentId, requestId, result }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_assistant_respond_to_dynamic_tool_call", { documentId, requestId, result });
    },
    assistantLoadThreadState: async ({ documentId }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AssistantThreadState | null>("desktop_assistant_load_thread_state", { documentId });
    },
    assistantListModels: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AssistantModelOption[]>("desktop_assistant_list_models");
    },
    assistantReadAccountSnapshot: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AssistantAccountSnapshot | null>("desktop_assistant_read_account_snapshot");
    },
    onAssistantEvent: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<AssistantEvent>("desktop-assistant-event", (event) => {
        handler(event.payload);
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
  const pendingOpenedBuffer: Array<{ source: string; fileRef: DocumentFileRef | null }> = [];
  const pendingOpenFailureBuffer: DesktopOpenTextFailureResult[] = [];
  let windowCloseUnlistenPromise: Promise<(() => void) | null> | null = null;
  let contextMenuCommandUnlistenPromise: Promise<(() => void) | null> | null = null;
  let openRequestsChangedUnlistenPromise: Promise<(() => void) | null> | null = null;
  let pendingOpenSyncQueue = Promise.resolve();
  let nextContextMenuRequestId = 0;

  const nativeMenuManager = createNativeDesktopMenuManager({
    getBridge,
    dispatchCommand: (commandId, origin) => {
      menuHandler?.(commandId, origin);
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

  function showPendingOpenFailuresAlert(failures: readonly DesktopOpenTextFailureResult[]): void {
    if (failures.length === 0) {
      return;
    }
    const alertFn = (globalThis as { alert?: (message?: string) => void }).alert;
    if (typeof alertFn !== "function") {
      return;
    }
    const detailLines = failures.map((failure) => {
      const pathLabel = failure.path?.trim() ? failure.path : "(unknown path)";
      const message = failure.message?.trim() ? failure.message : "unknown error";
      return `• ${pathLabel}: ${message}`;
    });
    const summary = failures.length === 1
      ? "Could not open file:"
      : "Some files could not be opened:";
    alertFn(`${summary}\n${detailLines.join("\n")}`);
  }

  function flushPendingOpenBuffers(): void {
    if (!openRequestHandler) {
      return;
    }
    while (pendingOpenedBuffer.length > 0) {
      const opened = pendingOpenedBuffer.shift()!;
      openRequestHandler(opened);
    }
    if (pendingOpenFailureBuffer.length > 0) {
      const failures = pendingOpenFailureBuffer.splice(0, pendingOpenFailureBuffer.length);
      showPendingOpenFailuresAlert(failures);
    }
  }

  function syncPendingOpenQueues(): void {
    pendingOpenSyncQueue = pendingOpenSyncQueue.then(async () => {
      const [pendingOpens, pendingFailures] = await Promise.all([
        getBridge().takePendingOpenRequests().catch(() => [] as DesktopOpenTextResult[]),
        getBridge().takePendingOpenFailures().catch(() => [] as DesktopOpenTextFailureResult[])
      ]);

      if (pendingOpens.length === 0 && pendingFailures.length === 0) {
        return;
      }

      for (const opened of pendingOpens) {
        pendingOpenedBuffer.push({
          source: opened.source,
          fileRef: toDesktopFileRef(opened.path, opened.name)
        });
      }
      if (pendingFailures.length > 0) {
        pendingOpenFailureBuffer.push(...pendingFailures);
      }
      flushPendingOpenBuffers();
    }).catch(() => undefined);
  }

  function ensureNativeEventHooks(): void {
    if (!windowCloseUnlistenPromise) {
      windowCloseUnlistenPromise = getBridge().onWindowCloseRequest(() => {
        closeRequestHandler?.();
      }).catch(() => null);
    }
    if (!contextMenuCommandUnlistenPromise) {
      contextMenuCommandUnlistenPromise = getBridge().onContextMenuCommand((payload) => {
        menuHandler?.(payload.commandId, "context-menu");
      }).catch(() => null);
    }
    if (!openRequestsChangedUnlistenPromise) {
      openRequestsChangedUnlistenPromise = getBridge().onPendingOpenRequestsChanged(() => {
        syncPendingOpenQueues();
      }).catch(() => null);
      syncPendingOpenQueues();
    }
  }

  ensureNativeEventHooks();

  (globalThis as BrowserLikeGlobal).__TIKZ_EDITOR_DESKTOP_TEST_API__ = {
    setBridgeOverride: (bridge) => {
      bridgeOverride = bridge;
    },
    dispatchCommand: (commandId) => {
      if (!menuHandler) {
        return false;
      }
      menuHandler(commandId, "platform");
      return true;
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
      },
      readCustomText: async (formats) => {
        return await getBridge().readCustomClipboardText(formats);
      },
      readCustomBytes: async (formats) => {
        return await getBridge().readCustomClipboardBytes(formats);
      },
      writeBundle: async (payload) => {
        await getBridge().writeClipboardBundle(payload);
      }
    },
    menu: {
      usesNativeMenuBar: true,
      usesNativeContextMenus: true,
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
      },
      showNativeContextMenu: async (payload) => {
        nextContextMenuRequestId += 1;
        const requestId = `ctx-${Date.now()}-${nextContextMenuRequestId}`;
        await getBridge().showContextMenu({
          requestId,
          items: serializeDesktopContextMenuItems(payload.items, payload.commandStates)
        });
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
      },
      confirmUnsavedChanges: async (message) => {
        return await getBridge().confirmUnsavedChanges(message);
      },
      openExternalUrl: async (url) => {
        return await getBridge().openExternalUrl(url);
      }
    },
    haptics: {
      performSnapFeedback: async () => {
        await getBridge().performSnapHaptic?.();
      }
    },
    files: {
      bindOpenRequest: (handler) => {
        openRequestHandler = handler;
        flushPendingOpenBuffers();
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
      openBinary: async () => {
        const opened = await getBridge().openBinary?.(null);
        if (!opened) {
          return null;
        }
        nativeMenuManager.refreshRecents();
        const decoded = bytesFromBase64(opened.bytesBase64);
        const bytes = new ArrayBuffer(decoded.byteLength);
        new Uint8Array(bytes).set(decoded);
        return {
          bytes,
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
      },
      clearRecentFiles: async () => {
        await getBridge().clearRecentFiles();
        nativeMenuManager.refreshRecents();
      }
    },
    assistant: {
      ensureDocumentThread: async (params) => await getBridge().assistantEnsureDocumentThread?.(params)
        ?? Promise.reject(new Error("Assistant bridge unavailable.")),
      startTurn: async (params) => await getBridge().assistantStartTurn?.(params)
        ?? Promise.reject(new Error("Assistant bridge unavailable.")),
      interruptTurn: async (params) => {
        await getBridge().assistantInterruptTurn?.(params);
      },
      syncSource: async (params) => {
        await getBridge().assistantSyncSource?.(params);
      },
      respondToApproval: async (params) => {
        await getBridge().assistantRespondToApproval?.(params as {
          documentId: string;
          requestId: string;
          decision: "accept" | "acceptForSession" | "decline" | "cancel";
        });
      },
      respondToDynamicToolCall: async (params) => {
        await getBridge().assistantRespondToDynamicToolCall?.(params);
      },
      loadThreadState: async (params) => await getBridge().assistantLoadThreadState?.(params) ?? null,
      listModels: async () => await getBridge().assistantListModels?.() ?? [],
      readAccountSnapshot: async () => await getBridge().assistantReadAccountSnapshot?.() ?? null,
      bindEvents: (handler) => {
        let disposed = false;
        let unlisten: (() => void) | null = null;
        void getBridge().onAssistantEvent?.(handler).then((fn) => {
          if (disposed) {
            fn();
            return;
          }
          unlisten = fn;
        });
        return () => {
          disposed = true;
          unlisten?.();
        };
      }
    }
  };
}
