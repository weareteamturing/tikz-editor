import type { EditorPlatform, MenuCommandHandler } from "@tikz-editor/app";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

type ClipboardLike = {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
};

export type BrowserPlatformEnvironment = {
  storage?: StorageLike;
  clipboard?: ClipboardLike;
};

function resolveStorage(env: BrowserPlatformEnvironment): StorageLike | null {
  if (env.storage) {
    return env.storage;
  }
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  return null;
}

function resolveClipboard(env: BrowserPlatformEnvironment): ClipboardLike | null {
  if (env.clipboard) {
    return env.clipboard;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    return navigator.clipboard;
  }
  return null;
}

function openTextFileWithInput(): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".tex,.tikz,.txt,text/plain";
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        input.remove();
        resolve(null);
        return;
      }
      const text = await file.text();
      input.remove();
      resolve(text);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export function createBrowserPlatformAdapter(env: BrowserPlatformEnvironment = {}): EditorPlatform {
  const storage = resolveStorage(env);
  const clipboard = resolveClipboard(env);
  let menuHandler: MenuCommandHandler | null = null;

  return {
    id: "web",
    persistence: {
      load: (key) => storage?.getItem(key) ?? null,
      save: (key, value) => {
        storage?.setItem(key, value);
      }
    },
    clipboard: {
      readText: clipboard?.readText ? async () => clipboard.readText!() : undefined,
      writeText: clipboard?.writeText ? async (text) => clipboard.writeText!(text) : undefined
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
      setDocumentState: ({ title, dirty }) => {
        if (typeof document === "undefined") {
          return;
        }
        const baseTitle = title ?? "TikZ Editor";
        document.title = dirty ? `• ${baseTitle}` : baseTitle;
      }
    },
    files: {
      openText: async () => openTextFileWithInput(),
      saveText: async (text, options) => {
        const fileName = options?.suggestedName ?? "tikz-document.tex";
        return (
          (await (async () => {
            if (
              typeof document === "undefined" ||
              typeof Blob === "undefined" ||
              typeof URL === "undefined" ||
              typeof URL.createObjectURL !== "function" ||
              typeof URL.revokeObjectURL !== "function" ||
              !document.body
            ) {
              return false;
            }
            const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
            const objectUrl = URL.createObjectURL(blob);
            try {
              const anchor = document.createElement("a");
              anchor.href = objectUrl;
              anchor.download = fileName;
              anchor.style.display = "none";
              document.body.appendChild(anchor);
              anchor.click();
              anchor.remove();
              return true;
            } finally {
              URL.revokeObjectURL(objectUrl);
            }
          })())
        );
      },
      exportFile: async (content, options) => {
        if (
          typeof document === "undefined" ||
          typeof Blob === "undefined" ||
          typeof URL === "undefined" ||
          typeof URL.createObjectURL !== "function" ||
          typeof URL.revokeObjectURL !== "function" ||
          !document.body
        ) {
          return false;
        }
        const blob = new Blob(content, { type: options.mimeType });
        const objectUrl = URL.createObjectURL(blob);
        try {
          const anchor = document.createElement("a");
          anchor.href = objectUrl;
          anchor.download = options.fileName;
          anchor.style.display = "none";
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          return true;
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
    }
  };
}
