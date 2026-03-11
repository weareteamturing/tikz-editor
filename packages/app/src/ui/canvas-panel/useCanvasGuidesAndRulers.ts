import { useCallback, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import {
  buildTicks,
  buildValueSequence,
  isMultipleOfStep,
  resolveOverlayGridSteps,
  toViewportXFromWorld,
  toViewportYFromWorld,
  viewportToWorldPoint,
  worldToSvgY,
  type RulerTick
} from "./geometry";
import {
  isPointInsideRect,
  removeGuideValue,
  upsertGuideValue
} from "./panel-helpers";

export type GuideOrientation = "vertical" | "horizontal";

export type GridLines = {
  verticalMinor: number[];
  verticalMajor: number[];
  horizontalMinor: number[];
  horizontalMajor: number[];
  yMin: number;
  yMax: number;
};

export type UseCanvasGuidesAndRulersArgs = {
  [key: string]: any;
};

export function useCanvasGuidesAndRulers(args: UseCanvasGuidesAndRulersArgs) {
  const {
    showGuides,
    guides,
    guidePreview,
    snapToGrid,
    gridMinorTargetPx,
    canvasTransform,
    svgResult,
    visibleRanges,
    rulerAlignmentOffsets,
    showGrid,
    viewportRef,
    svgResultRef,
    canvasTransformRef,
    guideDragRef,
    setGuidePreview,
    LEFT_RULER_DRAG_SOURCE_WIDTH_PX
  } = args;

  const snapGuideInput = useMemo(
    () => ({
      x: showGuides ? guides.vertical : [],
      y: showGuides ? guides.horizontal : []
    }),
    [guides.horizontal, guides.vertical, showGuides]
  );

  const snapSettingsPatch = useMemo(
    () => ({
      grid: {
        enabled: snapToGrid,
        minorTargetPx: gridMinorTargetPx
      }
    }),
    [snapToGrid, gridMinorTargetPx]
  );

  const renderedGuides = useMemo(() => {
    const vertical = [...guides.vertical];
    const horizontal = [...guides.horizontal];

    if (guidePreview) {
      if (guidePreview.hideValue != null) {
        if (guidePreview.orientation === "vertical") {
          removeGuideValue(vertical, guidePreview.hideValue);
        } else {
          removeGuideValue(horizontal, guidePreview.hideValue);
        }
      }

      if (guidePreview.visible !== false) {
        if (guidePreview.orientation === "vertical") {
          upsertGuideValue(vertical, guidePreview.value);
        } else {
          upsertGuideValue(horizontal, guidePreview.value);
        }
      }
    }

    return {
      vertical: vertical.sort((a, b) => a - b),
      horizontal: horizontal.sort((a, b) => a - b)
    };
  }, [guidePreview, guides.horizontal, guides.vertical]);

  const overlayGridSteps = useMemo(
    () => resolveOverlayGridSteps(canvasTransform.scale, gridMinorTargetPx),
    [canvasTransform.scale, gridMinorTargetPx]
  );

  const rulers = useMemo(() => {
    if (!svgResult || !visibleRanges) {
      return {
        topTicks: [] as RulerTick[],
        leftTicks: [] as RulerTick[]
      };
    }

    const { majorStep, minorStep } = overlayGridSteps;

    const topTicks = buildTicks(
      visibleRanges.worldMinX,
      visibleRanges.worldMaxX,
      minorStep,
      majorStep,
      (value) => toViewportXFromWorld(value, svgResult.viewBox, canvasTransform) + rulerAlignmentOffsets.topX
    );

    const leftTicks = buildTicks(
      visibleRanges.worldMinY,
      visibleRanges.worldMaxY,
      minorStep,
      majorStep,
      (value) => toViewportYFromWorld(value, svgResult.viewBox, canvasTransform) + rulerAlignmentOffsets.leftY
    );

    return { topTicks, leftTicks };
  }, [canvasTransform, overlayGridSteps, rulerAlignmentOffsets.leftY, rulerAlignmentOffsets.topX, svgResult, visibleRanges]);

  const gridLines = useMemo((): GridLines | null => {
    if (!svgResult || !visibleRanges || !showGrid) return null;

    const { minorStep, majorStep } = overlayGridSteps;

    const worldXs = buildValueSequence(visibleRanges.worldMinX, visibleRanges.worldMaxX, minorStep, 1000);
    const worldYs = buildValueSequence(visibleRanges.worldMinY, visibleRanges.worldMaxY, minorStep, 1000);

    const verticalMinor: number[] = [];
    const verticalMajor: number[] = [];
    for (const worldX of worldXs) {
      if (isMultipleOfStep(worldX, majorStep)) {
        verticalMajor.push(worldX);
      } else {
        verticalMinor.push(worldX);
      }
    }

    const horizontalMinor: number[] = [];
    const horizontalMajor: number[] = [];
    for (const worldY of worldYs) {
      const svgY = worldToSvgY(worldY, svgResult.viewBox);
      if (isMultipleOfStep(worldY, majorStep)) {
        horizontalMajor.push(svgY);
      } else {
        horizontalMinor.push(svgY);
      }
    }

    return {
      verticalMinor,
      verticalMajor,
      horizontalMinor,
      horizontalMajor,
      yMin: visibleRanges.svgMinY,
      yMax: visibleRanges.svgMaxY
    };
  }, [overlayGridSteps, showGrid, svgResult, visibleRanges]);

  const resolveGuideFromClient = useCallback(
    (orientation: GuideOrientation, clientX: number, clientY: number): { value: number; overViewport: boolean } | null => {
      const viewport = viewportRef.current;
      const currentSvg = svgResultRef.current;
      if (!viewport || !currentSvg) {
        return null;
      }

      const rect = viewport.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const world = viewportToWorldPoint(localX, localY, canvasTransformRef.current, currentSvg.viewBox);
      return {
        value: orientation === "vertical" ? world.x : world.y,
        overViewport: isPointInsideRect(clientX, clientY, rect)
      };
    },
    [canvasTransformRef, svgResultRef, viewportRef]
  );

  const isPointerOverGuideDeleteZone = useCallback(
    (orientation: GuideOrientation, clientX: number, clientY: number): boolean => {
      const viewportRect = viewportRef.current?.getBoundingClientRect();
      if (!viewportRect) {
        return false;
      }
      if (orientation === "horizontal") {
        return clientY <= viewportRect.top + 0.5;
      }
      return clientX <= viewportRect.left + 0.5;
    },
    [viewportRef]
  );

  const onGuidePointerDown = useCallback(
    (event: ReactPointerEvent<SVGLineElement>, orientation: GuideOrientation, value: number) => {
      if (!showGuides) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      const guide = resolveGuideFromClient(orientation, event.clientX, event.clientY);
      if (!guide) {
        return;
      }

      viewportRef.current?.focus({ preventScroll: true });
      guideDragRef.current = {
        pointerId: event.pointerId,
        orientation,
        source: "guide",
        sourceValue: value,
        value: guide.value,
        overViewport: guide.overViewport,
        overDeleteZone: isPointerOverGuideDeleteZone(orientation, event.clientX, event.clientY)
      };
      setGuidePreview(
        guide.overViewport
          ? { orientation, value: guide.value, hideValue: value }
          : null
      );
      document.body.classList.add(
        orientation === "horizontal" ? "is-dragging-guide-horizontal" : "is-dragging-guide-vertical"
      );
      event.preventDefault();
      event.stopPropagation();
    },
    [guideDragRef, isPointerOverGuideDeleteZone, resolveGuideFromClient, setGuidePreview, showGuides, viewportRef]
  );

  const onTopRulerPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!showGuides) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      const guide = resolveGuideFromClient("horizontal", event.clientX, event.clientY);
      if (!guide) {
        return;
      }

      viewportRef.current?.focus({ preventScroll: true });
      guideDragRef.current = {
        pointerId: event.pointerId,
        orientation: "horizontal",
        source: "ruler",
        value: guide.value,
        overViewport: guide.overViewport,
        overDeleteZone: false
      };
      setGuidePreview(guide.overViewport ? { orientation: "horizontal", value: guide.value } : null);
      document.body.classList.add("is-dragging-guide-horizontal");
      event.preventDefault();
      event.stopPropagation();
    },
    [guideDragRef, resolveGuideFromClient, setGuidePreview, showGuides, viewportRef]
  );

  const onLeftRulerPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!showGuides) {
        return;
      }
      if (event.button !== 0) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      // Keep guide drags on the canvas-adjacent side so the code-panel splitter
      // can still be grabbed reliably near the outer edge.
      if (localX < rect.width - LEFT_RULER_DRAG_SOURCE_WIDTH_PX) {
        return;
      }

      const guide = resolveGuideFromClient("vertical", event.clientX, event.clientY);
      if (!guide) {
        return;
      }

      viewportRef.current?.focus({ preventScroll: true });
      guideDragRef.current = {
        pointerId: event.pointerId,
        orientation: "vertical",
        source: "ruler",
        value: guide.value,
        overViewport: guide.overViewport,
        overDeleteZone: false
      };
      setGuidePreview(guide.overViewport ? { orientation: "vertical", value: guide.value } : null);
      document.body.classList.add("is-dragging-guide-vertical");
      event.preventDefault();
      event.stopPropagation();
    },
    [LEFT_RULER_DRAG_SOURCE_WIDTH_PX, guideDragRef, resolveGuideFromClient, setGuidePreview, showGuides, viewportRef]
  );

  return {
    snapGuideInput,
    snapSettingsPatch,
    renderedGuides,
    overlayGridSteps,
    rulers,
    gridLines,
    resolveGuideFromClient,
    isPointerOverGuideDeleteZone,
    onGuidePointerDown,
    onTopRulerPointerDown,
    onLeftRulerPointerDown
  };
}
