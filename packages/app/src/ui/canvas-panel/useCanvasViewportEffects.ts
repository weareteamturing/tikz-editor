import { useEffect } from "react";
import { clamp, distanceSquared, viewportToSvgPoint } from "./geometry";
import { resolveToolCreateCurrentWorld } from "./interaction-helpers";

export type UseCanvasViewportEffectsArgs = {
  [key: string]: any;
};

export function useCanvasViewportEffects(args: UseCanvasViewportEffectsArgs) {
  const {
    dragRef,
    setToolDraft,
    setToolCursorWorld,
    viewportRef,
    setViewportSize,
    showRulers,
    setRulerAlignmentOffsets,
    topRulerRef,
    leftRulerRef,
    canvasTransform,
    canvasTransformRef,
    selectedElementIds,
    selectedElementIdsRef,
    svgResult,
    svgResultRef,
    fitToContentModeActive,
    fitToContentModeActiveRef,
    sourceBounds,
    sourceBoundsRef,
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
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [setViewportSize, viewportRef]);

  useEffect(() => {
    if (!showRulers) {
      setRulerAlignmentOffsets((current: any) => (current.topX === 0 && current.leftY === 0 ? current : { topX: 0, leftY: 0 }));
      return;
    }

    const viewport = viewportRef.current;
    const topRuler = topRulerRef.current;
    const leftRuler = leftRulerRef.current;
    if (!viewport || !topRuler || !leftRuler) {
      return;
    }

    const measure = () => {
      const viewportRect = viewport.getBoundingClientRect();
      const topRect = topRuler.getBoundingClientRect();
      const leftRect = leftRuler.getBoundingClientRect();
      const next = {
        topX: viewportRect.left - topRect.left,
        leftY: viewportRect.top - leftRect.top
      };
      setRulerAlignmentOffsets((current: any) => {
        if (Math.abs(current.topX - next.topX) < 1e-6 && Math.abs(current.leftY - next.leftY) < 1e-6) {
          return current;
        }
        return next;
      });
    };

    measure();

    const observer = new ResizeObserver(() => measure());
    observer.observe(viewport);
    observer.observe(topRuler);
    observer.observe(leftRuler);

    return () => {
      observer.disconnect();
    };
  }, [leftRulerRef, setRulerAlignmentOffsets, showRulers, topRulerRef, viewportRef]);

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
    sourceBoundsRef.current = sourceBounds;
  }, [sourceBounds, sourceBoundsRef]);

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

    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("gesturestart", onGestureStart, { passive: false });
    viewport.addEventListener("gesturechange", onGestureChange, { passive: false });
    viewport.addEventListener("gestureend", onGestureEnd, { passive: false });

    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("gesturestart", onGestureStart);
      viewport.removeEventListener("gesturechange", onGestureChange);
      viewport.removeEventListener("gestureend", onGestureEnd);
    };
  }, [MAX_SCALE, MIN_SCALE, canvasTransformRef, dispatch, fitToContentModeActiveRef, setFitToContentModeActive, svgResultRef, viewportRef, zoomSpeed]);
}
