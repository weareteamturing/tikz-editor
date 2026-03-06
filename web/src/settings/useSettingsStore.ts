import { create } from "zustand";
import type { AppSettings } from "./types";
import { loadSettings, saveSettings } from "./storage";

type SettingsStore = {
  settings: AppSettings;
  updateEditorSettings: (patch: Partial<AppSettings["editor"]>) => void;
  updateCanvasSettings: (patch: Partial<AppSettings["canvas"]>) => void;
};

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: loadSettings(),
  updateEditorSettings: (patch) => {
    set((state) => {
      const next: AppSettings = {
        ...state.settings,
        editor: { ...state.settings.editor, ...patch }
      };
      saveSettings(next);
      return { settings: next };
    });
  },
  updateCanvasSettings: (patch) => {
    set((state) => {
      const next: AppSettings = {
        ...state.settings,
        canvas: { ...state.settings.canvas, ...patch }
      };
      saveSettings(next);
      return { settings: next };
    });
  }
}));
