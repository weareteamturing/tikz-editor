import type { AppSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const STORAGE_KEY = "tikz-editor:settings";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      editor: {
        ...DEFAULT_SETTINGS.editor,
        ...(parsed.editor ?? {})
      },
      canvas: {
        ...DEFAULT_SETTINGS.canvas,
        ...(parsed.canvas ?? {})
      }
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable — ignore
  }
}
