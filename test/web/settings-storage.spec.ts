import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettings } from "../../apps/web/src/settings/storage.js";
import { DEFAULT_SETTINGS } from "../../apps/web/src/settings/types.js";

const STORAGE_KEY = "tikz-editor:settings";

describe("settings storage", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      }
    });
  });

  it("fills new formatter settings from defaults for legacy settings objects", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        editor: {
          wordWrap: true,
          fontSize: 13,
          lineNumbers: false,
          indentSize: 4
        }
      })
    );

    const loaded = loadSettings();
    expect(loaded.editor.wordWrap).toBe(true);
    expect(loaded.editor.indentSize).toBe(4);
    expect(loaded.editor.formatterReflowLongOptions).toBe(DEFAULT_SETTINGS.editor.formatterReflowLongOptions);
    expect(loaded.editor.formatterMaxLineLength).toBe(DEFAULT_SETTINGS.editor.formatterMaxLineLength);
  });

  it("clamps formatter max line length when loading persisted values", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        editor: {
          formatterMaxLineLength: 999
        }
      })
    );

    const loaded = loadSettings();
    expect(loaded.editor.formatterMaxLineLength).toBe(240);
  });
});
