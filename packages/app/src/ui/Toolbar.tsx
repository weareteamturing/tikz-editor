import { useEffect, useRef, useState } from "react";
import { useProjectNamedColorSwatches } from "../project-named-colors";
import { useEditorStore } from "../store/store";
import { getActiveEditorPlatform } from "../platform/current";
import { NODE_SHAPE_OPTIONS } from "tikz-editor/edit/inspector";
import { ColorPicker } from "./ColorPicker";
import { getToolCapabilityStatus } from "./capabilities";
import { RenderedTooltip } from "./RenderedTooltip";
import {
  resolveToolbarToolMode,
  TOOL_BUTTONS,
  TOOL_COLOR_OPTIONS,
  CaretDownIcon,
  type ToolPopupKind
} from "./tool-config";
import { GENERATED_NODE_SHAPE_PREVIEWS } from "./generated-node-shape-previews";
import { ToolbarToolPopup, ToolbarPopupSection, ToolbarPopupVisualChoiceGrid } from "./ToolbarToolPopup";
import type { ToolMode } from "../store/types";
import css from "./Toolbar.module.css";

const SHAPE_POPUP_CHOICES = NODE_SHAPE_OPTIONS.map((option) => ({
  id: option.value,
  label: option.label,
  previewSvg: GENERATED_NODE_SHAPE_PREVIEWS[option.value] ?? null
}));

export function Toolbar() {
  const toolMode = useEditorStore((s) => s.toolMode);
  const bucketFillColor = useEditorStore((s) => s.bucketFillColor);
  const selectedAddShape = useEditorStore((s) => s.selectedAddShape);
  const dispatch = useEditorStore((s) => s.dispatch);
  const projectNamedColorSwatches = useProjectNamedColorSwatches();
  const [openPopupMode, setOpenPopupMode] = useState<ToolMode | null>(null);
  const isDesktop = getActiveEditorPlatform().id.startsWith("desktop");
  const isMacDesktop =
    isDesktop &&
    typeof navigator !== "undefined" &&
    /(mac|iphone|ipad)/i.test(navigator.platform);
  const showAppTitle = !isDesktop;

  // Close popup when tool mode changes (unless it's a popup that can be used independently)
  useEffect(() => {
    if (openPopupMode && openPopupMode !== "addShape" && openPopupMode !== "addBucket" && openPopupMode !== toolMode) {
      setOpenPopupMode(null);
    }
  }, [openPopupMode, toolMode]);

  const renderPopup = (popupKind: ToolPopupKind) => {
    if (popupKind === "bucket-color") {
      return (
        <ToolbarPopupSection title="Bucket Color">
          <ColorPicker
            ariaLabel="Bucket fill color"
            value={bucketFillColor}
            syntaxValue={bucketFillColor}
            options={TOOL_COLOR_OPTIONS}
            namedColorSwatches={projectNamedColorSwatches}
            onChange={(nextValue) => {
              dispatch({ type: "SET_BUCKET_FILL_COLOR", value: nextValue });
              // Auto-activate bucket tool after selecting a color
              dispatch({ type: "SET_TOOL_MODE", mode: "addBucket" });
              setOpenPopupMode(null);
            }}
          />
        </ToolbarPopupSection>
      );
    }
    if (popupKind === "shape-picker") {
      return (
        <ToolbarPopupSection title="Shape">
          <ToolbarPopupVisualChoiceGrid
            choices={SHAPE_POPUP_CHOICES}
            selectedId={selectedAddShape}
            onSelect={(id) => {
              dispatch({ type: "SET_ADD_SHAPE_PRESET", value: id as typeof selectedAddShape });
              // Activate the shape tool and close popup
              dispatch({ type: "SET_TOOL_MODE", mode: "addShape" });
              setOpenPopupMode(null);
            }}
            testIdPrefix="toolbar-shape-choice"
          />
        </ToolbarPopupSection>
      );
    }
    return null;
  };

  const renderBucketButton = () => {
    const mode = "addBucket" as const;
    const toolDef = TOOL_BUTTONS.find((b) => b.mode === mode)!;
    const capability = getToolCapabilityStatus(mode);
    const unsupported = capability.status === "unsupported";
    const buttonTitle = unsupported
      ? `${toolDef.title}\n${capability.reason}`
      : toolDef.title;
    const Icon = toolDef.icon;
    const isActive = toolMode === mode;

    return (
      <ToolbarToolPopup
        key={mode}
        open={openPopupMode === mode}
        onClose={() => setOpenPopupMode(null)}
        popup={renderPopup("bucket-color")}
        popupTestId="toolbar-tool-popup-addBucket"
      >
        <div className={css.splitButton}>
          <RenderedTooltip content={buttonTitle}>
            <button
              className={[css.btn, css.splitButtonMain, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
              aria-label={toolDef.label}
              disabled={unsupported}
              onClick={() => {
                dispatch({ type: "SET_TOOL_MODE", mode });
                setOpenPopupMode(null);
              }}
            >
              <Icon size={18} />
              <div
                className={css.bucketColorIndicator}
                style={{ backgroundColor: bucketFillColor }}
              />
            </button>
          </RenderedTooltip>
          <RenderedTooltip content="Choose bucket color">
            <button
              className={[css.btn, css.splitButtonCaret, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
              aria-label="Choose bucket color"
              aria-haspopup="dialog"
              aria-expanded={openPopupMode === mode}
              disabled={unsupported}
              data-testid="toolbar-bucket-color-caret"
              onClick={(e) => {
                e.stopPropagation();
                setOpenPopupMode((current) => (current === mode ? null : mode));
              }}
            >
              <CaretDownIcon size={8} />
            </button>
          </RenderedTooltip>
        </div>
      </ToolbarToolPopup>
    );
  };

  const renderShapeButton = () => {
    const mode = "addShape" as const;
    const toolDef = TOOL_BUTTONS.find((b) => b.mode === mode)!;
    const capability = getToolCapabilityStatus(mode);
    const unsupported = capability.status === "unsupported";
    const buttonTitle = unsupported
      ? `${toolDef.title}\n${capability.reason}`
      : toolDef.title;
    const Icon = toolDef.icon;
    const isActive = toolMode === mode;

    return (
      <ToolbarToolPopup
        key={mode}
        open={openPopupMode === mode}
        onClose={() => setOpenPopupMode(null)}
        popup={renderPopup("shape-picker")}
        popupTestId="toolbar-tool-popup-addShape"
      >
        <RenderedTooltip content={buttonTitle}>
          <button
            className={[css.btn, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
            aria-label={toolDef.label}
            aria-haspopup="dialog"
            aria-expanded={openPopupMode === mode}
            disabled={unsupported}
            onClick={() => {
              // Just open the popup, don't activate the tool
              setOpenPopupMode((current) => (current === mode ? null : mode));
            }}
          >
            <Icon size={18} />
          </button>
        </RenderedTooltip>
      </ToolbarToolPopup>
    );
  };

  const renderStandardButton = (toolDef: (typeof TOOL_BUTTONS)[number]) => {
    const { mode, label, title, icon: Icon } = toolDef;
    const capability = getToolCapabilityStatus(mode);
    const unsupported = capability.status === "unsupported";
    const partial = capability.status === "partial";
    const buttonTitle = partial || unsupported
      ? `${title}\n${capability.reason}`
      : title;
    const nextMode = resolveToolbarToolMode(toolMode, mode);
    const isActive = toolMode === mode;

    return (
      <RenderedTooltip key={mode} content={buttonTitle}>
        <button
          className={[css.btn, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
          aria-label={label}
          disabled={unsupported}
          onClick={() => {
            dispatch({ type: "SET_TOOL_MODE", mode: nextMode });
            setOpenPopupMode(null);
          }}
        >
          <Icon size={18} />
        </button>
      </RenderedTooltip>
    );
  };

  return (
    <div className={`${css.toolbar}${isMacDesktop ? ` ${css.toolbarDesktop}` : ""}`} data-tauri-drag-region>
      {showAppTitle ? (
        <>
          <span className={css.title}>TikZ Editor</span>
          <div className={css.separator} />
        </>
      ) : null}

      <div className={css.group}>
        {TOOL_BUTTONS.map((toolDef) => {
          // Special handling for bucket and shape buttons
          if (toolDef.mode === "addBucket") {
            return renderBucketButton();
          }
          if (toolDef.mode === "addShape") {
            return renderShapeButton();
          }
          return renderStandardButton(toolDef);
        })}
      </div>
    </div>
  );
}
