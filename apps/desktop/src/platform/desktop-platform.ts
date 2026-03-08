import type { EditorPlatform, MenuCommandHandler } from "@tikz-editor/app";

type MemoryStorage = Map<string, string>;

export function createDesktopPlatformAdapter(): EditorPlatform {
  const storage: MemoryStorage = new Map();
  let clipboardText = "";
  let menuHandler: MenuCommandHandler | null = null;

  return {
    id: "desktop-placeholder",
    persistence: {
      load: (key) => storage.get(key) ?? null,
      save: (key, value) => {
        storage.set(key, value);
      }
    },
    clipboard: {
      readText: async () => clipboardText,
      writeText: async (text) => {
        clipboardText = text;
      }
    },
    menu: {
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
      }
    },
    window: {
      setDocumentState: () => undefined
    },
    files: {
      openText: async () => null,
      saveText: async () => false,
      exportFile: async () => false
    }
  };
}
