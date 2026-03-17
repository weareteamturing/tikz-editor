import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useEditorStore } from "../store/store";
import css from "./ResizableLayout.module.css";

type Props = {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
};

const MIN_PANE_WIDTH = 180;

export function ResizableLayout({ left, center, right }: Props) {
  const leftPanelWidth = useEditorStore((s) => s.leftPanelWidth);
  const rightPanelWidth = useEditorStore((s) => s.rightPanelWidth);
  const showSourcePanel = useEditorStore((s) => s.showSourcePanel);
  const showInspectorPanel = useEditorStore((s) => s.showInspectorPanel);
  const dispatch = useEditorStore((s) => s.dispatch);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    side: "left" | "right";
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleSplitterPointerDown = useCallback(
    (side: "left" | "right") => (e: React.PointerEvent) => {
      dragRef.current = {
        side,
        startX: e.clientX,
        startWidth: side === "left" ? leftPanelWidth : rightPanelWidth
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      document.body.classList.add("is-resizing-h");
      e.preventDefault();
    },
    [leftPanelWidth, rightPanelWidth]
  );

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const drag = dragRef.current;
      const container = containerRef.current;
      if (!drag || !container) return;

      const containerWidth = container.clientWidth;
      const delta = e.clientX - drag.startX;
      const newWidth =
        drag.side === "left"
          ? Math.max(MIN_PANE_WIDTH, Math.min(drag.startWidth + delta, containerWidth - MIN_PANE_WIDTH * 2))
          : Math.max(MIN_PANE_WIDTH, Math.min(drag.startWidth - delta, containerWidth - MIN_PANE_WIDTH * 2));

      dispatch({ type: "SET_PANEL_WIDTH", panel: drag.side, width: newWidth });
    }

    function onPointerUp() {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.classList.remove("is-resizing-h");
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dispatch]);

  return (
    <div className={css.layout} ref={containerRef}>
      {showSourcePanel && (
        <>
          <div className={`${css.pane} ${css.paneLeft}`} style={{ flex: `0 0 ${leftPanelWidth}px`, width: leftPanelWidth }}>
            {left}
          </div>
          <div
            className={css.splitter}
            onPointerDown={handleSplitterPointerDown("left")}
            data-testid="layout-splitter-left"
          />
        </>
      )}

      <div className={`${css.pane} ${css.paneCenter}`} style={{ flex: 1 }}>
        {center}
      </div>

      {showInspectorPanel && (
        <>
          <div
            className={css.splitter}
            onPointerDown={handleSplitterPointerDown("right")}
            data-testid="layout-splitter-right"
          />
          <div className={`${css.pane} ${css.paneRight}`} style={{ flex: `0 0 ${rightPanelWidth}px`, width: rightPanelWidth }}>
            {right}
          </div>
        </>
      )}
    </div>
  );
}
