import type { AppSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const STORAGE_KEY = "tikz-editor:settings";
const MIN_FORMATTER_MAX_LINE_LENGTH = 40;
const MAX_FORMATTER_MAX_LINE_LENGTH = 240;

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const parsedFormatterMaxLineLength =
      typeof parsed.editor?.formatterMaxLineLength === "number"
        ? clampFormatterMaxLineLength(parsed.editor.formatterMaxLineLength)
        : DEFAULT_SETTINGS.editor.formatterMaxLineLength;
    return {
      general: {
        ...DEFAULT_SETTINGS.general,
        ...(parsed.general ?? {})
      },
      editor: {
        ...DEFAULT_SETTINGS.editor,
        ...(parsed.editor ?? {}),
        formatterMaxLineLength: parsedFormatterMaxLineLength
      },
      canvas: {
        ...DEFAULT_SETTINGS.canvas,
        ...(parsed.canvas ?? {})
      },
      colorPicker: {
        ...DEFAULT_SETTINGS.colorPicker,
        ...(parsed.colorPicker ?? {})
      }
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function clampFormatterMaxLineLength(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.editor.formatterMaxLineLength;
  }
  const rounded = Math.round(value);
  return Math.max(MIN_FORMATTER_MAX_LINE_LENGTH, Math.min(MAX_FORMATTER_MAX_LINE_LENGTH, rounded));
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable — ignore
  }
}
