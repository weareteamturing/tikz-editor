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
import { createSingleFlightScheduler } from "./compute-scheduler";
import type { CanvasDragKind } from "../store/types";
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
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const internalClipboard = useEditorStore((s) => s.internalClipboard);
  const lastEditChangedSourceIds = useEditorStore((s) => s.lastEditChangedSourceIds);
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const dispatch = useEditorStore((s) => s.dispatch);
  const computeSchedulerRef = useRef<ReturnType<typeof createSingleFlightScheduler<ComputeRequest, ComputeResponse>> | null>(null);

  useEffect(() => {
    const scheduler = createSingleFlightScheduler<ComputeRequest, ComputeResponse>({
      run: (request) => computeSnapshot(request),
      onSuccess: (_request, response) => {
        dispatch({
          type: "SNAPSHOT_READY",
          requestId: response.id,
          snapshot: response.snapshot
        });
      },
      onError: (request) => {
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
    scheduler.schedule({
      id: requestId,
      source,
      changedSourceIds: lastEditChangedSourceIds,
      trigger: dragKindToComputeTrigger(activeCanvasDragKind)
    });
  }, [activeCanvasDragKind, dispatch, lastEditChangedSourceIds, source]);

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
        if (key === "v") {
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          e.preventDefault();
          return;
        }
        if (key === "n") {
          dispatch({ type: "SET_TOOL_MODE", mode: "addNode" });
          e.preventDefault();
          return;
        }
        if (key === "l") {
          dispatch({ type: "SET_TOOL_MODE", mode: "addLine" });
          e.preventDefault();
          return;
        }
        if (key === "a") {
          dispatch({ type: "SET_TOOL_MODE", mode: "addArrow" });
          e.preventDefault();
          return;
        }
        if (key === "r") {
          dispatch({ type: "SET_TOOL_MODE", mode: "addRect" });
          e.preventDefault();
          return;
        }
        if (key === "c") {
          dispatch({ type: "SET_TOOL_MODE", mode: "addCircle" });
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

function dragKindToComputeTrigger(
  dragKind: CanvasDragKind | null
): "drag-element" | "drag-handle" | "other" {
  if (dragKind === "element") {
    return "drag-element";
  }
  if (dragKind === "handle") {
    return "drag-handle";
  }
  return "other";
}
