import { useEditorStore } from "../store/store";
import type { ToolMode } from "../store/types";
import type { ReorderDirection } from "tikz-editor/edit/actions";
import { getToolCapabilityStatus } from "./capabilities";
import {
  actionAvailability,
  alignSelection,
  copySelection,
  distributeSelection,
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
  const snapshot = useEditorStore((s) => s.snapshot);
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

  const commandContext = {
    source,
    snapshotSource: snapshot.source,
    scene: snapshot.scene,
    editHandles: snapshot.editHandles,
    selectedElementIds,
    dispatch
  };

  const availability = actionAvailability(commandContext, internalClipboard);
  const canCopy = availability.copy.enabled;
  const canDuplicate = availability.duplicate.enabled;
  const canPaste = availability.paste.enabled;
  const canSendToBack = availability["reorder-sendToBack"].enabled;
  const canSendBackward = availability["reorder-sendBackward"].enabled;
  const canBringForward = availability["reorder-bringForward"].enabled;
  const canBringToFront = availability["reorder-bringToFront"].enabled;

  const availabilityTitle = (base: string, reason: string | null, enabled: boolean) =>
    enabled ? base : `${base}\n${reason ?? "Action unavailable."}`;

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
          title={availabilityTitle("Copy selection (Ctrl/Cmd+C)", availability.copy.reason, canCopy)}
          disabled={!canCopy}
          onClick={() => {
            void copySelection(commandContext);
          }}
        >
          Copy
        </button>
        <button
          className={css.btn}
          title={availabilityTitle("Paste after selection (Ctrl/Cmd+V)", availability.paste.reason, canPaste)}
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
          title={availabilityTitle(
            "Duplicate selection (Ctrl/Cmd+D)",
            availability.duplicate.reason,
            canDuplicate
          )}
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
          title={availabilityTitle("Send to back", availability["reorder-sendToBack"].reason, canSendToBack)}
          disabled={!canSendToBack}
          onClick={() => runReorder("sendToBack")}
        >
          To Back
        </button>
        <button
          className={css.btn}
          title={availabilityTitle("Send backward", availability["reorder-sendBackward"].reason, canSendBackward)}
          disabled={!canSendBackward}
          onClick={() => runReorder("sendBackward")}
        >
          Backward
        </button>
        <button
          className={css.btn}
          title={availabilityTitle("Bring forward", availability["reorder-bringForward"].reason, canBringForward)}
          disabled={!canBringForward}
          onClick={() => runReorder("bringForward")}
        >
          Forward
        </button>
        <button
          className={css.btn}
          title={availabilityTitle("Bring to front", availability["reorder-bringToFront"].reason, canBringToFront)}
          disabled={!canBringToFront}
          onClick={() => runReorder("bringToFront")}
        >
          To Front
        </button>
      </div>

      <div className={css.group}>
        <button
          className={css.btn}
          title={availabilityTitle("Align left", availability["align-left"].reason, availability["align-left"].enabled)}
          disabled={!availability["align-left"].enabled}
          onClick={() => alignSelection(commandContext, "left")}
        >
          Left
        </button>
        <button
          className={css.btn}
          title={availabilityTitle("Align center", availability["align-center"].reason, availability["align-center"].enabled)}
          disabled={!availability["align-center"].enabled}
          onClick={() => alignSelection(commandContext, "center")}
        >
          Center
        </button>
        <button
          className={css.btn}
          title={availabilityTitle("Align right", availability["align-right"].reason, availability["align-right"].enabled)}
          disabled={!availability["align-right"].enabled}
          onClick={() => alignSelection(commandContext, "right")}
        >
          Right
        </button>
        <button
          className={css.btn}
          title={availabilityTitle("Align top", availability["align-top"].reason, availability["align-top"].enabled)}
          disabled={!availability["align-top"].enabled}
          onClick={() => alignSelection(commandContext, "top")}
        >
          Top
        </button>
        <button
          className={css.btn}
          title={availabilityTitle("Align middle", availability["align-middle"].reason, availability["align-middle"].enabled)}
          disabled={!availability["align-middle"].enabled}
          onClick={() => alignSelection(commandContext, "middle")}
        >
          Middle
        </button>
        <button
          className={css.btn}
          title={availabilityTitle("Align bottom", availability["align-bottom"].reason, availability["align-bottom"].enabled)}
          disabled={!availability["align-bottom"].enabled}
          onClick={() => alignSelection(commandContext, "bottom")}
        >
          Bottom
        </button>
      </div>

      <div className={css.group}>
        <button
          className={css.btn}
          title={availabilityTitle(
            "Distribute horizontally",
            availability["distribute-horizontal"].reason,
            availability["distribute-horizontal"].enabled
          )}
          disabled={!availability["distribute-horizontal"].enabled}
          onClick={() => distributeSelection(commandContext, "horizontal")}
        >
          H Dist
        </button>
        <button
          className={css.btn}
          title={availabilityTitle(
            "Distribute vertically",
            availability["distribute-vertical"].reason,
            availability["distribute-vertical"].enabled
          )}
          disabled={!availability["distribute-vertical"].enabled}
          onClick={() => distributeSelection(commandContext, "vertical")}
        >
          V Dist
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
