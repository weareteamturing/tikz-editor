import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useEditorStore } from "../store/store";
import { TreeView } from "../TreeView";
import css from "./DevPanel.module.css";

type Tab = "cst" | "ir" | "snapshot";

const MIN_PANEL_WIDTH = 360;
const MAX_PANEL_MARGIN = 72;

function clampPanelWidth(width: number, viewportWidth: number): number {
  const maxWidth = Math.max(MIN_PANEL_WIDTH, viewportWidth - MAX_PANEL_MARGIN);
  return Math.max(MIN_PANEL_WIDTH, Math.min(width, maxWidth));
}

function initialPanelWidth(): number {
  if (typeof window === "undefined") {
    return 900;
  }
  return clampPanelWidth(Math.min(900, window.innerWidth * 0.9), window.innerWidth);
}

export function DevPanel() {
  const showDevPanel = useEditorStore((s) => s.showDevPanel);
  const dispatch = useEditorStore((s) => s.dispatch);
  const snapshot = useEditorStore((s) => s.snapshot);
  const source = useEditorStore((s) => s.source);

  const [tab, setTab] = useState<Tab>("cst");
  const [panelWidth, setPanelWidth] = useState<number>(initialPanelWidth);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      resizeRef.current = {
        startX: event.clientX,
        startWidth: panelWidth
      };
      document.body.classList.add("is-resizing-dev-panel");
      event.preventDefault();
      event.stopPropagation();
    },
    [panelWidth]
  );

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const resize = resizeRef.current;
      if (!resize) return;
      const deltaX = event.clientX - resize.startX;
      const nextWidth = clampPanelWidth(resize.startWidth - deltaX, window.innerWidth);
      setPanelWidth(nextWidth);
    }

    function onMouseUp() {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.classList.remove("is-resizing-dev-panel");
    }

    function onWindowResize() {
      setPanelWidth((current) => clampPanelWidth(current, window.innerWidth));
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("resize", onWindowResize);
      document.body.classList.remove("is-resizing-dev-panel");
    };
  }, []);

  if (!showDevPanel) return null;

  return (
    <div className={css.overlay}>
      <div className={css.panel} style={{ width: panelWidth }}>
        <div className={css.resizeHandle} onMouseDown={onResizeMouseDown} />
        <div className={css.header}>
          <span>Dev Panel</span>
          <button className={css.closeBtn} onClick={() => { dispatch({ type: "TOGGLE_DEV_PANEL" }); }}>✕</button>
        </div>

        <div className={css.tabs}>
          {(["cst", "ir", "snapshot"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`${css.tab} ${tab === t ? css.tabActive : ""}`}
              onClick={() => { setTab(t); }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div className={css.body}>
          {tab === "cst" && (
            <div className={css.treeWrap}>
              <TreeView
                tree={snapshot.parseResult?.tree ?? null}
                source={source}
                onHover={() => {}}
              />
            </div>
          )}
          {tab === "ir" && (
            <pre className={css.json}>
              {JSON.stringify(
                { figure: snapshot.parseResult?.figure, scene: snapshot.semanticResult?.scene },
                null,
                2
              )}
            </pre>
          )}
          {tab === "snapshot" && (
            <pre className={css.json}>
              {JSON.stringify(
                {
                  revision: snapshot.revision,
                  source: snapshot.source.slice(0, 200) + (snapshot.source.length > 200 ? "…" : ""),
                  editHandles: snapshot.editHandles.length,
                  sceneElements: snapshot.scene?.elements.length ?? 0,
                  hasSvg: snapshot.svg != null,
                  svgLength: snapshot.svg?.svg.length ?? 0
                },
                null,
                2
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
