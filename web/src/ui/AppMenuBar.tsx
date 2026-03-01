import { useEffect, useRef, useState } from "react";
import {
  APP_MENU_COMMAND_IDS,
  APP_MENU_DEFINITION,
  type AppMenuCommandId,
  type AppMenuItem
} from "tikz-editor/app-menu";
import { useEditorStore } from "../store/store";
import type { ToolMode } from "../store/types";
import { getToolCapabilityStatus } from "./capabilities";
import {
  actionAvailability,
  alignSelection,
  copySelection,
  cutSelection,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  pasteSelectionAnchor,
  reorderSelection
} from "./editor-commands";
import { canExportSvg, copySvgMarkup, exportSvgDownload } from "./export-commands";
import { OPEN_EXAMPLE_CATALOG, type TikzOpenExample } from "./examples/open-example-catalog";
import { OpenExampleModal } from "./OpenExampleModal";
import css from "./AppMenuBar.module.css";

type MenuCommandBinding = {
  enabled: boolean;
  checked?: boolean;
  run: () => void;
};

type MenuCommandBindings = Record<AppMenuCommandId, MenuCommandBinding>;

const IS_MAC_PLATFORM =
  typeof navigator !== "undefined" &&
  /(mac|iphone|ipad)/i.test(navigator.platform);

function formatAccelerator(accelerator: string | undefined): string {
  if (!accelerator) {
    return "";
  }

  return accelerator
    .split("+")
    .map((part) => {
      if (part === "CmdOrCtrl") {
        return IS_MAC_PLATFORM ? "Cmd" : "Ctrl";
      }
      return part;
    })
    .join(IS_MAC_PLATFORM ? " " : "+");
}

function MenuPopup({
  items,
  path,
  nested,
  bindings,
  onCommandRun
}: {
  items: readonly AppMenuItem[];
  path: string;
  nested: boolean;
  bindings: MenuCommandBindings;
  onCommandRun: () => void;
}) {
  const hasCheckItems = items.some(
    (item) => item.kind === "command" && bindings[item.commandId].checked != null
  );

  return (
    <div className={[css.popup, nested ? css.popupNested : ""].filter(Boolean).join(" ")} role="menu">
      {items.map((item, index) => {
        const itemKey = `${path}-${index}`;
        if (item.kind === "separator") {
          return <div key={`${itemKey}-separator`} className={css.separator} role="separator" />;
        }

        if (item.kind === "submenu") {
          return (
            <div key={`${itemKey}-submenu`} className={css.submenu}>
              <div
                className={[css.item, css.submenuTrigger, hasCheckItems ? "" : css.itemNoCheck]
                  .filter(Boolean)
                  .join(" ")}
                role="menuitem"
                aria-haspopup="menu"
              >
                {hasCheckItems ? <span className={css.check} /> : null}
                <span className={css.label}>{item.label}</span>
                <span className={css.submenuArrow}>›</span>
              </div>
              <MenuPopup
                items={item.items}
                path={`${itemKey}-submenu`}
                nested
                bindings={bindings}
                onCommandRun={onCommandRun}
              />
            </div>
          );
        }

        const binding = bindings[item.commandId];
        const role = binding.checked == null ? "menuitem" : "menuitemcheckbox";
        return (
          <button
            key={`${itemKey}-${item.commandId}`}
            type="button"
            role={role}
            aria-checked={binding.checked}
            disabled={!binding.enabled}
            className={[css.item, hasCheckItems ? "" : css.itemNoCheck].filter(Boolean).join(" ")}
            onClick={() => {
              if (!binding.enabled) {
                return;
              }
              binding.run();
              onCommandRun();
            }}
          >
            {hasCheckItems ? <span className={css.check}>{binding.checked ? "✓" : ""}</span> : null}
            <span className={css.label}>{item.label}</span>
            <span className={css.shortcut}>{formatAccelerator(item.accelerator)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function AppMenuBar() {
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const toolMode = useEditorStore((s) => s.toolMode);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const internalClipboard = useEditorStore((s) => s.internalClipboard);
  const historyIndex = useEditorStore((s) => s.historyIndex);
  const historyLength = useEditorStore((s) => s.history.length);
  const showGrid = useEditorStore((s) => s.showGrid);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const showRulers = useEditorStore((s) => s.showRulers);
  const showGuides = useEditorStore((s) => s.showGuides);
  const showSourcePanel = useEditorStore((s) => s.showSourcePanel);
  const showInspectorPanel = useEditorStore((s) => s.showInspectorPanel);
  const showDevPanel = useEditorStore((s) => s.showDevPanel);
  const dispatch = useEditorStore((s) => s.dispatch);

  const commandContext = {
    source,
    snapshotSource: snapshot.source,
    scene: snapshot.scene,
    editHandles: snapshot.editHandles,
    selectedElementIds,
    dispatch
  };

  const availability = actionAvailability(commandContext, internalClipboard);
  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < historyLength - 1;
  const canExport = canExportSvg(snapshot.svg);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [showOpenExampleModal, setShowOpenExampleModal] = useState(false);
  const [pendingAutoFit, setPendingAutoFit] = useState(false);
  const menuRootRef = useRef<HTMLDivElement | null>(null);

  const insertBinding = (mode: ToolMode) => {
    const capability = getToolCapabilityStatus(mode);
    return {
      enabled: capability.status !== "unsupported",
      checked: toolMode === mode,
      run: () => dispatch({ type: "SET_TOOL_MODE", mode })
    } satisfies MenuCommandBinding;
  };

  const runSvgDownload = () => {
    if (!snapshot.svg) {
      return;
    }
    void exportSvgDownload(snapshot.svg, { fileName: "tikz-export.svg" });
  };

  const runSvgCopy = () => {
    if (!snapshot.svg) {
      return;
    }
    void copySvgMarkup(snapshot.svg);
  };

  const bindings: MenuCommandBindings = {
    [APP_MENU_COMMAND_IDS.OPEN_EXAMPLE]: {
      enabled: true,
      run: () => setShowOpenExampleModal(true)
    },
    [APP_MENU_COMMAND_IDS.EXPORT_TIKZ]: {
      enabled: false,
      run: () => undefined
    },
    [APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD]: {
      enabled: canExport,
      run: runSvgDownload
    },
    [APP_MENU_COMMAND_IDS.EXPORT_SVG_COPY]: {
      enabled: canExport,
      run: runSvgCopy
    },
    [APP_MENU_COMMAND_IDS.UNDO]: {
      enabled: canUndo,
      run: () => dispatch({ type: "UNDO" })
    },
    [APP_MENU_COMMAND_IDS.REDO]: {
      enabled: canRedo,
      run: () => dispatch({ type: "REDO" })
    },
    [APP_MENU_COMMAND_IDS.CUT]: {
      enabled: availability.cut.enabled && availability.delete.enabled,
      run: () => {
        void cutSelection(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.COPY]: {
      enabled: availability.copy.enabled,
      run: () => {
        void copySelection(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.PASTE]: {
      enabled: availability.paste.enabled,
      run: () => {
        pasteSelectionAnchor({
          ...commandContext,
          internalClipboard
        });
      }
    },
    [APP_MENU_COMMAND_IDS.DELETE]: {
      enabled: availability.delete.enabled,
      run: () => {
        deleteSelection(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.DUPLICATE]: {
      enabled: availability.duplicate.enabled,
      run: () => {
        duplicateSelection(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.SEND_TO_BACK]: {
      enabled: availability["reorder-sendToBack"].enabled,
      run: () => {
        reorderSelection(commandContext, "sendToBack");
      }
    },
    [APP_MENU_COMMAND_IDS.SEND_BACKWARD]: {
      enabled: availability["reorder-sendBackward"].enabled,
      run: () => {
        reorderSelection(commandContext, "sendBackward");
      }
    },
    [APP_MENU_COMMAND_IDS.BRING_FORWARD]: {
      enabled: availability["reorder-bringForward"].enabled,
      run: () => {
        reorderSelection(commandContext, "bringForward");
      }
    },
    [APP_MENU_COMMAND_IDS.BRING_TO_FRONT]: {
      enabled: availability["reorder-bringToFront"].enabled,
      run: () => {
        reorderSelection(commandContext, "bringToFront");
      }
    },
    [APP_MENU_COMMAND_IDS.ALIGN_LEFT]: {
      enabled: availability["align-left"].enabled,
      run: () => {
        alignSelection(commandContext, "left");
      }
    },
    [APP_MENU_COMMAND_IDS.ALIGN_CENTER]: {
      enabled: availability["align-center"].enabled,
      run: () => {
        alignSelection(commandContext, "center");
      }
    },
    [APP_MENU_COMMAND_IDS.ALIGN_RIGHT]: {
      enabled: availability["align-right"].enabled,
      run: () => {
        alignSelection(commandContext, "right");
      }
    },
    [APP_MENU_COMMAND_IDS.ALIGN_TOP]: {
      enabled: availability["align-top"].enabled,
      run: () => {
        alignSelection(commandContext, "top");
      }
    },
    [APP_MENU_COMMAND_IDS.ALIGN_MIDDLE]: {
      enabled: availability["align-middle"].enabled,
      run: () => {
        alignSelection(commandContext, "middle");
      }
    },
    [APP_MENU_COMMAND_IDS.ALIGN_BOTTOM]: {
      enabled: availability["align-bottom"].enabled,
      run: () => {
        alignSelection(commandContext, "bottom");
      }
    },
    [APP_MENU_COMMAND_IDS.DISTRIBUTE_HORIZONTAL]: {
      enabled: availability["distribute-horizontal"].enabled,
      run: () => {
        distributeSelection(commandContext, "horizontal");
      }
    },
    [APP_MENU_COMMAND_IDS.DISTRIBUTE_VERTICAL]: {
      enabled: availability["distribute-vertical"].enabled,
      run: () => {
        distributeSelection(commandContext, "vertical");
      }
    },
    [APP_MENU_COMMAND_IDS.INSERT_NODE]: insertBinding("addNode"),
    [APP_MENU_COMMAND_IDS.INSERT_LINE]: insertBinding("addLine"),
    [APP_MENU_COMMAND_IDS.INSERT_ARROW]: insertBinding("addArrow"),
    [APP_MENU_COMMAND_IDS.INSERT_RECT]: insertBinding("addRect"),
    [APP_MENU_COMMAND_IDS.INSERT_ELLIPSE]: insertBinding("addEllipse"),
    [APP_MENU_COMMAND_IDS.INSERT_CIRCLE]: insertBinding("addCircle"),
    [APP_MENU_COMMAND_IDS.FIT_TO_CONTENT]: {
      enabled: snapshot.svg != null,
      run: () => dispatch({ type: "REQUEST_FIT_TO_CONTENT" })
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_GRID]: {
      enabled: true,
      checked: showGrid,
      run: () => dispatch({ type: "TOGGLE_CANVAS_AID", aid: "grid" })
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_SNAP_TO_GRID]: {
      enabled: true,
      checked: snapToGrid,
      run: () => dispatch({ type: "TOGGLE_SNAP_TO_GRID" })
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_RULERS]: {
      enabled: true,
      checked: showRulers,
      run: () => dispatch({ type: "TOGGLE_CANVAS_AID", aid: "rulers" })
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_GUIDES]: {
      enabled: true,
      checked: showGuides,
      run: () => dispatch({ type: "TOGGLE_CANVAS_AID", aid: "guides" })
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_SOURCE_PANEL]: {
      enabled: true,
      checked: showSourcePanel,
      run: () => dispatch({ type: "TOGGLE_PANEL", panel: "source" })
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_INSPECTOR_PANEL]: {
      enabled: true,
      checked: showInspectorPanel,
      run: () => dispatch({ type: "TOGGLE_PANEL", panel: "inspector" })
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_DEV_PANEL]: {
      enabled: true,
      checked: showDevPanel,
      run: () => dispatch({ type: "TOGGLE_DEV_PANEL" })
    }
  };

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (!menuRootRef.current?.contains(target)) {
        setOpenSectionId(null);
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!openSectionId) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenSectionId(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSectionId]);

  useEffect(() => {
    if (!pendingAutoFit) {
      return;
    }
    if (snapshot.source !== source) {
      return;
    }
    dispatch({ type: "REQUEST_FIT_TO_CONTENT" });
    setPendingAutoFit(false);
  }, [dispatch, pendingAutoFit, snapshot.source, source]);

  const loadExampleIntoEditor = (example: TikzOpenExample) => {
    dispatch({ type: "CODE_EDITED", source: example.source });
    dispatch({ type: "CLEAR_SELECTION" });
    dispatch({ type: "SET_TOOL_MODE", mode: "select" });
    setShowOpenExampleModal(false);
    setPendingAutoFit(true);
  };

  return (
    <>
      <div
        className={css.menuBar}
        role="menubar"
        ref={menuRootRef}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setOpenSectionId(null);
          }
        }}
      >
        {APP_MENU_DEFINITION.map((section) => {
          const isOpen = openSectionId === section.id;
          return (
            <div
              key={section.id}
              className={css.section}
              onMouseEnter={() => {
                if (openSectionId && openSectionId !== section.id) {
                  setOpenSectionId(section.id);
                }
              }}
            >
              <button
                type="button"
                className={[css.trigger, isOpen ? css.triggerActive : ""].filter(Boolean).join(" ")}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onClick={() => {
                  setOpenSectionId((current) => current === section.id ? null : section.id);
                }}
              >
                {section.label}
              </button>

              {isOpen ? (
                <MenuPopup
                  items={section.items}
                  path={section.id}
                  nested={false}
                  bindings={bindings}
                  onCommandRun={() => setOpenSectionId(null)}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {showOpenExampleModal ? (
        <OpenExampleModal
          examples={OPEN_EXAMPLE_CATALOG}
          onClose={() => setShowOpenExampleModal(false)}
          onSelectExample={loadExampleIntoEditor}
        />
      ) : null}
    </>
  );
}
