import { Suspense, lazy, useEffect, useRef } from "react";
import { useEditorStore } from "../store/store";
import { computeSnapshot, makeEmptySnapshot, type ComputeRequest, type ComputeResponse } from "../compute";
import { Toolbar } from "./Toolbar";
import { ResizableLayout } from "./ResizableLayout";
import { InspectorPanel } from "./InspectorPanel";
import { StatusBar } from "./StatusBar";
import {
  copySelection,
  duplicateSelection,
  isCodeMirrorEventTarget,
  pasteSelectionAnchor
} from "./editor-commands";
import { toolModeFromShortcut } from "./tool-config";
import { createSingleFlightScheduler } from "./compute-scheduler";
import { computeTrigger } from "./compute-trigger";
import css from "./App.module.css";

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
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const internalClipboard = useEditorStore((s) => s.internalClipboard);
  const lastEditChangedSourceIds = useEditorStore((s) => s.lastEditChangedSourceIds);
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const activeSourceScrubSourceId = useEditorStore((s) => s.activeSourceScrubSourceId);
  const hoveredElementId = useEditorStore((s) => s.hoveredElementId);
  const dispatch = useEditorStore((s) => s.dispatch);
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

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ctrl+Shift+D: toggle dev panel
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        dispatch({ type: "TOGGLE_DEV_PANEL" });
        e.preventDefault();
        return;
      }

      const target = e.target as HTMLElement | null;
      const inCodeMirror = isCodeMirrorEventTarget(target);
      if (inCodeMirror) return;

      // Keep browser/field-native undo for editable fields outside CM.
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA"
      ) {
        return;
      }

      const commandContext = {
        source,
        snapshotSource: snapshot.source,
        scene: snapshot.scene,
        editHandles: snapshot.editHandles,
        selectedElementIds,
        dispatch
      };

      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (!e.shiftKey && key === "c") {
          void copySelection(commandContext);
          e.preventDefault();
          return;
        }

        if (!e.shiftKey && key === "v") {
          pasteSelectionAnchor({
            ...commandContext,
            internalClipboard
          });
          e.preventDefault();
          return;
        }

        if (!e.shiftKey && key === "d") {
          duplicateSelection(commandContext);
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
        dispatch({ type: "UNDO" });
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && key === "z") || (!e.shiftKey && key === "y"))) {
        dispatch({ type: "REDO" });
        e.preventDefault();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, internalClipboard, selectedElementIds, snapshot.editHandles, snapshot.scene, snapshot.source, source]);

  return (
    <div className={css.app}>
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
