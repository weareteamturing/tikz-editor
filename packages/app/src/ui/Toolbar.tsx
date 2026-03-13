import { useEffect, useState } from "react";
import { useEditorStore } from "../store/store";
import { getActiveEditorPlatform } from "../platform/current";
import { getToolCapabilityStatus } from "./capabilities";
import { RenderedTooltip } from "./RenderedTooltip";
import {
  resolveToolbarToolMode,
  TOOL_BUTTONS,
  toolModePopupKind,
  type ToolPopupKind
} from "./tool-config";
import { ToolbarToolPopup, ToolbarPopupSection } from "./ToolbarToolPopup";
import type { ToolMode } from "../store/types";
import css from "./Toolbar.module.css";

export function Toolbar() {
  const toolMode = useEditorStore((s) => s.toolMode);
  const freehandSmoothingPx = useEditorStore((s) => s.freehandSmoothingPx);
  const dispatch = useEditorStore((s) => s.dispatch);
  const [openPopupMode, setOpenPopupMode] = useState<ToolMode | null>(null);
  const isDesktop = getActiveEditorPlatform().id.startsWith("desktop");
  const isMacDesktop =
    isDesktop &&
    typeof navigator !== "undefined" &&
    /(mac|iphone|ipad)/i.test(navigator.platform);
  const showAppTitle = !isDesktop;

  useEffect(() => {
    if (openPopupMode && openPopupMode !== toolMode) {
      setOpenPopupMode(null);
    }
  }, [openPopupMode, toolMode]);

  const renderPopup = (popupKind: ToolPopupKind) => {
    if (popupKind === "freehand-smoothing") {
      return (
        <ToolbarPopupSection title="Freehand">
          <label className={css.popupLabel} htmlFor="toolbar-freehand-smoothing">
            Smoothing <span className={css.popupValue}>{freehandSmoothingPx}px</span>
          </label>
          <input
            id="toolbar-freehand-smoothing"
            className={css.popupSlider}
            type="range"
            min={4}
            max={32}
            step={1}
            value={freehandSmoothingPx}
            data-testid="toolbar-freehand-smoothing-slider"
            onChange={(event) => {
              dispatch({ type: "SET_FREEHAND_SMOOTHING", value: Number(event.currentTarget.value) });
            }}
          />
        </ToolbarPopupSection>
      );
    }
    return null;
  };

  return (
    <div className={`${css.toolbar}${isMacDesktop ? ` ${css.toolbarDesktop}` : ""}`} data-tauri-drag-region>
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
          const popupKind = toolModePopupKind(mode);
          const hasPopup = popupKind != null;
          const buttonTitle = partial || unsupported
            ? `${title}\n${capability.reason}`
            : title;
          const nextMode = resolveToolbarToolMode(toolMode, mode);
          const button = (
            <RenderedTooltip content={buttonTitle}>
              <button
                className={[
                  css.btn,
                  toolMode === mode ? css.btnActive : ""
                ].filter(Boolean).join(" ")}
                aria-label={label}
                aria-haspopup={hasPopup ? "dialog" : undefined}
                aria-expanded={hasPopup && openPopupMode === mode && toolMode === mode ? true : undefined}
                disabled={unsupported}
                onClick={() => {
                  dispatch({
                    type: "SET_TOOL_MODE",
                    mode: nextMode
                  });
                  if (hasPopup && nextMode === mode) {
                    setOpenPopupMode(mode);
                  } else {
                    setOpenPopupMode(null);
                  }
                }}
              >
                <Icon size={14} />
              </button>
            </RenderedTooltip>
          );

          if (!hasPopup || !popupKind) {
            return (
              <RenderedTooltip key={mode} content={buttonTitle}>
                <button
                  className={[
                    css.btn,
                    toolMode === mode ? css.btnActive : ""
                  ].filter(Boolean).join(" ")}
                  aria-label={label}
                  disabled={unsupported}
                  onClick={() => {
                    dispatch({
                      type: "SET_TOOL_MODE",
                      mode: nextMode
                    });
                    setOpenPopupMode(null);
                  }}
                >
                  <Icon size={14} />
                </button>
              </RenderedTooltip>
            );
          }

          return (
            <ToolbarToolPopup
              key={mode}
              open={openPopupMode === mode && toolMode === mode}
              onClose={() => setOpenPopupMode((current) => (current === mode ? null : current))}
              popup={renderPopup(popupKind)}
              popupTestId={`toolbar-tool-popup-${mode}`}
            >
              {button}
            </ToolbarToolPopup>
          );
        })}
      </div>
    </div>
  );
}
