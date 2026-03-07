import { useMemo } from "react";
import { APP_MENU_COMMAND_IDS, type AppMenuCommandId } from "tikz-editor/app-menu";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import type { EmitSvgResult } from "tikz-editor/svg/index";
import type { SessionSnapshot } from "../compute";
import { useEditorStore } from "../store/store";
import type { EditorAction, ToolMode } from "../store/types";
import { getToolCapabilityStatus } from "./capabilities";
import {
  actionAvailability,
  alignSelection,
  copySelection,
  cutSelection,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  pasteSelectionFromSystemClipboard,
  reorderSelection
} from "./editor-commands";
import { canExportSvg, copySvgMarkup, exportPdfDownload } from "./export-commands";
import { requestSourceFormat } from "./source-sync";

export type CommandOrigin = "menu" | "shortcut" | "context-menu";

export type CommandBinding = {
  enabled: boolean;
  checked?: boolean;
  run: (origin: CommandOrigin) => void;
};

export type CommandBindings = Record<AppMenuCommandId, CommandBinding>;

type Dispatch = (action: EditorAction) => void;

type RuntimeInput = {
  source: string;
  snapshot: SessionSnapshot;
  toolMode: ToolMode;
  selectedElementIds: ReadonlySet<string>;
  historyIndex: number;
  historyLength: number;
  showGrid: boolean;
  snapToGrid: boolean;
  showRulers: boolean;
  showGuides: boolean;
  showSourcePanel: boolean;
  showInspectorPanel: boolean;
  showDevPanel: boolean;
  dispatch: Dispatch;
  onOpenExample?: () => void;
  onOpenSvgExport?: (svgResult: EmitSvgResult) => void;
  onOpenPngExport?: (svgResult: EmitSvgResult) => void;
  onAddNodeAdornment?: (kind: "label" | "pin") => void;
  onShowCompiledPicture?: () => void;
  onOpenSettings?: () => void;
};

export type EditorCommandRuntime = {
  bindings: CommandBindings;
  runCommand: (commandId: AppMenuCommandId, origin: CommandOrigin) => boolean;
};

export function createEditorCommandRuntime(input: RuntimeInput): EditorCommandRuntime {
  const {
    source,
    snapshot,
    toolMode,
    selectedElementIds,
    historyIndex,
    historyLength,
    showGrid,
    snapToGrid,
    showRulers,
    showGuides,
    showSourcePanel,
    showInspectorPanel,
    showDevPanel,
    dispatch,
    onOpenExample,
    onOpenSvgExport,
    onOpenPngExport,
    onAddNodeAdornment,
    onShowCompiledPicture,
    onOpenSettings
  } = input;

  const commandContext = {
    source,
    snapshotSource: snapshot.source,
    scene: snapshot.scene,
    editHandles: snapshot.editHandles,
    selectedElementIds,
    dispatch
  };

  const availability = actionAvailability(commandContext);
  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < historyLength - 1;
  const canExport = canExportSvg(snapshot.svg);

  const insertBinding = (mode: ToolMode): CommandBinding => {
    const capability = getToolCapabilityStatus(mode);
    return {
      enabled: capability.status !== "unsupported",
      checked: toolMode === mode,
      run: () => dispatch({ type: "SET_TOOL_MODE", mode })
    };
  };

  const runSvgExport = () => {
    if (!snapshot.svg) {
      return;
    }
    onOpenSvgExport?.(snapshot.svg);
  };

  const runSvgCopy = () => {
    if (!snapshot.svg) {
      return;
    }
    void copySvgMarkup(snapshot.svg);
  };

  const runPdfDownload = () => {
    if (!snapshot.svg) {
      return;
    }
    void exportPdfDownload(snapshot.svg, { fileName: "tikz-export.pdf" });
  };

  const runPngExport = () => {
    if (!snapshot.svg) {
      return;
    }
    onOpenPngExport?.(snapshot.svg);
  };

  const singleSelectedId = selectedElementIds.size === 1 ? [...selectedElementIds][0] ?? null : null;
  const canAddAdornment =
    singleSelectedId != null &&
    (() => {
      const resolved = resolvePropertyTarget(source, singleSelectedId);
      return (
        resolved.kind === "found" &&
        (resolved.target.kind === "node-item" ||
          (resolved.target.kind === "path-statement" && resolved.target.pathCommand === "node"))
      );
    })();

  const bindings: CommandBindings = {
    [APP_MENU_COMMAND_IDS.OPEN_EXAMPLE]: {
      enabled: onOpenExample != null,
      run: () => onOpenExample?.()
    },
    [APP_MENU_COMMAND_IDS.EXPORT_TIKZ]: {
      enabled: false,
      run: () => undefined
    },
    [APP_MENU_COMMAND_IDS.SHOW_COMPILED_PICTURE]: {
      enabled: onShowCompiledPicture != null,
      run: () => onShowCompiledPicture?.()
    },
    [APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD]: {
      enabled: canExport && onOpenSvgExport != null,
      run: runSvgExport
    },
    [APP_MENU_COMMAND_IDS.EXPORT_SVG_COPY]: {
      enabled: canExport,
      run: runSvgCopy
    },
    [APP_MENU_COMMAND_IDS.EXPORT_PDF_DOWNLOAD]: {
      enabled: canExport,
      run: runPdfDownload
    },
    [APP_MENU_COMMAND_IDS.EXPORT_PNG_DOWNLOAD]: {
      enabled: canExport && onOpenPngExport != null,
      run: runPngExport
    },
    [APP_MENU_COMMAND_IDS.UNDO]: {
      enabled: canUndo,
      run: () => dispatch({ type: "UNDO" })
    },
    [APP_MENU_COMMAND_IDS.REDO]: {
      enabled: canRedo,
      run: () => dispatch({ type: "REDO" })
    },
    [APP_MENU_COMMAND_IDS.FORMAT_TIKZ]: {
      enabled: showSourcePanel,
      run: (origin) => {
        requestSourceFormat({ reason: origin === "shortcut" ? "shortcut" : "menu" });
      }
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
      enabled: true,
      run: () => {
        void pasteSelectionFromSystemClipboard(commandContext).then((result) => {
          if (result.kind !== "failure" || result.reason === "empty") {
            return;
          }
          const alertFn = (globalThis as { alert?: (message?: string) => void }).alert;
          if (typeof alertFn === "function") {
            alertFn("Clipboard access was blocked. Focus the canvas and press Cmd/Ctrl+V to paste.");
          }
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
    [APP_MENU_COMMAND_IDS.INSERT_BEZIER]: insertBinding("addBezier"),
    [APP_MENU_COMMAND_IDS.INSERT_GRID]: insertBinding("addGrid"),
    [APP_MENU_COMMAND_IDS.INSERT_RECT]: insertBinding("addRect"),
    [APP_MENU_COMMAND_IDS.INSERT_ELLIPSE]: insertBinding("addEllipse"),
    [APP_MENU_COMMAND_IDS.INSERT_CIRCLE]: insertBinding("addCircle"),
    [APP_MENU_COMMAND_IDS.ADD_LABEL]: {
      enabled: canAddAdornment && onAddNodeAdornment != null,
      run: () => onAddNodeAdornment?.("label")
    },
    [APP_MENU_COMMAND_IDS.ADD_PIN]: {
      enabled: canAddAdornment && onAddNodeAdornment != null,
      run: () => onAddNodeAdornment?.("pin")
    },
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
    },
    [APP_MENU_COMMAND_IDS.OPEN_SETTINGS]: {
      enabled: onOpenSettings != null,
      run: () => onOpenSettings?.()
    }
  };

  return {
    bindings,
    runCommand: (commandId, origin) => {
      const binding = bindings[commandId];
      if (!binding || !binding.enabled) {
        return false;
      }
      binding.run(origin);
      return true;
    }
  };
}

export function useEditorCommandRuntime(
  options: {
    onOpenExample?: () => void;
    onOpenSvgExport?: (svgResult: EmitSvgResult) => void;
    onOpenPngExport?: (svgResult: EmitSvgResult) => void;
    onAddNodeAdornment?: (kind: "label" | "pin") => void;
    onShowCompiledPicture?: () => void;
    onOpenSettings?: () => void;
  } = {}
): EditorCommandRuntime {
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const toolMode = useEditorStore((s) => s.toolMode);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
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

  return useMemo(
    () =>
      createEditorCommandRuntime({
        source,
        snapshot,
        toolMode,
        selectedElementIds,
        historyIndex,
        historyLength,
        showGrid,
        snapToGrid,
        showRulers,
        showGuides,
        showSourcePanel,
        showInspectorPanel,
        showDevPanel,
        dispatch,
        onOpenExample: options.onOpenExample,
        onOpenSvgExport: options.onOpenSvgExport,
        onOpenPngExport: options.onOpenPngExport,
        onAddNodeAdornment: options.onAddNodeAdornment,
        onShowCompiledPicture: options.onShowCompiledPicture,
        onOpenSettings: options.onOpenSettings
      }),
    [
      source,
      snapshot,
      toolMode,
      selectedElementIds,
      historyIndex,
      historyLength,
      showGrid,
      snapToGrid,
      showRulers,
      showGuides,
      showSourcePanel,
      showInspectorPanel,
      showDevPanel,
      dispatch,
      options.onOpenExample,
      options.onOpenSvgExport,
      options.onOpenPngExport,
      options.onAddNodeAdornment,
      options.onShowCompiledPicture,
      options.onOpenSettings
    ]
  );
}
