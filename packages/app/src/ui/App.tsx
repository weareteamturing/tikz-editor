import { Suspense, lazy, useEffect, useRef, type CSSProperties } from "react";
import { APP_MENU_COMMAND_IDS } from "../app-menu";
import { useEditorStore } from "../store/store";
import { computeSnapshot, makeEmptySnapshot, type ComputeRequest, type ComputeResponse } from "../compute";
import { AppMenuBar } from "./AppMenuBar";
import { Toolbar } from "./Toolbar";
import { ResizableLayout } from "./ResizableLayout";
import { InspectorPanel } from "./InspectorPanel";
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

export function App() {
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const pendingRequestId = useEditorStore((s) => s.pendingRequestId);
  const toolMode = useEditorStore((s) => s.toolMode);
  const lastEditChangedSourceIds = useEditorStore((s) => s.lastEditChangedSourceIds);
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const activeSourceScrubSourceId = useEditorStore((s) => s.activeSourceScrubSourceId);
  const hoveredElementId = useEditorStore((s) => s.hoveredElementId);
  const uiFontSizePx = useSettingsStore((s) => s.settings.general.uiFontSizePx);
  const dispatch = useEditorStore((s) => s.dispatch);
  const commandRuntime = useEditorCommandRuntime();
  const computeSchedulerRef = useRef<ReturnType<typeof createSingleFlightScheduler<ComputeRequest, ComputeResponse>> | null>(null);

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
          snapshot: response.snapshot
        });
      },
      onError: (request) => {
        if ((request.kind ?? "render") === "prewarm") {
          return;
        }
        dispatch({
          type: "SNAPSHOT_READY",
          requestId: request.id,
          snapshot: makeEmptySnapshot(request.source)
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
    dispatch({ type: "COMPUTE_REQUESTED", requestId });
    const changedSourceIds = lastEditChangedSourceIds ?? (activeSourceScrubSourceId ? [activeSourceScrubSourceId] : null);
    scheduler.schedule({
      id: requestId,
      kind: "render",
      source,
      changedSourceIds,
      trigger: computeTrigger(activeCanvasDragKind, activeSourceScrubSourceId)
    });
  }, [activeCanvasDragKind, activeSourceScrubSourceId, dispatch, lastEditChangedSourceIds, source]);

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
        kind: "prewarm",
        source,
        changedSourceIds: [hoveredElementId],
        trigger: "drag-element"
      });
    }, 120);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeCanvasDragKind, activeSourceScrubSourceId, hoveredElementId, pendingRequestId, snapshot.source, source]);

  useEffect(() => {
    const unbind = getActiveEditorPlatform().menu?.bindCommandHandler?.((commandId) => {
      commandRuntime.runCommand(commandId, "platform");
    });
    return typeof unbind === "function" ? unbind : undefined;
  }, [commandRuntime]);

  useEffect(() => {
    getActiveEditorPlatform().window?.setDocumentState?.({
      title: "TikZ Editor",
      dirty: snapshot.source !== source
    });
  }, [snapshot.source, source]);

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

  return (
    <div className={css.app} style={appStyle}>
      <AppMenuBar />
      <Toolbar />
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
          right={<InspectorPanel />}
        />
      </div>
      <StatusBar />
      <Suspense fallback={null}>
        <DevPanel />
      </Suspense>
    </div>
  );
}
