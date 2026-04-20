import { useCallback, useMemo, type Dispatch, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from "react";
import { unsafePoint } from "tikz-editor/coords/index";
import {
  buildTicks,
  buildValueSequence,
  isMultipleOfStep,
  resolveOverlayGridSteps,
  toViewportXFromWorld,
  toViewportYFromWorld,
  viewportToWorldPoint,
  worldToSvgY,
  type RulerTick,
  type VisibleRanges
} from "./geometry";
import {
  isPointInsideRect,
  removeGuideValue,
  upsertGuideValue
} from "./panel-helpers";
import type { CanvasTransform } from "../../store/types";
import type { ClientPoint, ViewportPoint } from "../coords/types";
import type { GuideDragState, GuideOrientation, GuidePreview, GuidesState } from "./types";
import type { SvgViewBox } from "tikz-editor/svg/index";

export type GridLines = {
  verticalMinor: number[];
  verticalMajor: number[];
  horizontalMinor: number[];
  horizontalMajor: number[];
  yMin: number;
  yMax: number;
};

export type UseCanvasGuidesAndRulersArgs = {
  showGuides: boolean;
  guides: GuidesState;
  guidePreview: GuidePreview | null;
  snapModes: {
    guides: boolean;
    grid: boolean;
    points: boolean;
    gaps: boolean;
  };
  gridMinorTargetPx: number;
  canvasTransform: CanvasTransform;
  svgResult: { viewBox: SvgViewBox } | null;
  visibleRanges: VisibleRanges | null;
  showGrid: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  svgResultRef: MutableRefObject<{ viewBox: SvgViewBox } | null>;
  canvasTransformRef: MutableRefObject<CanvasTransform>;
  guideDragRef: MutableRefObject<GuideDragState | null>;
  setGuidePreview: Dispatch<SetStateAction<GuidePreview | null>>;
  LEFT_RULER_DRAG_SOURCE_WIDTH_PX: number;
};

export function useCanvasGuidesAndRulers(args: UseCanvasGuidesAndRulersArgs) {
  const {
    showGuides,
    guides,
    guidePreview,
    snapModes,
    gridMinorTargetPx,
    canvasTransform,
    svgResult,
    visibleRanges,
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
      x: showGuides && snapModes.guides ? guides.vertical : [],
      y: showGuides && snapModes.guides ? guides.horizontal : []
    }),
    [guides.horizontal, guides.vertical, showGuides, snapModes.guides]
  );

  const snapSettingsPatch = useMemo(
    () => ({
      grid: {
        enabled: snapModes.grid,
        minorTargetPx: gridMinorTargetPx
      },
      points: {
        enabled: snapModes.points
      },
      gaps: {
        enabled: snapModes.gaps
      }
    }),
    [snapModes.gaps, snapModes.grid, snapModes.points, gridMinorTargetPx]
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
      (value) => toViewportXFromWorld(value, svgResult.viewBox, canvasTransform)
    );

    const leftTicks = buildTicks(
      visibleRanges.worldMinY,
      visibleRanges.worldMaxY,
      minorStep,
      majorStep,
      (value) => toViewportYFromWorld(value, svgResult.viewBox, canvasTransform)
    );

    return { topTicks, leftTicks };
  }, [canvasTransform, overlayGridSteps, svgResult, visibleRanges]);

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
    (orientation: GuideOrientation, clientPoint: ClientPoint): { value: number; overViewport: boolean } | null => {
      const viewport = viewportRef.current;
      const currentSvg = svgResultRef.current;
      if (!viewport || !currentSvg) {
        return null;
      }

      const rect = viewport.getBoundingClientRect();
      const localX = clientPoint.x - rect.left;
      const localY = clientPoint.y - rect.top;
      const world = viewportToWorldPoint(unsafePoint<ViewportPoint>(localX, localY), canvasTransformRef.current, currentSvg.viewBox);
      return {
        value: orientation === "vertical" ? world.x : world.y,
        overViewport: isPointInsideRect(clientPoint, rect)
      };
    },
    [canvasTransformRef, svgResultRef, viewportRef]
  );

  const isPointerOverGuideDeleteZone = useCallback(
    (orientation: GuideOrientation, clientPoint: ClientPoint): boolean => {
      const viewportRect = viewportRef.current?.getBoundingClientRect();
      if (!viewportRect) {
        return false;
      }
      if (orientation === "horizontal") {
        return clientPoint.y <= viewportRect.top + 0.5;
      }
      return clientPoint.x <= viewportRect.left + 0.5;
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
      const clientPoint = unsafePoint<ClientPoint>(event.clientX, event.clientY);
      const guide = resolveGuideFromClient(orientation, clientPoint);
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
        overDeleteZone: isPointerOverGuideDeleteZone(orientation, clientPoint)
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
      const clientPoint = unsafePoint<ClientPoint>(event.clientX, event.clientY);
      const guide = resolveGuideFromClient("horizontal", clientPoint);
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

      const clientPoint = unsafePoint<ClientPoint>(event.clientX, event.clientY);
      const guide = resolveGuideFromClient("vertical", clientPoint);
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
