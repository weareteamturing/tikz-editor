import { useCallback, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import css from "./RenderedTooltip.module.css";

type TooltipPosition = {
  left: number;
  top: number;
};

type RenderedTooltipProps = {
  content?: string | null;
  children: ReactNode;
  block?: boolean;
};

const TOOLTIP_GAP_PX = 8;
const VIEWPORT_PADDING_PX = 8;

export function RenderedTooltip({ content, children, block = false }: RenderedTooltipProps) {
  const normalizedContent = useMemo(() => content?.trim() ?? "", [content]);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0 });
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const closeTooltip = useCallback(() => setOpen(false), []);

  const updatePosition = useCallback(() => {
    const anchorElement = anchorRef.current;
    const tooltipElement = tooltipRef.current;
    if (!anchorElement || !tooltipElement) {
      return;
    }

    const anchorRect = anchorElement.getBoundingClientRect();
    const tooltipRect = tooltipElement.getBoundingClientRect();
    const centeredLeft = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2;
    const clampedLeft = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(centeredLeft, window.innerWidth - tooltipRect.width - VIEWPORT_PADDING_PX)
    );
    const placeAbove = anchorRect.top - TOOLTIP_GAP_PX - tooltipRect.height >= VIEWPORT_PADDING_PX;
    const top = placeAbove
      ? anchorRect.top - tooltipRect.height - TOOLTIP_GAP_PX
      : anchorRect.bottom + TOOLTIP_GAP_PX;

    setPosition({ left: clampedLeft, top });
  }, []);

  useLayoutEffect(() => {
    if (!open || !normalizedContent) {
      return;
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [normalizedContent, open, updatePosition]);

  if (!normalizedContent) {
    return <>{children}</>;
  }

  function handlePointerEnter(event: PointerEvent<HTMLSpanElement>): void {
    if (event.pointerType === "touch") {
      return;
    }
    setOpen(true);
  }

  function handlePointerLeave(): void {
    closeTooltip();
  }

  function handleFocus(): void {
    setOpen(true);
  }

  function handleBlur(event: FocusEvent<HTMLSpanElement>): void {
    const nextFocusedTarget = event.relatedTarget as Node | null;
    if (nextFocusedTarget && event.currentTarget.contains(nextFocusedTarget)) {
      return;
    }
    closeTooltip();
  }

  return (
    <span
      ref={anchorRef}
      className={block ? css.anchorBlock : css.anchorInline}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPointerDown={closeTooltip}
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
            {normalizedContent}
          </div>,
          document.body
        )
        : null}
    </span>
  );
}
