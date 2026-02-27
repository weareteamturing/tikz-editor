import { useEditorStore } from "../store/store";
import { getToolCapabilityStatus } from "./capabilities";
import { TOOL_BUTTONS } from "./tool-config";
import css from "./Toolbar.module.css";

export function Toolbar() {
  const toolMode = useEditorStore((s) => s.toolMode);
  const dispatch = useEditorStore((s) => s.dispatch);

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
    </div>
  );
}
