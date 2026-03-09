import { useCallback, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import css from "./RenderedTooltip.module.css";

type TooltipPosition = {
  left: number;
  top: number;
};

type RenderedTooltipProps = {
  content?: ReactNode;
  children: ReactNode;
  block?: boolean;
};

const VIEWPORT_PADDING_PX = 8;
const CURSOR_OFFSET_X_PX = 12;
const CURSOR_OFFSET_Y_PX = 16;

export function RenderedTooltip({ content, children, block = false }: RenderedTooltipProps) {
  const hasContent = content != null && !(typeof content === "string" && content.trim().length === 0);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0 });
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const closeTooltip = useCallback(() => setOpen(false), []);

  const updatePosition = useCallback(() => {
    const tooltipElement = tooltipRef.current;
    const pointer = lastPointerRef.current;
    if (!tooltipElement || !pointer) {
      return;
    }

    const tooltipRect = tooltipElement.getBoundingClientRect();
    const preferredLeft = pointer.x + CURSOR_OFFSET_X_PX;
    const clampedLeft = Math.min(
      Math.max(preferredLeft, VIEWPORT_PADDING_PX),
      window.innerWidth - tooltipRect.width - VIEWPORT_PADDING_PX
    );
    const preferredTop = pointer.y + CURSOR_OFFSET_Y_PX;
    const clampedTop = Math.min(
      Math.max(preferredTop, VIEWPORT_PADDING_PX),
      window.innerHeight - tooltipRect.height - VIEWPORT_PADDING_PX
    );

    setPosition({ left: clampedLeft, top: clampedTop });
  }, []);

  const updatePointerPosition = useCallback((event: PointerEvent<HTMLElement>) => {
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    if (open) {
      updatePosition();
    }
  }, [open, updatePosition]);

  useLayoutEffect(() => {
    if (!open || !hasContent) {
      return;
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
    };
  }, [hasContent, open, updatePosition]);

  if (!hasContent) {
    return <>{children}</>;
  }

  function handlePointerEnter(event: PointerEvent<HTMLElement>): void {
    if (event.pointerType === "touch") {
      return;
    }
    updatePointerPosition(event);
    setOpen(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>): void {
    if (event.pointerType === "touch") {
      return;
    }
    updatePointerPosition(event);
  }

  function handlePointerLeave(): void {
    closeTooltip();
  }

  function handleFocus(): void {
    // Focus interactions (including opening dropdowns via keyboard) should hide tooltip.
    closeTooltip();
  }

  function handleBlur(event: FocusEvent<HTMLElement>): void {
    const nextFocusedTarget = event.relatedTarget as Node | null;
    if (nextFocusedTarget && event.currentTarget.contains(nextFocusedTarget)) {
      return;
    }
    closeTooltip();
  }

  const AnchorTag = block ? "div" : "span";

  return (
    <AnchorTag
      className={block ? css.anchorBlock : css.anchorInline}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPointerDown={closeTooltip}
      onKeyDown={closeTooltip}
    >
      {children}
      {open
        ? createPortal(
          <div
            ref={tooltipRef}
            className={css.tooltip}
            style={{ left: `${position.left}px`, top: `${position.top}px` }}
            role="tooltip"
          >
            {content}
          </div>,
          document.body
        )
        : null}
    </AnchorTag>
  );
}
