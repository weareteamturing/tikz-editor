import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import css from "./Modal.module.css";

type ModalProps = {
  onClose: () => void;
  labelledBy?: string;
  className?: string;
  dataTestId?: string;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  dimBackdrop?: boolean;
  draggable?: boolean;
  children: ReactNode;
};

export function Modal({
  onClose,
  labelledBy,
  className,
  dataTestId,
  closeOnEscape = true,
  closeOnBackdrop = true,
  dimBackdrop = true,
  draggable = false,
  children
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!closeOnEscape) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeOnEscape, onClose]);

  const panelClassName = className ? `${css.panel} ${className}` : css.panel;
  const backdropClassName = dimBackdrop ? css.backdrop : `${css.backdrop} ${css.backdropClear}`;
  const panelStyle = useMemo<CSSProperties>(
    () => draggable
      ? { transform: `translate(${offset.x}px, ${offset.y}px)` }
      : {},
    [draggable, offset.x, offset.y]
  );

  useEffect(() => {
    if (!draggable) {
      return;
    }

    function onPointerMove(event: PointerEvent): void {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }
      setOffset((current) => ({
        x: current.x + (event.clientX - dragState.startX),
        y: current.y + (event.clientY - dragState.startY)
      }));
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY
      };
    }

    function onPointerUp(event: PointerEvent): void {
      if (dragStateRef.current?.pointerId === event.pointerId) {
        dragStateRef.current = null;
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
  }, [draggable]);

  function onPanelPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!draggable) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target?.closest?.("[data-modal-drag-handle='true']")) {
      return;
    }
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY
    };
    panelRef.current?.setPointerCapture?.(event.pointerId);
  }

  return (
    <div
      className={backdropClassName}
      onMouseDown={() => {
        if (closeOnBackdrop) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className={panelClassName}
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-testid={dataTestId}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={onPanelPointerDown}
      >
        {children}
      </div>
    </div>
  );
}
