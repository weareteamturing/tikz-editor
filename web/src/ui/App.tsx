import { useEffect } from "react";
import { useEditorStore } from "../store/store";
import { computeSnapshot } from "../compute";
import { Toolbar } from "./Toolbar";
import { ResizableLayout } from "./ResizableLayout";
import { SourcePanel } from "./SourcePanel";
import { CanvasPanel } from "./CanvasPanel";
import { InspectorPanel } from "./InspectorPanel";
import { StatusBar } from "./StatusBar";
import { DevPanel } from "./DevPanel";
import css from "./App.module.css";

export function App() {
  const source = useEditorStore((s) => s.source);
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
      const inCodeMirror = target?.closest?.(".cm-editor") != null;
      if (inCodeMirror) return;

      // Keep browser/field-native undo for editable fields outside CM.
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA"
      ) {
        return;
      }

      const key = e.key.toLowerCase();
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
  }, [dispatch]);

  return (
    <div className={css.app}>
      <Toolbar />
      <div className={css.body}>
        <ResizableLayout
          left={<SourcePanel />}
          center={<CanvasPanel />}
          right={<InspectorPanel />}
        />
      </div>
      <StatusBar />
      <DevPanel />
    </div>
  );
}
