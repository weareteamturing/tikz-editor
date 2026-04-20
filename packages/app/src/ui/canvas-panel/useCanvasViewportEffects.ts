import { useEffect } from "react";
import { unsafePoint } from "tikz-editor/coords/index";
import { clamp, distanceSquared, viewportToSvgPoint } from "./geometry";
import { resolveToolCreateCurrentWorld } from "./interaction-helpers";
import type { ClientPoint, SvgPoint, ViewportPoint } from "../coords/types";
import type { PendingTouchViewport } from "./types";

export type UseCanvasViewportEffectsArgs = {
  [key: string]: any;
};

export function useCanvasViewportEffects(args: UseCanvasViewportEffectsArgs) {
  const {
    dragRef,
    pendingTouchViewportRef,
    setDragState,
    setToolDraft,
    setToolCursorWorld,
    viewportRef,
    setViewportSize,
    canvasTransform,
    canvasTransformRef,
    selectedElementIds,
    selectedElementIdsRef,
    svgResult,
    svgResultRef,
    fitToContentModeActive,
    fitToContentModeActiveRef,
    sourceBoundsSvg,
    sourceBoundsSvgRef,
    resizeFramesBySource,
    liveResizeFramesRef,
    previousViewBoxRef,
    activeCanvasDragKind,
    setDragPatchMode,
    dispatchCanvasTransform,
    zoomSpeed,
    MIN_SCALE,
    MAX_SCALE,
    setFitToContentModeActive
  } = args;

  useEffect(() => {
    const onModifierKeyChange = (event: KeyboardEvent) => {
      if (event.key !== "Shift") {
        return;
      }

      const drag = dragRef.current;
      if (!drag || drag.kind !== "tool-create") {
        return;
      }

      const nextWorld = resolveToolCreateCurrentWorld(
        drag.startWorld,
        drag.rawCurrentWorld,
        drag.toolMode,
        event.type === "keydown"
      );
      if (distanceSquared(nextWorld, drag.currentWorld) <= 1e-12) {
        return;
      }

      drag.currentWorld = nextWorld;
      setToolDraft({ ...drag });
      setToolCursorWorld(nextWorld);
    };

    window.addEventListener("keydown", onModifierKeyChange);
    window.addEventListener("keyup", onModifierKeyChange);
    return () => {
      window.removeEventListener("keydown", onModifierKeyChange);
      window.removeEventListener("keyup", onModifierKeyChange);
    };
  }, [dragRef, setToolCursorWorld, setToolDraft]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateSize = () => {
      const rect = viewport.getBoundingClientRect();
      setViewportSize({
        width: rect.width,
        height: rect.height
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [setViewportSize, viewportRef]);

  useEffect(() => {
    canvasTransformRef.current = canvasTransform;
  }, [canvasTransform, canvasTransformRef]);

  useEffect(() => {
    selectedElementIdsRef.current = selectedElementIds;
  }, [selectedElementIds, selectedElementIdsRef]);

  useEffect(() => {
    svgResultRef.current = svgResult;
  }, [svgResult, svgResultRef]);

  useEffect(() => {
    fitToContentModeActiveRef.current = fitToContentModeActive;
  }, [fitToContentModeActive, fitToContentModeActiveRef]);

  useEffect(() => {
    sourceBoundsSvgRef.current = sourceBoundsSvg;
  }, [sourceBoundsSvg, sourceBoundsSvgRef]);

  useEffect(() => {
    liveResizeFramesRef.current = resizeFramesBySource;
  }, [liveResizeFramesRef, resizeFramesBySource]);

  useEffect(() => {
    if (!svgResult) {
      previousViewBoxRef.current = null;
      return;
    }

    const previous = previousViewBoxRef.current;
    previousViewBoxRef.current = svgResult.viewBox;
    if (!previous) return;

    const sameX = Math.abs(previous.x - svgResult.viewBox.x) < 1e-6;
    const sameY = Math.abs(previous.y - svgResult.viewBox.y) < 1e-6;
    const sameW = Math.abs(previous.width - svgResult.viewBox.width) < 1e-6;
    const sameH = Math.abs(previous.height - svgResult.viewBox.height) < 1e-6;
    if (sameX && sameY && sameW && sameH) return;

    if (activeCanvasDragKind) {
      setDragPatchMode("full");
    }

    const currentTransform = canvasTransformRef.current;
    const scale = currentTransform.scale;

    const translateX = currentTransform.translateX + (svgResult.viewBox.x - previous.x) * scale;
    const translateY =
      currentTransform.translateY +
      ((previous.y + previous.height) - (svgResult.viewBox.y + svgResult.viewBox.height)) * scale;

    dispatchCanvasTransform({ translateX, translateY, scale });
  }, [activeCanvasDragKind, canvasTransformRef, dispatchCanvasTransform, previousViewBoxRef, setDragPatchMode, svgResult]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const activeTouchPointers = new Map<number, ClientPoint>();
    let pinchGesture:
      | {
          baseScale: number;
          baseSvgPoint: SvgPoint;
          baseDistance: number;
        }
      | null = null;

    const clearPendingTouchViewport = () => {
      const pending = pendingTouchViewportRef.current as PendingTouchViewport | null;
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      pendingTouchViewportRef.current = null;
    };

    const touchPair = () => {
      const [first, second] = [...activeTouchPointers.values()];
      if (!first || !second) {
        return null;
      }
      return { first, second };
    };

    const beginPinchGesture = () => {
      const currentSvg = svgResultRef.current;
      const pair = touchPair();
      if (!currentSvg || !pair) {
        pinchGesture = null;
        return;
      }
      const center = midpointLocal(pair.first, pair.second, viewport);
      const distance = touchDistance(pair.first, pair.second);
      if (!Number.isFinite(distance) || distance <= 0) {
        pinchGesture = null;
        return;
      }
      const currentTransform = canvasTransformRef.current;
      pinchGesture = {
        baseScale: currentTransform.scale,
        baseSvgPoint: viewportToSvgPoint(center, currentTransform, currentSvg.viewBox),
        baseDistance: distance
      };
    };

    const updatePinchGesture = () => {
      const currentSvg = svgResultRef.current;
      const pair = touchPair();
      if (!currentSvg || !pair || !pinchGesture) {
        return;
      }
      const distance = touchDistance(pair.first, pair.second);
      if (!Number.isFinite(distance) || distance <= 0) {
        return;
      }
      const center = midpointLocal(pair.first, pair.second, viewport);
      const nextScale = clamp(
        pinchGesture.baseScale * (distance / pinchGesture.baseDistance),
        MIN_SCALE,
        MAX_SCALE
      );
      const translateX = center.x - (pinchGesture.baseSvgPoint.x - currentSvg.viewBox.x) * nextScale;
      const translateY = center.y - (pinchGesture.baseSvgPoint.y - currentSvg.viewBox.y) * nextScale;

      if (fitToContentModeActiveRef.current) {
        setFitToContentModeActive(false);
      }

      dispatchCanvasTransform({ translateX, translateY, scale: nextScale });
    };

    const onWheel = (event: WheelEvent) => {
      const currentSvg = svgResultRef.current;
      if (!currentSvg) return;
      const currentTransform = canvasTransformRef.current;

      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        event.stopPropagation();
      }

      const rect = viewport.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;

      if (event.ctrlKey || event.metaKey) {
        if (fitToContentModeActiveRef.current) {
          setFitToContentModeActive(false);
        }
        const deltaModeFactor =
          event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? Math.max(1, viewport.clientHeight)
              : 1;
        const zoomFactor = Math.exp(-event.deltaY * deltaModeFactor * zoomSpeed);
        const nextScale = clamp(currentTransform.scale * zoomFactor, MIN_SCALE, MAX_SCALE);
        const svgPoint = viewportToSvgPoint(unsafePoint<ViewportPoint>(localX, localY), currentTransform, currentSvg.viewBox);
        const translateX = localX - (svgPoint.x - currentSvg.viewBox.x) * nextScale;
        const translateY = localY - (svgPoint.y - currentSvg.viewBox.y) * nextScale;

        dispatchCanvasTransform({ translateX, translateY, scale: nextScale });
        return;
      }

      dispatchCanvasTransform({
        translateX: currentTransform.translateX - event.deltaX,
        translateY: currentTransform.translateY - event.deltaY,
        scale: currentTransform.scale
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") {
        return;
      }
      activeTouchPointers.set(event.pointerId, unsafePoint<ClientPoint>(event.clientX, event.clientY));
      if (activeTouchPointers.size < 2) {
        return;
      }
      clearPendingTouchViewport();
      if (dragRef.current?.kind === "pan" || dragRef.current?.kind === "marquee") {
        setDragState(null);
      }
      beginPinchGesture();
      updatePinchGesture();
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !activeTouchPointers.has(event.pointerId)) {
        return;
      }
      activeTouchPointers.set(event.pointerId, unsafePoint<ClientPoint>(event.clientX, event.clientY));
      if (!pinchGesture) {
        return;
      }
      updatePinchGesture();
      event.preventDefault();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !activeTouchPointers.has(event.pointerId)) {
        return;
      }
      activeTouchPointers.delete(event.pointerId);
      if (activeTouchPointers.size >= 2) {
        beginPinchGesture();
        return;
      }
      pinchGesture = null;
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("pointerdown", onPointerDown, { passive: false });
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerUp, { passive: false });

    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      activeTouchPointers.clear();
      pinchGesture = null;
    };
  }, [
    MAX_SCALE,
    MIN_SCALE,
    canvasTransformRef,
    dispatchCanvasTransform,
    dragRef,
    fitToContentModeActiveRef,
    pendingTouchViewportRef,
    setDragState,
    setFitToContentModeActive,
    svgResultRef,
    viewportRef,
    zoomSpeed
  ]);
}

function midpointLocal(
  first: ClientPoint,
  second: ClientPoint,
  viewport: HTMLDivElement
): ViewportPoint {
  const rect = viewport.getBoundingClientRect();
  return unsafePoint<ViewportPoint>(
    (first.x + second.x) / 2 - rect.left,
    (first.y + second.y) / 2 - rect.top
  );
}

function touchDistance(
  first: ClientPoint,
  second: ClientPoint
): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
