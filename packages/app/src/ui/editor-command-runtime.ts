import { useMemo, useRef } from "react";
import { APP_MENU_COMMAND_IDS, type AppMenuCommandId } from "../app-menu";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import type { EditAnalysisView } from "tikz-editor/edit/analysis";
import type { EmitSvgResult } from "tikz-editor/svg/index";
import type { SessionSnapshot } from "../compute";
import { getSharedEditAnalysisView } from "../edit-analysis-manager";
import { getActiveEditorPlatform } from "../platform/current";
import type { AppSettings } from "../settings/types";
import { useSettingsStore } from "../settings/useSettingsStore";
import { useEditorStore } from "../store/store";
import type { DocumentFileRef, EditorAction, SnapModes, ToolMode } from "../store/types";
import { getToolCapabilityStatus } from "./capabilities";
import {
  actionAvailability,
  alignSelection,
  deleteSelectedPathPoint,
  flipSelection,
  copySelection,
  cutSelection,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  groupSelection,
  joinSelectedPaths,
  pasteSelectionFromSystemClipboard,
  reorderSelection,
  reverseSelectedPath,
  rotateSelection,
  ungroupSelection,
  setSelectedPathClosed,
  setSelectedPathPointKind,
  splitSelectedPath
} from "./editor-commands";

import { requestSourceFormat } from "./source-sync";
import { resolveOpenedFileForDocument } from "./svg-import";

export type CommandOrigin = "menu" | "shortcut" | "context-menu" | "platform";

export type CommandBinding = {
  enabled: boolean;
  checked?: boolean;
  run: (origin: CommandOrigin) => void;
};

export type CommandBindings = Record<AppMenuCommandId, CommandBinding>;

type Dispatch = (action: EditorAction) => void;

type RuntimeInput = {
  source: string;
  activeFigureId: string | null;
  editAnalysisView: EditAnalysisView | null;
  snapshot: SessionSnapshot;
  toolMode: ToolMode;
  selectedElementIds: ReadonlySet<string>;
  activeHandleId: string | null;
  historyIndex: number;
  historyLength: number;
  activeDocumentId: string;
  tabCount: number;
  dirty: boolean;
  fileRef: DocumentFileRef | null;
  showGrid: boolean;
  snapModes: SnapModes;
  snapHapticsEnabled: boolean;
  showRulers: boolean;
  showGuides: boolean;
  showSourcePanel: boolean;
  showInspectorPanel: boolean;
  rightSidebarTab: "inspector" | "objects" | "styles" | "assistant";
  assistantAvailable: boolean;
  assistantRunning: boolean;
  showDevPanel: boolean;
  indentSize?: 2 | 4;
  updateCanvasSettings: (patch: Partial<AppSettings["canvas"]>) => void;
  dispatch: Dispatch;
  onOpenExample?: () => void;
  onOpenSvgExport?: (svgResult: EmitSvgResult) => void;
  onOpenPngExport?: (svgResult: EmitSvgResult) => void;
  onRequestCloseDocument?: (documentId: string) => void;
  onRequestCloseAllDocuments?: () => void;
  onAddNodeAdornment?: (kind: "label" | "pin") => void;
  onShowCompiledPicture?: () => void;
  onOpenSettings?: () => void;
  onFocusAssistant?: () => void;
  onInterruptAssistant?: () => void;
};

export type EditorCommandRuntime = {
  bindings: CommandBindings;
  runCommand: (commandId: AppMenuCommandId, origin: CommandOrigin) => boolean;
};

export function createEditorCommandRuntime(input: RuntimeInput): EditorCommandRuntime {
  const {
    source,
    activeFigureId,
    editAnalysisView,
    snapshot,
    toolMode,
    selectedElementIds,
    activeHandleId,
    historyIndex,
    historyLength,
    activeDocumentId,
    tabCount,
    dirty,
    fileRef,
    showGrid,
    snapModes,
    snapHapticsEnabled,
    showRulers,
    showGuides,
    showSourcePanel,
    showInspectorPanel,
    rightSidebarTab,
    assistantAvailable,
    assistantRunning,
    showDevPanel,
    indentSize,
    updateCanvasSettings,
    dispatch,
    onOpenExample,
    onOpenSvgExport,
    onOpenPngExport,
    onRequestCloseDocument,
    onRequestCloseAllDocuments,
    onAddNodeAdornment,
    onShowCompiledPicture,
    onOpenSettings,
    onFocusAssistant,
    onInterruptAssistant
  } = input;
  const parseOptions = {
    activeFigureId,
    analysisView: editAnalysisView,
    indentSize: indentSize ?? 2
  };

  const commandContext = {
    source,
    activeFigureId,
    parseOptions,
    figureCount: snapshot.figures?.length ?? 0,
    snapshotSource: snapshot.source,
    scene: snapshot.scene,
    editHandles: snapshot.editHandles,
    selectedElementIds,
    activeHandleId,
    dispatch
  };

  const availability = actionAvailability(commandContext);
  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < historyLength - 1;
  const canExport = snapshot.svg != null;
  const canOpen = typeof getActiveEditorPlatform().files?.openText === "function";
  const canSave = typeof getActiveEditorPlatform().files?.saveText === "function";
  const canOpenExternalUrl = typeof getActiveEditorPlatform().window?.openExternalUrl === "function";
  const isMacDesktop =
    getActiveEditorPlatform().id.startsWith("desktop") &&
    typeof navigator !== "undefined" &&
    /(mac|iphone|ipad)/i.test(navigator.platform);

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
    void import("./export-commands").then((mod) => mod.copySvgMarkup(snapshot.svg!));
  };

  const runPdfDownload = () => {
    if (!snapshot.svg) {
      return;
    }
    void import("./export-commands").then((mod) => mod.exportPdfDownload(snapshot.svg!, { fileName: "tikz-export.pdf" }));
  };

  const runPngExport = () => {
    if (!snapshot.svg) {
      return;
    }
    onOpenPngExport?.(snapshot.svg);
  };

  const runStandaloneLatexDownload = () => {
    if (!snapshot.semanticResult) {
      return;
    }
    void import("./export-commands").then((mod) => mod.exportStandaloneLatexDownload(source, snapshot.semanticResult!.scene.requiredTikzLibraries, {
      fileName: "tikz-export.tex"
    }));
  };

  const runOpenDocument = (requireSvg = false) => {
    const openText = getActiveEditorPlatform().files?.openText;
    if (!openText) {
      return;
    }
    void openText().then(async (opened) => {
      if (!opened) {
        return;
      }
      const resolved = await resolveOpenedFileForDocument(opened, { requireSvg });
      if (resolved.kind === "failure") {
        const alertFn = (globalThis as { alert?: (message?: string) => void }).alert;
        if (typeof alertFn === "function") {
          alertFn(resolved.message);
        }
        return;
      }
      dispatch({ type: "NEW_DOCUMENT", source: resolved.source, title: resolved.title });
      dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: resolved.fileRef });
    });
  };

  const singleSelectedId = selectedElementIds.size === 1 ? [...selectedElementIds][0] ?? null : null;
  const canAddAdornment =
    singleSelectedId != null &&
    (() => {
      const resolved = resolvePropertyTarget(source, singleSelectedId, parseOptions);
      return (
        resolved.kind === "found" &&
        (resolved.target.kind === "node-item" ||
          (resolved.target.kind === "path-statement" && resolved.target.pathCommand === "node"))
      );
    })();

  const bindings: CommandBindings = {
    [APP_MENU_COMMAND_IDS.NEW_DOCUMENT]: {
      enabled: true,
      run: () => dispatch({ type: "NEW_DOCUMENT" })
    },
    [APP_MENU_COMMAND_IDS.OPEN_DOCUMENT]: {
      enabled: canOpen,
      run: () => runOpenDocument(false)
    },
    [APP_MENU_COMMAND_IDS.IMPORT_SVG]: {
      enabled: canOpen,
      run: () => runOpenDocument(true)
    },
    [APP_MENU_COMMAND_IDS.CLEAR_RECENT_FILES]: {
      enabled: typeof getActiveEditorPlatform().files?.clearRecentFiles === "function",
      run: () => {
        void getActiveEditorPlatform().files?.clearRecentFiles?.();
      }
    },
    [APP_MENU_COMMAND_IDS.SAVE_DOCUMENT]: {
      enabled: canSave,
      run: () => {
        const saveText = getActiveEditorPlatform().files?.saveText;
        if (!saveText) {
          return;
        }
        void saveText(source, {
          suggestedName: fileRef?.name ?? "tikz-document.tex",
          fileRef,
          mode: "save"
        }).then((result) => {
          if (result.status !== "saved") {
            return;
          }
          dispatch({
            type: "MARK_DOCUMENT_SAVED",
            documentId: activeDocumentId,
            fileRef: result.fileRef
          });
        });
      }
    },
    [APP_MENU_COMMAND_IDS.SAVE_DOCUMENT_AS]: {
      enabled: canSave,
      run: () => {
        const saveText = getActiveEditorPlatform().files?.saveText;
        if (!saveText) {
          return;
        }
        void saveText(source, {
          suggestedName: fileRef?.name ?? "tikz-document.tex",
          fileRef,
          mode: "save-as"
        }).then((result) => {
          if (result.status !== "saved") {
            return;
          }
          dispatch({
            type: "MARK_DOCUMENT_SAVED",
            documentId: activeDocumentId,
            fileRef: result.fileRef
          });
        });
      }
    },
    [APP_MENU_COMMAND_IDS.CLOSE_DOCUMENT]: {
      enabled: tabCount > 0,
      run: () => {
        if (onRequestCloseDocument) {
          onRequestCloseDocument(activeDocumentId);
          return;
        }
        dispatch({ type: "CLOSE_DOCUMENT", documentId: activeDocumentId });
      }
    },
    [APP_MENU_COMMAND_IDS.CLOSE_ALL_DOCUMENTS]: {
      enabled: tabCount > 1 || dirty,
      run: () => {
        if (onRequestCloseAllDocuments) {
          onRequestCloseAllDocuments();
          return;
        }
        dispatch({ type: "CLOSE_ALL_DOCUMENTS" });
      }
    },
    [APP_MENU_COMMAND_IDS.OPEN_EXAMPLE]: {
      enabled: onOpenExample != null,
      run: () => onOpenExample?.()
    },
    [APP_MENU_COMMAND_IDS.SHOW_COMPILED_PICTURE]: {
      enabled: onShowCompiledPicture != null,
      run: () => onShowCompiledPicture?.()
    },
    [APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD]: {
      enabled: canExport && onOpenSvgExport != null,
      run: runSvgExport
    },
    [APP_MENU_COMMAND_IDS.EXPORT_STANDALONE_LATEX_DOWNLOAD]: {
      enabled: snapshot.semanticResult != null,
      run: runStandaloneLatexDownload
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
    [APP_MENU_COMMAND_IDS.GROUP]: {
      enabled: availability.group.enabled,
      run: () => {
        groupSelection(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.UNGROUP]: {
      enabled: availability.ungroup.enabled,
      run: () => {
        ungroupSelection(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.ROTATE_LEFT_90]: {
      enabled: availability["transform-rotateLeft90"].enabled,
      run: () => {
        rotateSelection(commandContext, "left");
      }
    },
    [APP_MENU_COMMAND_IDS.ROTATE_RIGHT_90]: {
      enabled: availability["transform-rotateRight90"].enabled,
      run: () => {
        rotateSelection(commandContext, "right");
      }
    },
    [APP_MENU_COMMAND_IDS.FLIP_HORIZONTAL]: {
      enabled: availability["transform-flipHorizontal"].enabled,
      run: () => {
        flipSelection(commandContext, "horizontal");
      }
    },
    [APP_MENU_COMMAND_IDS.FLIP_VERTICAL]: {
      enabled: availability["transform-flipVertical"].enabled,
      run: () => {
        flipSelection(commandContext, "vertical");
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
    [APP_MENU_COMMAND_IDS.PATH_SPLIT]: {
      enabled: availability["path-split"].enabled,
      run: () => {
        splitSelectedPath(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_JOIN]: {
      enabled: availability["path-join"].enabled,
      run: () => {
        joinSelectedPaths(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_REVERSE]: {
      enabled: availability["path-reverse"].enabled,
      run: () => {
        reverseSelectedPath(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_CLOSE]: {
      enabled: availability["path-close"].enabled,
      run: () => {
        setSelectedPathClosed(commandContext, true);
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_OPEN]: {
      enabled: availability["path-open"].enabled,
      run: () => {
        setSelectedPathClosed(commandContext, false);
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_DELETE_POINT]: {
      enabled: availability["path-delete-point"].enabled,
      run: () => {
        deleteSelectedPathPoint(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_POINT_CORNER]: {
      enabled: availability["path-point-corner"].enabled,
      run: () => {
        setSelectedPathPointKind(commandContext, "corner");
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_POINT_SMOOTH]: {
      enabled: availability["path-point-smooth"].enabled,
      run: () => {
        setSelectedPathPointKind(commandContext, "smooth");
      }
    },
    [APP_MENU_COMMAND_IDS.INSERT_NODE]: insertBinding("addNode"),
    [APP_MENU_COMMAND_IDS.INSERT_SHAPE]: insertBinding("addShape"),
    [APP_MENU_COMMAND_IDS.INSERT_PATH]: insertBinding("addPath"),
    [APP_MENU_COMMAND_IDS.INSERT_FREEHAND]: insertBinding("addFreehand"),
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
    [APP_MENU_COMMAND_IDS.ZOOM_IN]: {
      enabled: snapshot.svg != null,
      run: () => dispatch({ type: "REQUEST_ZOOM", direction: "in" })
    },
    [APP_MENU_COMMAND_IDS.ZOOM_OUT]: {
      enabled: snapshot.svg != null,
      run: () => dispatch({ type: "REQUEST_ZOOM", direction: "out" })
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_GRID]: {
      enabled: true,
      checked: showGrid,
      run: () => dispatch({ type: "TOGGLE_CANVAS_AID", aid: "grid" })
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GRID]: {
      enabled: true,
      checked: snapModes.grid,
      run: () => dispatch({ type: "TOGGLE_SNAP_MODE", mode: "grid" })
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GUIDES]: {
      enabled: true,
      checked: snapModes.guides,
      run: () => dispatch({ type: "TOGGLE_SNAP_MODE", mode: "guides" })
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_POINTS]: {
      enabled: true,
      checked: snapModes.points,
      run: () => dispatch({ type: "TOGGLE_SNAP_MODE", mode: "points" })
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_GAPS]: {
      enabled: true,
      checked: snapModes.gaps,
      run: () => dispatch({ type: "TOGGLE_SNAP_MODE", mode: "gaps" })
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_SNAP_HAPTICS]: {
      enabled: isMacDesktop,
      checked: snapHapticsEnabled,
      run: () => updateCanvasSettings({ snapHapticsEnabled: !snapHapticsEnabled })
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
    [APP_MENU_COMMAND_IDS.TOGGLE_ASSISTANT_PANEL]: {
      enabled: assistantAvailable,
      checked: assistantAvailable && rightSidebarTab === "assistant",
      run: () => onFocusAssistant?.()
    },
    [APP_MENU_COMMAND_IDS.INTERRUPT_ASSISTANT_TURN]: {
      enabled: assistantAvailable && assistantRunning,
      run: () => onInterruptAssistant?.()
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_DEV_PANEL]: {
      enabled: true,
      checked: showDevPanel,
      run: () => dispatch({ type: "TOGGLE_DEV_PANEL" })
    },
    [APP_MENU_COMMAND_IDS.OPEN_SETTINGS]: {
      enabled: onOpenSettings != null,
      run: () => onOpenSettings?.()
    },
    [APP_MENU_COMMAND_IDS.OPEN_PGF_TIKZ_MANUAL]: {
      enabled: canOpenExternalUrl,
      run: () => {
        const openExternalUrl = getActiveEditorPlatform().window?.openExternalUrl;
        if (typeof openExternalUrl !== "function") {
          return;
        }
        void openExternalUrl("https://tikz.dev");
      }
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
    onRequestCloseDocument?: (documentId: string) => void;
    onRequestCloseAllDocuments?: () => void;
    onAddNodeAdornment?: (kind: "label" | "pin") => void;
    onShowCompiledPicture?: () => void;
    onOpenSettings?: () => void;
    onFocusAssistant?: () => void;
    onInterruptAssistant?: () => void;
    activeHandleIdOverride?: string | null;
  } = {}
): EditorCommandRuntime {
  const source = useEditorStore((s) => s.source);
  const activeFigureId = useEditorStore((s) => s.activeFigureId);
  const sourceRevision = useEditorStore((s) => s.sourceRevision);
  const snapshot = useEditorStore((s) => s.snapshot);
  const toolMode = useEditorStore((s) => s.toolMode);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const activeHandleId = useEditorStore((s) => s.activeHandleId);
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const historyIndex = useEditorStore((s) => s.historyIndex);
  const historyLength = useEditorStore((s) => s.history.length);
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const tabCount = useEditorStore((s) => s.tabOrder.length);
  const dirty = useEditorStore((s) => s.documents[s.activeDocumentId]?.dirty ?? false);
  const fileRef = useEditorStore((s) => s.documents[s.activeDocumentId]?.fileRef ?? null);
  const showGrid = useEditorStore((s) => s.showGrid);
  const snapModes = useEditorStore((s) => s.snapModes);
  const snapHapticsEnabled = useSettingsStore((s) => s.settings.canvas.snapHapticsEnabled);
  const showRulers = useEditorStore((s) => s.showRulers);
  const showGuides = useEditorStore((s) => s.showGuides);
  const showSourcePanel = useEditorStore((s) => s.showSourcePanel);
  const showInspectorPanel = useEditorStore((s) => s.showInspectorPanel);
  const rightSidebarTab = useEditorStore((s) => s.rightSidebarTab);
  const assistantRunning = useEditorStore((s) => {
    const doc = s.documents[s.activeDocumentId];
    return doc?.assistantTurnStatus === "starting" || doc?.assistantTurnStatus === "inProgress";
  });
  const showDevPanel = useEditorStore((s) => s.showDevPanel);
  const indentSize = useSettingsStore((s) => s.settings.editor.indentSize);
  const updateCanvasSettings = useSettingsStore((s) => s.updateCanvasSettings);
  const dispatch = useEditorStore((s) => s.dispatch);
  const assistantAvailable = typeof getActiveEditorPlatform().assistant?.startTurn === "function";
  const effectiveActiveHandleId = options.activeHandleIdOverride !== undefined
    ? options.activeHandleIdOverride
    : activeHandleId;
  const liveCommandInputs = useMemo(
    () => ({
      source,
      activeFigureId,
      sourceRevision,
      snapshot,
      selectedElementIds,
      activeHandleId: effectiveActiveHandleId
    }),
    [activeFigureId, effectiveActiveHandleId, selectedElementIds, snapshot, source, sourceRevision]
  );
  const frozenCommandInputsRef = useRef(liveCommandInputs);
  if (!activeCanvasDragKind) {
    frozenCommandInputsRef.current = liveCommandInputs;
  }
  const effectiveCommandInputs = activeCanvasDragKind
    ? frozenCommandInputsRef.current
    : liveCommandInputs;
  const editAnalysisView = useMemo(
    () =>
      getSharedEditAnalysisView({
        documentId: activeDocumentId,
        sourceRevision: effectiveCommandInputs.sourceRevision,
        source: effectiveCommandInputs.source,
        activeFigureId: effectiveCommandInputs.activeFigureId,
        snapshot: effectiveCommandInputs.snapshot
      }),
    [
      activeDocumentId,
      effectiveCommandInputs.activeFigureId,
      effectiveCommandInputs.snapshot,
      effectiveCommandInputs.source,
      effectiveCommandInputs.sourceRevision
    ]
  );

  return useMemo(
    () =>
      createEditorCommandRuntime({
        source: effectiveCommandInputs.source,
        activeFigureId: effectiveCommandInputs.activeFigureId,
        editAnalysisView,
        snapshot: effectiveCommandInputs.snapshot,
        toolMode,
        selectedElementIds: effectiveCommandInputs.selectedElementIds,
        activeHandleId: effectiveCommandInputs.activeHandleId,
        historyIndex,
        historyLength,
        activeDocumentId,
        tabCount,
        dirty,
        fileRef,
        showGrid,
        snapModes,
        snapHapticsEnabled,
        showRulers,
        showGuides,
        showSourcePanel,
        showInspectorPanel,
        rightSidebarTab,
        assistantAvailable,
        assistantRunning,
        showDevPanel,
        indentSize,
        updateCanvasSettings,
        dispatch,
        onOpenExample: options.onOpenExample,
        onOpenSvgExport: options.onOpenSvgExport,
        onOpenPngExport: options.onOpenPngExport,
        onRequestCloseDocument: options.onRequestCloseDocument,
        onRequestCloseAllDocuments: options.onRequestCloseAllDocuments,
        onAddNodeAdornment: options.onAddNodeAdornment,
        onShowCompiledPicture: options.onShowCompiledPicture,
        onOpenSettings: options.onOpenSettings,
        onFocusAssistant: options.onFocusAssistant,
        onInterruptAssistant: options.onInterruptAssistant
      }),
    [
      editAnalysisView,
      effectiveCommandInputs,
      toolMode,
      historyIndex,
      historyLength,
      activeDocumentId,
      tabCount,
      dirty,
      fileRef,
      showGrid,
      snapModes,
      snapHapticsEnabled,
      showRulers,
      showGuides,
      showSourcePanel,
      showInspectorPanel,
      activeCanvasDragKind,
      rightSidebarTab,
      assistantAvailable,
      assistantRunning,
      showDevPanel,
      indentSize,
      updateCanvasSettings,
      dispatch,
      options.onOpenExample,
      options.onOpenSvgExport,
      options.onOpenPngExport,
      options.onRequestCloseDocument,
      options.onRequestCloseAllDocuments,
      options.onAddNodeAdornment,
      options.onShowCompiledPicture,
      options.onOpenSettings,
      options.onFocusAssistant,
      options.onInterruptAssistant
    ]
  );
}
