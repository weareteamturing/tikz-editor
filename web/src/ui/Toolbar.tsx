import { useEditorStore } from "../store/store";
import type { ToolMode } from "../store/types";
import css from "./Toolbar.module.css";

type ToolButtonDef = {
  mode: ToolMode;
  label: string;
  title: string;
};

const TOOL_BUTTONS: ToolButtonDef[] = [
  { mode: "select", label: "↖ Select", title: "Select and move elements (V)" },
  { mode: "addNode", label: "+ Node", title: "Place a text node (N)" },
  { mode: "addLine", label: "/ Line", title: "Draw a line (L)" },
  { mode: "addArrow", label: "→ Arrow", title: "Draw an arrow (A)" },
  { mode: "addRect", label: "□ Rect", title: "Draw a rectangle (R)" },
  { mode: "addCircle", label: "○ Circle", title: "Draw a circle (C)" }
];

export function Toolbar() {
  const toolMode = useEditorStore((s) => s.toolMode);
  const historyIndex = useEditorStore((s) => s.historyIndex);
  const historyLength = useEditorStore((s) => s.history.length);
  const showSourcePanel = useEditorStore((s) => s.showSourcePanel);
  const showInspectorPanel = useEditorStore((s) => s.showInspectorPanel);
  const dispatch = useEditorStore((s) => s.dispatch);

  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < historyLength - 1;

  return (
    <div className={css.toolbar}>
      <span className={css.title}>TikZ Editor</span>

      <div className={css.separator} />

      {/* Tool mode buttons */}
      <div className={css.group}>
        {TOOL_BUTTONS.map(({ mode, label, title }) => (
          <button
            key={mode}
            className={`${css.btn} ${toolMode === mode ? css.btnActive : ""}`}
            title={title}
            disabled={mode !== "select"}  /* Phase 0: only select enabled */
            onClick={() => dispatch({ type: "SET_TOOL_MODE", mode })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={css.separator} />

      {/* Undo / Redo */}
      <div className={css.group}>
        <button
          className={css.btn}
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={() => dispatch({ type: "UNDO" })}
        >
          ↩ Undo
        </button>
        <button
          className={css.btn}
          title="Redo (Ctrl+Y)"
          disabled={!canRedo}
          onClick={() => dispatch({ type: "REDO" })}
        >
          ↪ Redo
        </button>
      </div>

      <div className={css.separator} />

      {/* Panel toggles */}
      <div className={css.group}>
        <button
          className={`${css.btn} ${showSourcePanel ? css.btnActive : ""}`}
          title="Toggle source panel"
          onClick={() => dispatch({ type: "TOGGLE_PANEL", panel: "source" })}
        >
          {"</>"}
        </button>
        <button
          className={`${css.btn} ${showInspectorPanel ? css.btnActive : ""}`}
          title="Toggle inspector panel"
          onClick={() => dispatch({ type: "TOGGLE_PANEL", panel: "inspector" })}
        >
          ☰ Inspector
        </button>
      </div>

      <div className={css.spacer} />

      {/* Right-side buttons */}
      <div className={css.group}>
        <button className={css.btn} title="Export TikZ source" disabled>
          ↓ Export
        </button>
      </div>
    </div>
  );
}
