import { InspectorPanel } from "./InspectorPanel";
import { AssistantPanel } from "./AssistantPanel";
import { getActiveEditorPlatform } from "../platform/current";
import { useEditorStore } from "../store/store";
import css from "./RightSidebar.module.css";

type RightSidebarProps = {
  onSubmitPrompt: (prompt: string) => Promise<void>;
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
        ) : (
          <InspectorPanel />
        )}
      </div>
    </div>
  );
}
