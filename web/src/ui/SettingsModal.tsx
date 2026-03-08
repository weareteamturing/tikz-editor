import { useState } from "react";
import { useSettingsStore } from "../settings/useSettingsStore";
import type { ColorPickerAccuracy, GridSize } from "../settings/types";
import { Modal } from "./Modal";
import css from "./SettingsModal.module.css";

type CategoryId = "editor" | "canvas";

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "editor", label: "Code Editor" },
  { id: "canvas", label: "Canvas" }
];

let rememberedCategory: CategoryId = "editor";

type SettingsModalProps = {
  onClose: () => void;
};

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>(rememberedCategory);

  const selectCategory = (id: CategoryId) => {
    rememberedCategory = id;
    setActiveCategory(id);
  };
  const settings = useSettingsStore((s) => s.settings);
  const updateEditorSettings = useSettingsStore((s) => s.updateEditorSettings);
  const updateCanvasSettings = useSettingsStore((s) => s.updateCanvasSettings);
  const updateColorPickerSettings = useSettingsStore((s) => s.updateColorPickerSettings);

  return (
    <Modal onClose={onClose} className={css.dialog} labelledBy="settings-title">
        <div className={css.titleBar}>
          <span id="settings-title" className={css.title}>Settings</span>
          <button type="button" className={css.closeBtn} onClick={onClose}>
            Close
          </button>
        </div>

        <div className={css.body}>
          <nav className={css.sidebar}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={[css.navItem, activeCategory === cat.id ? css.navItemActive : ""].filter(Boolean).join(" ")}
                onClick={() => selectCategory(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </nav>

          <div className={css.content}>
            {activeCategory === "editor" && (
              <div className={css.panel}>
                <div className={css.panelTitle}>Code Editor</div>

                <div className={css.settingRow}>
                  <label className={css.settingLabel} htmlFor="setting-word-wrap">
                    Word Wrap
                    <span className={css.settingDesc}>Wrap long lines in the source editor.</span>
                  </label>
                  <input
                    id="setting-word-wrap"
                    type="checkbox"
                    className={css.checkbox}
                    checked={settings.editor.wordWrap}
                    onChange={(e) => updateEditorSettings({ wordWrap: e.target.checked })}
                  />
                </div>

                <div className={css.settingRow}>
                  <label className={css.settingLabel} htmlFor="setting-line-numbers">
                    Line Numbers
                    <span className={css.settingDesc}>Show line numbers in the source editor.</span>
                  </label>
                  <input
                    id="setting-line-numbers"
                    type="checkbox"
                    className={css.checkbox}
                    checked={settings.editor.lineNumbers}
                    onChange={(e) => updateEditorSettings({ lineNumbers: e.target.checked })}
                  />
                </div>

                <div className={css.settingRow}>
                  <label className={css.settingLabel} htmlFor="setting-font-size">
                    Font Size
                    <span className={css.settingDesc}>Source editor font size.</span>
                  </label>
                  <select
                    id="setting-font-size"
                    className={css.select}
                    value={settings.editor.fontSize}
                    onChange={(e) => updateEditorSettings({ fontSize: Number(e.target.value) })}
                  >
                    {[11, 12, 13, 14, 15, 16, 18, 20].map((size) => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                </div>

                <div className={css.settingRow}>
                  <label className={css.settingLabel} htmlFor="setting-color-picker-accuracy">
                    Color Picker Precision
                    <span className={css.settingDesc}>
                      Approximate uses faster integer mixes. Exact enables higher-precision white-tail mixes.
                    </span>
                  </label>
                  <select
                    id="setting-color-picker-accuracy"
                    className={css.select}
                    value={settings.colorPicker.accuracy}
                    onChange={(e) => updateColorPickerSettings({ accuracy: e.target.value as ColorPickerAccuracy })}
                  >
                    <option value="approximate">Approximate (default)</option>
                    <option value="exact">Exact</option>
                  </select>
                </div>
              </div>
            )}

            {activeCategory === "canvas" && (
              <div className={css.panel}>
                <div className={css.panelTitle}>Canvas</div>

                <div className={css.settingRow}>
                  <label className={css.settingLabel} htmlFor="setting-grid-size">
                    Grid Size
                    <span className={css.settingDesc}>Controls how fine or coarse the snap grid is.</span>
                  </label>
                  <select
                    id="setting-grid-size"
                    className={css.select}
                    value={settings.canvas.gridSize}
                    onChange={(e) => updateCanvasSettings({ gridSize: e.target.value as GridSize })}
                  >
                    <option value="fine">Fine</option>
                    <option value="standard">Standard</option>
                    <option value="coarse">Coarse</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
    </Modal>
  );
}
