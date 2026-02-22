import { Suspense, lazy, useEffect } from "react";
import { useEditorStore } from "../store/store";
import { computeSnapshot } from "../compute";
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
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const internalClipboard = useEditorStore((s) => s.internalClipboard);
  const dispatch = useEditorStore((s) => s.dispatch);

  // ── Compute pipeline ─────────────────────────────────────────────────────────
  // Whenever source changes, kick off a new compute. The request ID lets the store
  // discard stale responses (important for the eventual Web Worker migration).
  useEffect(() => {
    const requestId = crypto.randomUUID();
    dispatch({ type: "COMPUTE_REQUESTED", requestId });

    computeSnapshot({ id: requestId, source }).then((response) => {
      dispatch({ type: "SNAPSHOT_READY", requestId: response.id, snapshot: response.snapshot });
    });
    // Note: we don't await here; the SNAPSHOT_READY handler in the reducer checks requestId
  }, [source, dispatch]);

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
  }, [dispatch, internalClipboard, selectedElementIds, source]);

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
