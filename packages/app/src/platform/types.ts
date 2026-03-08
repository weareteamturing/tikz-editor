import type { DocumentFileRef } from "../store/types.js";
import type { AppMenuCommandId, AppMenuDefinition } from "../app-menu/index.js";

export type MenuCommandOrigin = "menu" | "shortcut" | "context-menu" | "platform";

export type MenuCommandHandler = (commandId: AppMenuCommandId, origin: MenuCommandOrigin) => void;

export type PlatformPersistence = {
  load: (key: string) => string | null;
  save: (key: string, value: string) => void;
};

export type PlatformClipboard = {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
};

export type PlatformFileApi = {
  openText?: () => Promise<{ source: string; fileRef: DocumentFileRef | null } | null>;
  bindOpenRequest?: (
    handler: (opened: { source: string; fileRef: DocumentFileRef | null }) => void
  ) => (() => void) | void;
  saveText?: (
    text: string,
    options?: { suggestedName?: string; fileRef?: DocumentFileRef | null; mode?: "save" | "save-as" }
  ) => Promise<
    | { status: "saved"; fileRef: DocumentFileRef | null }
    | { status: "cancelled"; fileRef: DocumentFileRef | null }
    | { status: "failed"; fileRef: DocumentFileRef | null; reason?: string }
  >;
  exportFile?: (content: BlobPart[], options: { fileName: string; mimeType: string }) => Promise<boolean>;
};

export type PlatformMenu = {
  usesNativeMenuBar?: boolean;
  bindCommandHandler?: (handler: MenuCommandHandler) => (() => void) | void;
  dispatchCommand?: (commandId: AppMenuCommandId, origin?: MenuCommandOrigin) => void;
  syncNativeMenu?: (payload: {
    definition: AppMenuDefinition;
    commandStates: Record<AppMenuCommandId, { enabled: boolean; checked?: boolean }>;
  }) => Promise<void> | void;
};

export type PlatformWindowApi = {
  setDocumentState?: (state: { title?: string; dirty?: boolean }) => void;
  bindCloseRequest?: (handler: () => void) => (() => void) | void;
  close?: () => Promise<void> | void;
};

export type EditorPlatform = {
  id: string;
  persistence: PlatformPersistence;
  clipboard?: PlatformClipboard;
  files?: PlatformFileApi;
  menu?: PlatformMenu;
  window?: PlatformWindowApi;
};
