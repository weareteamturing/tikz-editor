import { useEditorStore } from "../store/store";
import { getActiveEditorPlatform } from "../platform/current";
import { getToolCapabilityStatus } from "./capabilities";
import { RenderedTooltip } from "./RenderedTooltip";
import { resolveToolbarToolMode, TOOL_BUTTONS } from "./tool-config";
import css from "./Toolbar.module.css";

export function Toolbar() {
  const toolMode = useEditorStore((s) => s.toolMode);
  const dispatch = useEditorStore((s) => s.dispatch);
  const showAppTitle = !getActiveEditorPlatform().id.startsWith("desktop");

  return (
    <div className={css.toolbar}>
      {showAppTitle ? (
        <>
          <span className={css.title}>TikZ Editor</span>
          <div className={css.separator} />
        </>
      ) : null}

      {/* Tool mode buttons */}
      <div className={css.group}>
        {TOOL_BUTTONS.map(({ mode, label, title, icon: Icon }) => {
          const capability = getToolCapabilityStatus(mode);
          const unsupported = capability.status === "unsupported";
          const partial = capability.status === "partial";
          const buttonTitle = partial || unsupported
            ? `${title}\n${capability.reason}`
            : title;

          return (
            <RenderedTooltip key={mode} content={buttonTitle}>
              <button
                className={[
                  css.btn,
                  toolMode === mode ? css.btnActive : ""
                ].filter(Boolean).join(" ")}
                aria-label={label}
                disabled={unsupported}
                onClick={() =>
                  dispatch({
                    type: "SET_TOOL_MODE",
                    mode: resolveToolbarToolMode(toolMode, mode)
                  })
                }
              >
                <Icon size={14} />
              </button>
            </RenderedTooltip>
          );
        })}
      </div>
    </div>
  );
}
