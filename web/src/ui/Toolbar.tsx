import { useEditorStore } from "../store/store";
import type { ToolMode } from "../store/types";
import type { ReorderDirection } from "tikz-editor/edit/actions";
import { getToolCapabilityStatus } from "./capabilities";
import {
  canCopySelection,
  canDuplicateSelection,
  canPasteSelection,
  canReorderSelection,
  copySelection,
  duplicateSelection,
  pasteSelectionAnchor,
  reorderSelection
} from "./editor-commands";
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
  const source = useEditorStore((s) => s.source);
  const toolMode = useEditorStore((s) => s.toolMode);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const internalClipboard = useEditorStore((s) => s.internalClipboard);
  const historyIndex = useEditorStore((s) => s.historyIndex);
  const historyLength = useEditorStore((s) => s.history.length);
  const showSourcePanel = useEditorStore((s) => s.showSourcePanel);
  const showInspectorPanel = useEditorStore((s) => s.showInspectorPanel);
  const dispatch = useEditorStore((s) => s.dispatch);

  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < historyLength - 1;
  const canCopy = canCopySelection(selectedElementIds);
  const canDuplicate = canDuplicateSelection(selectedElementIds);
  const canPaste = canPasteSelection(internalClipboard);
  const canReorder = canReorderSelection(selectedElementIds);

  const commandContext = {
    source,
    selectedElementIds,
    dispatch
  };

  const runReorder = (direction: ReorderDirection) => {
    reorderSelection(commandContext, direction);
  };

  return (
    <div className={css.toolbar}>
      <span className={css.title}>TikZ Editor</span>

      <div className={css.separator} />

      {/* Tool mode buttons */}
      <div className={css.group}>
        {TOOL_BUTTONS.map(({ mode, label, title }) => {
          const capability = getToolCapabilityStatus(mode);
          const unsupported = capability.status === "unsupported";
          const partial = capability.status === "partial";
          const buttonTitle = partial || unsupported
            ? `${title}\n${capability.reason}`
            : title;

          return (
            <button
              key={mode}
              className={[
                css.btn,
                toolMode === mode ? css.btnActive : "",
                partial ? css.btnPartial : ""
              ].filter(Boolean).join(" ")}
              title={buttonTitle}
              disabled={unsupported}
              onClick={() => dispatch({ type: "SET_TOOL_MODE", mode })}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className={css.separator} />

      {/* Clipboard / Arrange */}
      <div className={css.group}>
        <button
          className={css.btn}
          title="Copy selection (Ctrl/Cmd+C)"
          disabled={!canCopy}
          onClick={() => {
            void copySelection(commandContext);
          }}
        >
          Copy
        </button>
        <button
          className={css.btn}
          title="Paste after selection (Ctrl/Cmd+V)"
          disabled={!canPaste}
          onClick={() => {
            pasteSelectionAnchor({
              ...commandContext,
              internalClipboard
            });
          }}
        >
          Paste
        </button>
        <button
          className={css.btn}
          title="Duplicate selection (Ctrl/Cmd+D)"
          disabled={!canDuplicate}
          onClick={() => {
            duplicateSelection(commandContext);
          }}
        >
          Duplicate
        </button>
      </div>

      <div className={css.group}>
        <button
          className={css.btn}
          title="Send to back"
          disabled={!canReorder}
          onClick={() => runReorder("sendToBack")}
        >
          To Back
        </button>
        <button
          className={css.btn}
          title="Send backward"
          disabled={!canReorder}
          onClick={() => runReorder("sendBackward")}
        >
          Backward
        </button>
        <button
          className={css.btn}
          title="Bring forward"
          disabled={!canReorder}
          onClick={() => runReorder("bringForward")}
        >
          Forward
        </button>
        <button
          className={css.btn}
          title="Bring to front"
          disabled={!canReorder}
          onClick={() => runReorder("bringToFront")}
        >
          To Front
        </button>
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
