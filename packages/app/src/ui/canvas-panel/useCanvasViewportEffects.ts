import { useEffect } from "react";
import { clamp, distanceSquared, viewportToSvgPoint } from "./geometry";
import { resolveToolCreateCurrentWorld } from "./interaction-helpers";
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
    dispatch,
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

    dispatch({
      type: "SET_CANVAS_TRANSFORM",
      transform: { translateX, translateY, scale }
    });
  }, [activeCanvasDragKind, canvasTransformRef, dispatch, previousViewBoxRef, setDragPatchMode, svgResult]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let inGesture = false;
    let lastGestureScale = 1;
    const activeTouchPointers = new Map<number, { clientX: number; clientY: number }>();
    let pinchGesture:
      | {
          baseScale: number;
          baseSvgPoint: { x: number; y: number };
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
        baseSvgPoint: viewportToSvgPoint(center.x, center.y, currentTransform, currentSvg.viewBox),
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

      dispatch({
        type: "SET_CANVAS_TRANSFORM",
        transform: { translateX, translateY, scale: nextScale }
      });
    };

    const onWheel = (event: WheelEvent) => {
      if (inGesture) return;
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
        const svgPoint = viewportToSvgPoint(localX, localY, currentTransform, currentSvg.viewBox);
        const translateX = localX - (svgPoint.x - currentSvg.viewBox.x) * nextScale;
        const translateY = localY - (svgPoint.y - currentSvg.viewBox.y) * nextScale;

        dispatch({
          type: "SET_CANVAS_TRANSFORM",
          transform: { translateX, translateY, scale: nextScale }
        });
        return;
      }

      dispatch({
        type: "SET_CANVAS_TRANSFORM",
        transform: {
          translateX: currentTransform.translateX - event.deltaX,
          translateY: currentTransform.translateY - event.deltaY,
          scale: currentTransform.scale
        }
      });
    };

    const onGestureStart = (event: Event) => {
      event.preventDefault();
      inGesture = true;
      lastGestureScale = 1;
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const currentSvg = svgResultRef.current;
      if (!currentSvg) return;
      const currentTransform = canvasTransformRef.current;
      const ge = event as Event & { scale: number; clientX: number; clientY: number };
      const deltaScale = ge.scale / lastGestureScale;
      lastGestureScale = ge.scale;
      const nextScale = clamp(currentTransform.scale * deltaScale, MIN_SCALE, MAX_SCALE);
      const rect = viewport.getBoundingClientRect();
      const localX = ge.clientX - rect.left;
      const localY = ge.clientY - rect.top;
      const svgPoint = viewportToSvgPoint(localX, localY, currentTransform, currentSvg.viewBox);
      const translateX = localX - (svgPoint.x - currentSvg.viewBox.x) * nextScale;
      const translateY = localY - (svgPoint.y - currentSvg.viewBox.y) * nextScale;
      if (fitToContentModeActiveRef.current) {
        setFitToContentModeActive(false);
      }
      dispatch({
        type: "SET_CANVAS_TRANSFORM",
        transform: { translateX, translateY, scale: nextScale }
      });
    };

    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      inGesture = false;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") {
        return;
      }
      activeTouchPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
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
      activeTouchPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
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
    viewport.addEventListener("gesturestart", onGestureStart, { passive: false });
    viewport.addEventListener("gesturechange", onGestureChange, { passive: false });
    viewport.addEventListener("gestureend", onGestureEnd, { passive: false });
    viewport.addEventListener("pointerdown", onPointerDown, { passive: false });
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerUp, { passive: false });

    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("gesturestart", onGestureStart);
      viewport.removeEventListener("gesturechange", onGestureChange);
      viewport.removeEventListener("gestureend", onGestureEnd);
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
    dispatch,
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
  first: { clientX: number; clientY: number },
  second: { clientX: number; clientY: number },
  viewport: HTMLDivElement
): { x: number; y: number } {
  const rect = viewport.getBoundingClientRect();
  return {
    x: (first.clientX + second.clientX) / 2 - rect.left,
    y: (first.clientY + second.clientY) / 2 - rect.top
  };
}

function touchDistance(
  first: { clientX: number; clientY: number },
  second: { clientX: number; clientY: number }
): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}
