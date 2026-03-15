import { InspectorPanel } from "./InspectorPanel";
import { ObjectsPanel } from "./ObjectsPanel";
import { StylesPanel } from "./StylesPanel";
import { AssistantPanel } from "./AssistantPanel";
import { getActiveEditorPlatform } from "../platform/current";
import { useEditorStore } from "../store/store";
import type { AssistantComposerImageAttachment } from "./assistant-image-attachments";
import css from "./RightSidebar.module.css";

type RightSidebarProps = {
  onSubmitPrompt: (
    prompt: string,
    model: string | null,
    attachments: AssistantComposerImageAttachment[]
  ) => Promise<void>;
  onInterruptTurn: () => Promise<void>;
};

export function RightSidebar({ onSubmitPrompt, onInterruptTurn }: RightSidebarProps) {
  const tab = useEditorStore((s) => s.rightSidebarTab);
  const dispatch = useEditorStore((s) => s.dispatch);
  const assistantAvailable = typeof getActiveEditorPlatform().assistant?.startTurn === "function";

  return (
    <div className={css.sidebar}>
      <div className={css.tabs}>
        <button
          type="button"
          className={[css.tab, tab === "inspector" ? css.tabActive : ""].filter(Boolean).join(" ")}
          onClick={() => dispatch({ type: "SET_RIGHT_SIDEBAR_TAB", tab: "inspector" })}
        >
          Inspector
        </button>
        <button
          type="button"
          className={[css.tab, tab === "objects" ? css.tabActive : ""].filter(Boolean).join(" ")}
          onClick={() => dispatch({ type: "SET_RIGHT_SIDEBAR_TAB", tab: "objects" })}
          data-testid="objects-tab"
        >
          Objects
        </button>
        <button
          type="button"
          className={[css.tab, tab === "styles" ? css.tabActive : ""].filter(Boolean).join(" ")}
          onClick={() => dispatch({ type: "SET_RIGHT_SIDEBAR_TAB", tab: "styles" })}
          data-testid="styles-tab"
        >
          Styles
        </button>
        {assistantAvailable ? (
          <button
            type="button"
            className={[css.tab, tab === "assistant" ? css.tabActive : ""].filter(Boolean).join(" ")}
            onClick={() => dispatch({ type: "SET_RIGHT_SIDEBAR_TAB", tab: "assistant" })}
            data-testid="assistant-tab"
          >
            Assistant
          </button>
        ) : null}
      </div>

      <div className={css.body}>
        {tab === "assistant" && assistantAvailable ? (
          <AssistantPanel onSubmitPrompt={onSubmitPrompt} onInterruptTurn={onInterruptTurn} />
        ) : tab === "objects" ? (
          <ObjectsPanel />
        ) : tab === "styles" ? (
          <StylesPanel />
        ) : (
          <InspectorPanel />
        )}
      </div>
    </div>
  );
}
