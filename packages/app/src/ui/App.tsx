import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { APP_MENU_COMMAND_IDS, APP_MENU_DEFINITION, filterAppMenuDefinitionForTarget } from "../app-menu";
import { useEditorStore } from "../store/store";
import { computeSnapshot, makeEmptySnapshot, type ComputeRequest, type ComputeResponse } from "../compute";
import { AppMenuBar } from "./AppMenuBar";
import { Toolbar } from "./Toolbar";
import { ResizableLayout } from "./ResizableLayout";
import { StatusBar } from "./StatusBar";
import { isCodeMirrorEventTarget } from "./editor-commands";
import { useEditorCommandRuntime } from "./editor-command-runtime";
import { toolModeFromShortcut } from "./tool-config";
import { createSingleFlightScheduler } from "./compute-scheduler";
import { computeTrigger } from "./compute-trigger";
import { useSettingsStore } from "../settings/useSettingsStore";
import { getActiveEditorPlatform } from "../platform/current";
import css from "./App.module.css";
import "./variables.css";
import { TabStrip } from "./TabStrip";
import { UnsavedChangesModal, type UnsavedChangesDecision } from "./UnsavedChangesModal";
import { collectDirtyDocumentIdsForIntent, type CloseIntent } from "./close-guard";
import { OPEN_EXAMPLE_CATALOG, type TikzOpenExample } from "./examples/open-example-catalog";
import { OpenExampleModal } from "./OpenExampleModal";
import { SettingsModal } from "./SettingsModal";
import type { EmitSvgResult } from "tikz-editor/svg/index";
import { SvgExportModal } from "./SvgExportModal";
import { PngExportModal } from "./PngExportModal";
import { TikzJaxModal } from "./TikzJaxModal";
import { RightSidebar } from "./RightSidebar";
import { renderPngExport } from "./export-commands";
import type { AssistantEvent } from "../platform/types";

const SourcePanel = lazy(async () => {
  const mod = await import("./SourcePanel");
  return { default: mod.SourcePanel };
});

const CanvasPanel = lazy(async () => {
  const mod = await import("./CanvasPanel");
  return { default: mod.CanvasPanel };
});

const DevPanel = lazy(async () => {
  const mod = await import("./DevPanel");
  return { default: mod.DevPanel };
});

function menuTargetFromPlatformId(platformId: string): "desktop" | "web" {
  if (platformId.startsWith("desktop")) {
    return "desktop";
  }
  return "web";
}

export function App() {
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const pendingRequestId = useEditorStore((s) => s.pendingRequestId);
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const documents = useEditorStore((s) => s.documents);
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const toolMode = useEditorStore((s) => s.toolMode);
  const lastEditChangedSourceIds = useEditorStore((s) => s.lastEditChangedSourceIds);
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const activeSourceScrubSourceId = useEditorStore((s) => s.activeSourceScrubSourceId);
  const hoveredElementId = useEditorStore((s) => s.hoveredElementId);
  const uiFontSizePx = useSettingsStore((s) => s.settings.general.uiFontSizePx);
  const dispatch = useEditorStore((s) => s.dispatch);
  const platform = getActiveEditorPlatform();
  const menuTarget = menuTargetFromPlatformId(platform.id);
  const menuDefinition = useMemo(() => filterAppMenuDefinitionForTarget(APP_MENU_DEFINITION, menuTarget), [menuTarget]);
  const [showOpenExampleModal, setShowOpenExampleModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [compiledPictureSource, setCompiledPictureSource] = useState<string | null>(null);
  const [svgExportSvgResult, setSvgExportSvgResult] = useState<EmitSvgResult | null>(null);
  const [pngExportSvgResult, setPngExportSvgResult] = useState<EmitSvgResult | null>(null);
  const [pendingAutoFit, setPendingAutoFit] = useState(false);
  const [pendingClose, setPendingClose] = useState<{ intent: CloseIntent; dirtyDocumentIds: string[] } | null>(null);
  const requestCloseIntentRef = useRef<(intent: CloseIntent) => void>(() => undefined);
  const computeSchedulerRef = useRef<ReturnType<typeof createSingleFlightScheduler<ComputeRequest, ComputeResponse>> | null>(null);
  const sourceRef = useRef(source);
  const snapshotRef = useRef(snapshot);
  const activeDocumentIdRef = useRef(activeDocumentId);
  const documentsRef = useRef(documents);

  function executeCloseIntent(intent: CloseIntent): void {
    if (intent.kind === "close-document") {
      dispatch({ type: "CLOSE_DOCUMENT", documentId: intent.documentId });
      return;
    }
    if (intent.kind === "close-all") {
      dispatch({ type: "CLOSE_ALL_DOCUMENTS" });
      return;
    }
    void getActiveEditorPlatform().window?.close?.();
  }

  function requestCloseIntent(intent: CloseIntent): void {
    const dirtyDocumentIds = collectDirtyDocumentIdsForIntent(intent, documents, tabOrder);
    if (dirtyDocumentIds.length === 0) {
      executeCloseIntent(intent);
      return;
    }
    setPendingClose({ intent, dirtyDocumentIds });
  }

  requestCloseIntentRef.current = requestCloseIntent;

  const commandRuntime = useEditorCommandRuntime({
    onOpenExample: () => {
      setShowOpenExampleModal(true);
    },
    onOpenExampleInNewTab: () => {
      setShowOpenExampleModal(true);
    },
    onOpenSvgExport: (svgResult) => {
      setSvgExportSvgResult(svgResult);
    },
    onOpenPngExport: (svgResult) => {
      setPngExportSvgResult(svgResult);
    },
    onShowCompiledPicture: () => {
      setCompiledPictureSource(source);
    },
    onOpenSettings: () => {
      setShowSettingsModal(true);
    },
    onFocusAssistant: () => {
      dispatch({ type: "SET_RIGHT_SIDEBAR_TAB", tab: "assistant" });
    },
    onInterruptAssistant: () => {
      void platform.assistant?.interruptTurn?.({ documentId: activeDocumentId });
    },
    onRequestCloseDocument: (documentId) => {
      requestCloseIntent({ kind: "close-document", documentId });
    },
    onRequestCloseAllDocuments: () => {
      requestCloseIntent({ kind: "close-all" });
    }
  });

  useEffect(() => {
    sourceRef.current = source;
    snapshotRef.current = snapshot;
    activeDocumentIdRef.current = activeDocumentId;
    documentsRef.current = documents;
  }, [activeDocumentId, documents, snapshot, source]);

  const activeAssistantDoc = documents[activeDocumentId];

  useEffect(() => {
    const scheduler = createSingleFlightScheduler<ComputeRequest, ComputeResponse>({
      run: (request) => computeSnapshot(request),
      onSuccess: (_request, response) => {
        if ((_request.kind ?? "render") === "prewarm") {
          return;
        }
        dispatch({
          type: "SNAPSHOT_READY",
          requestId: response.id,
          snapshot: response.snapshot,
          documentId: response.documentId
        });
      },
      onError: (request) => {
        if ((request.kind ?? "render") === "prewarm") {
          return;
        }
        dispatch({
          type: "SNAPSHOT_READY",
          requestId: request.id,
          snapshot: makeEmptySnapshot(request.source),
          documentId: request.documentId
        });
      }
    });
    computeSchedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      computeSchedulerRef.current = null;
    };
  }, [dispatch]);

  // ── Compute pipeline ─────────────────────────────────────────────────────────
  // Keep at most one in-flight compute; while in-flight, coalesce to the latest source.
  useEffect(() => {
    const scheduler = computeSchedulerRef.current;
    if (!scheduler) {
      return;
    }
    const requestId = crypto.randomUUID();
    dispatch({ type: "COMPUTE_REQUESTED", requestId, documentId: activeDocumentId });
    const changedSourceIds = lastEditChangedSourceIds ?? (activeSourceScrubSourceId ? [activeSourceScrubSourceId] : null);
    scheduler.schedule({
      id: requestId,
      documentId: activeDocumentId,
      kind: "render",
      source,
      changedSourceIds,
      trigger: computeTrigger(activeCanvasDragKind, activeSourceScrubSourceId)
    });
  }, [activeCanvasDragKind, activeDocumentId, activeSourceScrubSourceId, dispatch, lastEditChangedSourceIds, source]);

  useEffect(() => {
    const scheduler = computeSchedulerRef.current;
    if (!scheduler) {
      return;
    }
    if (activeCanvasDragKind) {
      return;
    }
    if (activeSourceScrubSourceId) {
      return;
    }
    if (pendingRequestId != null) {
      return;
    }
    if (!hoveredElementId) {
      return;
    }
    if (snapshot.source !== source) {
      return;
    }

    const timer = window.setTimeout(() => {
      scheduler.schedule({
        id: crypto.randomUUID(),
        documentId: activeDocumentId,
        kind: "prewarm",
        source,
        changedSourceIds: [hoveredElementId],
        trigger: "drag-element"
      });
    }, 120);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeCanvasDragKind, activeDocumentId, activeSourceScrubSourceId, hoveredElementId, pendingRequestId, snapshot.source, source]);

  useEffect(() => {
    if (!platform.assistant?.bindEvents) {
      return;
    }
    const assistantApi = platform.assistant;
    const bindAssistantEvents = assistantApi.bindEvents!;

    async function respondToDynamicTool(event: Extract<AssistantEvent, { type: "dynamic-tool-call" }>): Promise<void> {
      const doc = documentsRef.current[event.documentId];
      if (!doc) {
        return;
      }
      const sourceForDoc = event.documentId === activeDocumentIdRef.current ? sourceRef.current : doc.source;
      const snapshotForDoc = event.documentId === activeDocumentIdRef.current ? snapshotRef.current : doc.snapshot;
      let result: { success?: boolean; contentItems?: unknown[] } = {
        success: false,
        contentItems: [{ type: "inputText", text: "Preview could not be rendered." }]
      };

      if (snapshotForDoc.svg && snapshotForDoc.source === sourceForDoc) {
        try {
          const rendered = await renderPngExport(snapshotForDoc.svg, { dpi: 144 });
          const pngBase64 = await blobToBase64(rendered.blob);
          const dataUrl = `data:${rendered.artifact.mimeType};base64,${pngBase64}`;
          result = {
            success: true,
            contentItems: [
              { type: "inputText", text: "Rendered an updated PNG preview for the current figure." },
              { type: "inputImage", imageUrl: dataUrl }
            ]
          };
        } catch (error) {
          result = {
            success: false,
            contentItems: [{ type: "inputText", text: error instanceof Error ? error.message : String(error) }]
          };
        }
      }

      await assistantApi.respondToDynamicToolCall?.({
        documentId: event.documentId,
        requestId: event.requestId,
        result
      });
    }

    const unbind = bindAssistantEvents((event) => {
      switch (event.type) {
        case "thread-ready":
          dispatch({
            type: "ASSISTANT_THREAD_READY",
            documentId: event.documentId,
            threadId: event.thread.threadId,
            workspacePath: event.thread.workspacePath,
            figurePath: event.thread.figurePath,
            previewPath: event.thread.previewPath
          });
          break;
        case "thread-state":
          dispatch({ type: "ASSISTANT_THREAD_LOADED", documentId: event.documentId, state: event.state });
          break;
        case "turn-status":
          dispatch({
            type: "ASSISTANT_TURN_STATUS",
            documentId: event.documentId,
            status: event.status,
            turnId: event.turnId ?? null,
            error: event.error ?? null
          });
          break;
        case "item-started":
          dispatch({ type: "ASSISTANT_ITEM_STARTED", documentId: event.documentId, item: event.item });
          break;
        case "item-updated":
          dispatch({ type: "ASSISTANT_ITEM_UPDATED", documentId: event.documentId, item: event.item });
          break;
        case "item-completed":
          dispatch({ type: "ASSISTANT_ITEM_COMPLETED", documentId: event.documentId, item: event.item });
          break;
        case "item-delta":
          dispatch({
            type: "ASSISTANT_ITEM_DELTA",
            documentId: event.documentId,
            itemId: event.itemId,
            deltaType: event.deltaType,
            delta: event.delta
          });
          break;
        case "approval-requested":
          dispatch({ type: "ASSISTANT_APPROVAL_REQUESTED", documentId: event.documentId, approval: event.approval });
          break;
        case "approval-cleared":
          dispatch({ type: "ASSISTANT_APPROVAL_CLEARED", documentId: event.documentId, requestId: event.requestId });
          break;
        case "source-updated":
          dispatch({
            type: "ASSISTANT_SOURCE_UPDATED",
            documentId: event.documentId,
            source: event.source,
            revisionToken: event.revisionToken,
            historyMergeKey: `assistant-turn:${event.documentId}`
          });
          break;
        case "dynamic-tool-call":
          void respondToDynamicTool(event);
          break;
        case "error":
          dispatch({ type: "ASSISTANT_SET_ERROR", documentId: event.documentId, message: event.message });
          break;
      }
    });

    return typeof unbind === "function" ? unbind : undefined;
  }, [dispatch, platform.assistant]);

  useEffect(() => {
    const assistant = platform.assistant;
    if (!assistant?.ensureDocumentThread) {
      return;
    }
    void assistant.ensureDocumentThread({
      documentId: activeDocumentId,
      source,
      threadId: activeAssistantDoc?.assistantThreadId ?? null,
      workspacePath: activeAssistantDoc?.assistantWorkspacePath ?? null,
      figurePath: activeAssistantDoc?.assistantFigurePath ?? null,
      previewPath: activeAssistantDoc?.assistantPreviewPath ?? null
    }).then((thread) => {
      dispatch({
        type: "ASSISTANT_THREAD_READY",
        documentId: activeDocumentId,
        threadId: thread.threadId,
        workspacePath: thread.workspacePath,
        figurePath: thread.figurePath,
        previewPath: thread.previewPath
      });
      return assistant.loadThreadState?.({ documentId: activeDocumentId });
    }).then((state) => {
      if (state) {
        dispatch({ type: "ASSISTANT_THREAD_LOADED", documentId: activeDocumentId, state });
      }
    }).catch((error) => {
      dispatch({
        type: "ASSISTANT_SET_ERROR",
        documentId: activeDocumentId,
        message: error instanceof Error ? error.message : String(error)
      });
    });
  }, [
    activeAssistantDoc?.assistantFigurePath,
    activeAssistantDoc?.assistantPreviewPath,
    activeAssistantDoc?.assistantThreadId,
    activeAssistantDoc?.assistantWorkspacePath,
    activeDocumentId,
    dispatch,
    platform.assistant,
    source
  ]);

  useEffect(() => {
    const assistant = platform.assistant;
    if (!assistant?.syncSource || !activeAssistantDoc?.assistantThreadId) {
      return;
    }
    if (activeAssistantDoc.assistantTurnStatus === "starting" || activeAssistantDoc.assistantTurnStatus === "inProgress") {
      return;
    }
    const timer = window.setTimeout(() => {
      void assistant.syncSource?.({ documentId: activeDocumentId, source }).catch((error) => {
        dispatch({
          type: "ASSISTANT_SET_ERROR",
          documentId: activeDocumentId,
          message: error instanceof Error ? error.message : String(error)
        });
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeAssistantDoc?.assistantThreadId, activeAssistantDoc?.assistantTurnStatus, activeDocumentId, dispatch, platform.assistant, source]);

  async function buildCurrentPreviewBase64(): Promise<string | null> {
    if (!snapshot.svg || snapshot.source !== source) {
      return null;
    }
    const rendered = await renderPngExport(snapshot.svg, { dpi: 144 });
    return await blobToBase64(rendered.blob);
  }

  async function handleAssistantPrompt(prompt: string): Promise<void> {
    dispatch({ type: "SET_RIGHT_SIDEBAR_TAB", tab: "assistant" });
    dispatch({ type: "ASSISTANT_TURN_STATUS", documentId: activeDocumentId, status: "starting", turnId: null });
    try {
      const pngBase64 = await buildCurrentPreviewBase64();
      await platform.assistant?.startTurn?.({
        documentId: activeDocumentId,
        prompt,
        source,
        pngBase64
      });
    } catch (error) {
      dispatch({
        type: "ASSISTANT_TURN_STATUS",
        documentId: activeDocumentId,
        status: "failed",
        turnId: null,
        error: error instanceof Error ? error.message : String(error)
      });
      dispatch({
        type: "ASSISTANT_SET_ERROR",
        documentId: activeDocumentId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleInterruptAssistantTurn(): Promise<void> {
    try {
      await platform.assistant?.interruptTurn?.({ documentId: activeDocumentId });
    } catch (error) {
      dispatch({
        type: "ASSISTANT_SET_ERROR",
        documentId: activeDocumentId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  useEffect(() => {
    const unbind = getActiveEditorPlatform().menu?.bindCommandHandler?.((commandId) => {
      commandRuntime.runCommand(commandId, "platform");
    });
    return typeof unbind === "function" ? unbind : undefined;
  }, [commandRuntime]);

  useEffect(() => {
    const globalLike = globalThis as typeof globalThis & {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        setSource: (nextSource: string) => void;
      };
    };
    globalLike.__TIKZ_EDITOR_APP_TEST_API__ = {
      setSource: (nextSource) => {
        dispatch({ type: "CODE_EDITED", source: nextSource });
      }
    };
    return () => {
      delete globalLike.__TIKZ_EDITOR_APP_TEST_API__;
    };
  }, [dispatch]);

  useEffect(() => {
    const unbind = getActiveEditorPlatform().files?.bindOpenRequest?.((opened) => {
      dispatch({
        type: "NEW_DOCUMENT",
        source: opened.source,
        title: opened.fileRef?.name ?? "Opened document"
      });
      dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: opened.fileRef });
    });
    return typeof unbind === "function" ? unbind : undefined;
  }, [dispatch]);

  useEffect(() => {
    const unbind = getActiveEditorPlatform().window?.bindCloseRequest?.(() => {
      requestCloseIntentRef.current({ kind: "window-close" });
    });
    return typeof unbind === "function" ? unbind : undefined;
  }, []);

  useEffect(() => {
    getActiveEditorPlatform().window?.setDocumentState?.({
      title: "TikZ Editor",
      dirty: snapshot.source !== source
    });
  }, [snapshot.source, source]);

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

  useEffect(() => {
    const sync = platform.menu?.syncNativeMenu;
    if (typeof sync !== "function") {
      return;
    }
    const commandStates = Object.fromEntries(
      Object.entries(commandRuntime.bindings).map(([commandId, binding]) => [
        commandId,
        { enabled: binding.enabled, checked: binding.checked }
      ])
    ) as Record<keyof typeof commandRuntime.bindings, { enabled: boolean; checked?: boolean }>;
    void sync({
      definition: menuDefinition,
      commandStates
    });
  }, [commandRuntime.bindings, menuDefinition, platform.menu]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) {
        return;
      }

      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && key === "f") {
        if (commandRuntime.runCommand(APP_MENU_COMMAND_IDS.FORMAT_TIKZ, "shortcut")) {
          e.preventDefault();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && key === "a") {
        if (commandRuntime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_ASSISTANT_PANEL, "shortcut")) {
          e.preventDefault();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "n") {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.NEW_DOCUMENT, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "w") {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.CLOSE_DOCUMENT, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "s") {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.SAVE_DOCUMENT, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "o") {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.OPEN_DOCUMENT, "shortcut");
        e.preventDefault();
        return;
      }

      // Ctrl+Shift+D: toggle dev panel
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "d") {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_DEV_PANEL, "shortcut");
        e.preventDefault();
        return;
      }

      const target = e.target as HTMLElement | null;
      const inCodeMirror = isCodeMirrorEventTarget(target);
      if (inCodeMirror) return;
      const canvasShortcutContext = Boolean(
        target?.closest("[data-canvas-viewport=\"true\"]") ||
          (document.activeElement instanceof HTMLElement &&
            document.activeElement.closest("[data-canvas-viewport=\"true\"]"))
      );

      // Keep browser/field-native undo for editable fields outside CM.
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === "escape" && toolMode !== "select") {
        dispatch({ type: "SET_TOOL_MODE", mode: "select" });
        e.preventDefault();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const hasTextSelection = Boolean(window.getSelection()?.toString().trim());

        if (!e.shiftKey && key === "c") {
          if (!canvasShortcutContext || hasTextSelection) {
            return;
          }
          // Allow native copy event on the focused canvas viewport.
          return;
        }

        if (!e.shiftKey && key === "x") {
          if (!canvasShortcutContext || hasTextSelection) {
            return;
          }
          // Allow native cut event on the focused canvas viewport.
          return;
        }

        if (!e.shiftKey && key === "v") {
          if (!canvasShortcutContext) {
            return;
          }
          // Allow the native paste event to fire on the canvas viewport; CanvasPanel handles parsing.
          return;
        }

        if (!e.shiftKey && key === "d") {
          if (!canvasShortcutContext) {
            return;
          }
          commandRuntime.runCommand(APP_MENU_COMMAND_IDS.DUPLICATE, "shortcut");
          e.preventDefault();
          return;
        }
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const shortcutMode = toolModeFromShortcut(key);
        if (shortcutMode) {
          dispatch({ type: "SET_TOOL_MODE", mode: shortcutMode });
          e.preventDefault();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === "z") {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.UNDO, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && key === "z") || (!e.shiftKey && key === "y"))) {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.REDO, "shortcut");
        e.preventDefault();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    commandRuntime,
    dispatch,
    toolMode
  ]);

  const appStyle = {
    "--app-ui-font-size": `${uiFontSizePx}px`,
    "--app-ui-scale": `${uiFontSizePx / 11}`
  } as CSSProperties;

  const loadExampleIntoEditor = (example: TikzOpenExample) => {
    dispatch({ type: "OPEN_EXAMPLE_IN_NEW_TAB", source: example.source, title: example.title });
    setShowOpenExampleModal(false);
    setPendingAutoFit(true);
  };

  async function handleUnsavedDecision(decision: UnsavedChangesDecision): Promise<void> {
    if (!pendingClose) {
      return;
    }
    if (decision === "cancel") {
      setPendingClose(null);
      return;
    }
    if (decision === "discard") {
      const intent = pendingClose.intent;
      setPendingClose(null);
      executeCloseIntent(intent);
      return;
    }

    const saveText = getActiveEditorPlatform().files?.saveText;
    if (!saveText) {
      setPendingClose(null);
      return;
    }
    for (const documentId of pendingClose.dirtyDocumentIds) {
      const doc = documents[documentId];
      if (!doc || !doc.dirty) {
        continue;
      }
      const result = await saveText(doc.source, {
        mode: "save",
        fileRef: doc.fileRef,
        suggestedName: doc.fileRef?.name ?? "tikz-document.tex"
      });
      if (result.status === "saved") {
        dispatch({
          type: "MARK_DOCUMENT_SAVED",
          documentId,
          fileRef: result.fileRef
        });
        continue;
      }
      if (result.status === "failed") {
        const alertFn = (globalThis as { alert?: (message?: string) => void }).alert;
        if (typeof alertFn === "function") {
          alertFn(result.reason ?? "Save failed. Close action was cancelled.");
        }
      }
      setPendingClose(null);
      return;
    }
    const intent = pendingClose.intent;
    setPendingClose(null);
    executeCloseIntent(intent);
  }

  return (
    <div className={css.app} style={appStyle}>
      {platform.menu?.usesNativeMenuBar ? null : (
        <AppMenuBar
          definition={menuDefinition}
          bindings={commandRuntime.bindings}
        />
      )}
      <Toolbar />
      <TabStrip
        onRequestCloseDocument={(documentId) => {
          requestCloseIntent({ kind: "close-document", documentId });
        }}
      />
      <div className={css.body}>
        <ResizableLayout
          left={(
            <Suspense fallback={<div className={css.panelLoading}>Loading source editor…</div>}>
              <SourcePanel />
            </Suspense>
          )}
          center={(
            <Suspense fallback={<div className={css.panelLoading}>Loading canvas…</div>}>
              <CanvasPanel />
            </Suspense>
          )}
          right={<RightSidebar onSubmitPrompt={handleAssistantPrompt} onInterruptTurn={handleInterruptAssistantTurn} />}
        />
      </div>
      <StatusBar />
      <Suspense fallback={null}>
        <DevPanel />
      </Suspense>
      {showOpenExampleModal ? (
        <OpenExampleModal
          examples={OPEN_EXAMPLE_CATALOG}
          onClose={() => setShowOpenExampleModal(false)}
          onSelectExample={loadExampleIntoEditor}
        />
      ) : null}
      {compiledPictureSource !== null ? (
        <TikzJaxModal
          source={compiledPictureSource}
          onClose={() => setCompiledPictureSource(null)}
        />
      ) : null}
      {showSettingsModal ? (
        <SettingsModal onClose={() => setShowSettingsModal(false)} />
      ) : null}
      {svgExportSvgResult ? (
        <SvgExportModal
          svgResult={svgExportSvgResult}
          onClose={() => setSvgExportSvgResult(null)}
        />
      ) : null}
      {pngExportSvgResult ? (
        <PngExportModal
          svgResult={pngExportSvgResult}
          onClose={() => setPngExportSvgResult(null)}
        />
      ) : null}
      {pendingClose ? (
        <UnsavedChangesModal
          documentTitles={pendingClose.dirtyDocumentIds.map((id) => documents[id]?.title ?? "Untitled")}
          onChoose={(decision) => {
            void handleUnsavedDecision(decision);
          }}
        />
      ) : null}
    </div>
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}
