import type { AppMenuCommandId } from "../app-menu/index.js";

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
  openText?: () => Promise<string | null>;
  saveText?: (text: string, options?: { suggestedName?: string }) => Promise<boolean>;
  exportFile?: (content: BlobPart[], options: { fileName: string; mimeType: string }) => Promise<boolean>;
};

export type PlatformMenu = {
  bindCommandHandler?: (handler: MenuCommandHandler) => (() => void) | void;
  dispatchCommand?: (commandId: AppMenuCommandId, origin?: MenuCommandOrigin) => void;
};

export type PlatformWindowApi = {
  setDocumentState?: (state: { title?: string; dirty?: boolean }) => void;
};

export type EditorPlatform = {
  id: string;
  persistence: PlatformPersistence;
  clipboard?: PlatformClipboard;
  files?: PlatformFileApi;
  menu?: PlatformMenu;
  window?: PlatformWindowApi;
};
