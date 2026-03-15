import { useEffect, useRef } from "react";
import type { AdornmentOwnerGeometry } from "tikz-editor/ast/types";
import type { EditAction } from "tikz-editor/edit/actions";
import { parseEditableTargetId } from "tikz-editor/edit/editable-targets";
import { formatNumber } from "tikz-editor/edit/format";
import { worldToLocal } from "tikz-editor/edit/coords";
import { intersectRayWithPolygon } from "tikz-editor/semantic/nodes/shape-geometry";
import {
  collectSelectionGeometryFromBounds,
  snapHandlePosition,
  snapSelectionTranslation,
  snapToolPointer,
  type SnapLine
} from "tikz-editor/edit/snapping";
import type { EditHandle, NodeAnchorTarget, Point, SceneElement } from "tikz-editor/semantic/types";
import { applyMatrix } from "tikz-editor/semantic/transform";
import type { SvgViewBox } from "tikz-editor/svg/index";

import {
  boundsFromPoints,
  createBezierTemplateFromBend,
  createTemplateForToolDrag,
  DEFAULT_GRID_TOOL_STEP_PT,
  formatTooltipAngleRow,
  formatTooltipGridCountRow,
  formatTooltipLengthRows,
  projectResizeDimensionsFromCenter,
  projectResizeDimensionsFromOppositeCorner,
  resolveFrameBasis,
  resolveHandleIdForDrag,
  resolveGridTooltipCounts,
  resolveToolCreateSize,
  snapPointDeltaToAxisStepMultiples,
  resolveToolCreateCurrentWorld
} from "./interaction-helpers";
import { resolveHandleDragAction, shouldCommitHandleAnchorOnPointerUp } from "./handle-drag-actions";
import { resolveEndpointAnchorSnap } from "./endpoint-anchor-snap";
import { clientToWorldPoint, distanceSquared, worldToSvgPoint } from "./geometry";
import { PATH_TOOL_BEND_DRAG_THRESHOLD_PX, type PathToolGestureSegment } from "./path-tool";
import { angleDeg, normalizeSignedDeg, resolveDraggedRotateDeg } from "./rotate-handle";
import type { ResizeFrame } from "./resize-frames";
import { resolveScopeAwareMarqueeSelection, type ScopeOverlayIndex } from "./scope-overlay";
import { toolCreateSnapKind } from "../tool-config";
import type {
  ApplyActionFeedback,
  Bounds,
  DragState,
  DragTooltipState,
  NodeAnchorOverlayState,
  PendingAddedSelection,
  PendingBezier,
  SnapDebugLogInput,
  TextEditingSession,
  TextIndexMappingTarget,
  GridResizeSnapConfig
} from "./types";
import { requestSourceSelection } from "../source-sync";

const ROTATE_SHIFT_SNAP_STEP_DEG = 15;
const ROTATE_SOFT_SNAP_STEP_DEG = 90;
const ROTATE_SOFT_SNAP_THRESHOLD_DEG = 7;
const ADORNMENT_ANGLE_SNAP_STEP_DEG = 45;
const ADORNMENT_ANGLE_SNAP_THRESHOLD_DEG = 10;
const ADORNMENT_CENTER_SNAP_THRESHOLD_PT = 1;
const ADORNMENT_DISTANCE_SNAP_THRESHOLD_PT = 3;
const ADORNMENT_DISTANCE_STEP_PT = 0.5;
const GRID_RESIZE_STEP_EPSILON = 1e-9;
const SNAP_FEEDBACK_EPSILON = 1e-6;

export function useCanvasDragController(params: {
  applyActionWithFeedback: (action: EditAction, mergeKey?: string) => ApplyActionFeedback;
  dispatch: (action: any) => void;
  logSnapDebug: (input: SnapDebugLogInput) => void;
  queueSelectionForAddedElement: (preferredWorld: Point) => void;
  snapshotSource: string;
  snapshotScene: { elements: SceneElement[] } | null;
  snapshotEditHandles: EditHandle[];
  nodeAnchorTargets: readonly NodeAnchorTarget[];
  source: string;
  svgResult: { viewBox: SvgViewBox } | null;
  dragRef: { current: DragState | null };
  svgResultRef: { current: { viewBox: SvgViewBox } | null };
  interactionSvgRef: { current: SVGSVGElement | null };
  liveResizeFramesRef: { current: ReadonlyMap<string, ResizeFrame | null> };
  selectedElementIdsRef: { current: ReadonlySet<string> };
  sourceBoundsRef: { current: ReadonlyMap<string, Bounds> };
  interactionBoundsBySourceRef: { current: ReadonlyMap<string, Bounds & { sourceId: string }> };
  scopeOverlay: ScopeOverlayIndex;
  pendingAddedSelectionRef: { current: PendingAddedSelection | null };
  setDragState: (drag: DragState | null) => void;
  setSnapLines: (lines: SnapLine[]) => void;
  setToolDraft: (draft: Extract<DragState, { kind: "tool-create" }> | null) => void;
  setBezierBendDraft: (draft: Extract<DragState, { kind: "tool-bezier-bend" }> | null) => void;
  setPathSegmentDraft: (draft: Extract<DragState, { kind: "tool-path-segment" }> | null) => void;
  commitPathToolSegment: (segment: PathToolGestureSegment) => void;
  appendFreehandSamplePoint: (point: Point) => Point[] | null;
  finalizeFreehandDraft: (overridePoints?: Point[]) => void;
  setPendingBezier: (pending: PendingBezier | null) => void;
  setToolCursorWorld: (point: Point | null) => void;
  setMarqueeDraft: (draft: Extract<DragState, { kind: "marquee" }> | null) => void;
  setNodeAnchorOverlay: (overlay: NodeAnchorOverlayState | null) => void;
  setDragTooltip: (tooltip: DragTooltipState | null) => void;
  setWarning: (warning: string | null) => void;
  setTextEditingSession: (session: TextEditingSession | null) => void;
  onSnapFeedback?: () => void;
  textIndexFromClient: (
    clientX: number,
    clientY: number,
    target: TextIndexMappingTarget,
    prefixTable: readonly number[] | null
  ) => number | null;
}) {
  const {
    applyActionWithFeedback,
    dispatch,
    logSnapDebug,
    queueSelectionForAddedElement,
    snapshotSource,
    snapshotScene,
    snapshotEditHandles,
    nodeAnchorTargets,
    source,
    svgResult,
    dragRef,
    svgResultRef,
    interactionSvgRef,
    liveResizeFramesRef,
    selectedElementIdsRef,
    sourceBoundsRef,
    interactionBoundsBySourceRef,
    scopeOverlay,
    pendingAddedSelectionRef,
    setDragState,
    setSnapLines,
    setToolDraft,
    setBezierBendDraft,
    setPathSegmentDraft,
    commitPathToolSegment,
    appendFreehandSamplePoint,
    finalizeFreehandDraft,
    setPendingBezier,
    setToolCursorWorld,
    setMarqueeDraft,
    setNodeAnchorOverlay,
    setDragTooltip,
    setWarning,
    setTextEditingSession,
    onSnapFeedback,
    textIndexFromClient
  } = params;
  const wasSnappedRef = useRef(false);

  useEffect(() => {
    function sameIdsAsCurrentSelection(ids: readonly string[]): boolean {
      const currentSelection = selectedElementIdsRef.current;
      if (currentSelection.size !== ids.length) {
        return false;
      }
      for (const id of ids) {
        if (!currentSelection.has(id)) {
          return false;
        }
      }
      return true;
    }

    function commitMarqueeSelection(
      drag: Extract<DragState, { kind: "marquee" }>,
      world: Point,
      currentSvg: { viewBox: SvgViewBox }
    ) {
      const selection = boundsFromPoints(
        worldToSvgPoint(drag.startWorld, currentSvg.viewBox),
        worldToSvgPoint(world, currentSvg.viewBox)
      );
      const hitIds = resolveScopeAwareMarqueeSelection({
        selectionBounds: selection,
        sourceBoundsById: sourceBoundsRef.current,
        scopeOverlay
      });
      const nextIds = drag.additive
        ? [...new Set([...drag.baseSelectedIds, ...hitIds])]
        : hitIds;
      if (sameIdsAsCurrentSelection(nextIds)) {
        return;
      }
      dispatch({ type: "SELECT_RANGE", ids: nextIds });
    }

    function maybeTriggerSnapFeedback(snapped: boolean) {
      if (snapped && !wasSnappedRef.current) {
        onSnapFeedback?.();
      }
      wasSnappedRef.current = snapped;
    }

    function resetSnapFeedbackState() {
      wasSnappedRef.current = false;
    }

    function pointChanged(a: Point, b: Point): boolean {
      return Math.abs(a.x - b.x) > SNAP_FEEDBACK_EPSILON || Math.abs(a.y - b.y) > SNAP_FEEDBACK_EPSILON;
    }

    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      if (drag.kind === "pan") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const deltaX = event.clientX - drag.startClientX;
        const deltaY = event.clientY - drag.startClientY;
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-pan-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "pan",
          rawDelta: { x: deltaX, y: deltaY },
          lines: []
        });

        dispatch({
          type: "SET_CANVAS_TRANSFORM",
          transform: {
            ...drag.startTransform,
            translateX: drag.startTransform.translateX + deltaX,
            translateY: drag.startTransform.translateY + deltaY
          }
        });
        maybeTriggerSnapFeedback(false);
        return;
      }

      if (drag.kind === "text-select") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        if (snapshotSource !== source) {
          return;
        }
        const nextIndex = textIndexFromClient(
          event.clientX,
          event.clientY,
          {
            textLength: drag.textLength,
            totalWidth: drag.totalWidth,
            region: {
              shape: "rect",
              key: "",
              sourceId: drag.sourceId,
              targetId: drag.sourceId,
              x: drag.cx - drag.width / 2,
              y: drag.cy - drag.height / 2,
              width: drag.width,
              height: drag.height,
              cx: drag.cx,
              cy: drag.cy,
              rotation: drag.rotation
            }
          },
          drag.prefixTable
        );
        if (nextIndex == null || nextIndex === drag.headIndex) {
          return;
        }
        drag.headIndex = nextIndex;
        const anchorOffset = drag.sourceSpan.from + drag.anchorIndex;
        const headOffset = drag.sourceSpan.from + drag.headIndex;
        requestSourceSelection({
          from: Math.min(anchorOffset, headOffset),
          to: Math.max(anchorOffset, headOffset),
          anchor: anchorOffset,
          head: headOffset,
          sourceId: drag.sourceId,
          focus: true
        });
        setTextEditingSession({
          sourceId: drag.sourceId,
          anchorIndex: drag.anchorIndex,
          headIndex: drag.headIndex,
          anchorOffset,
          headOffset
        });
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-text-select-move",
          snapshotMatchesSource: true,
          dragKind: "text-select",
          lines: []
        });
        maybeTriggerSnapFeedback(false);
        return;
      }

      const currentSvg = svgResultRef.current;
      if (!currentSvg) {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        maybeTriggerSnapFeedback(false);
        return;
      }

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, currentSvg.viewBox);
      if (!world) {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        maybeTriggerSnapFeedback(false);
        return;
      }

      if (drag.kind === "tool-create") {
        const snapKind = toolCreateSnapKind(drag.toolMode);
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: world,
              kind: snapKind,
              anchor: drag.startWorld,
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
        let nextRawWorld = snapped.snappedPoint ?? world;
        let endpointAnchorOverlay: NodeAnchorOverlayState | null = null;
        if (drag.toolMode === "addLine" || drag.toolMode === "addArrow") {
          endpointAnchorOverlay = resolveEndpointAnchorSnap({
            pointerWorld: world,
            zoom: drag.snapContext?.zoom ?? 1,
            nodeAnchorTargets
          });
          drag.activeEndpointAnchor = endpointAnchorOverlay.snappedAnchor;
          if (endpointAnchorOverlay.snappedAnchor) {
            nextRawWorld = endpointAnchorOverlay.snappedAnchor.world;
          }
        } else {
          drag.activeEndpointAnchor = null;
        }
        drag.rawCurrentWorld = nextRawWorld;
        drag.currentWorld = resolveToolCreateCurrentWorld(
          drag.startWorld,
          drag.rawCurrentWorld,
          drag.toolMode,
          event.shiftKey
        );
        if (drag.toolMode === "addGrid" && !ctrlOrMeta) {
          drag.currentWorld = snapPointDeltaToAxisStepMultiples(
            drag.startWorld,
            drag.currentWorld,
            DEFAULT_GRID_TOOL_STEP_PT,
            DEFAULT_GRID_TOOL_STEP_PT
          );
        }
        setNodeAnchorOverlay(
          endpointAnchorOverlay && endpointAnchorOverlay.visibleAnchors.length > 0
            ? endpointAnchorOverlay
            : null
        );
        setToolDraft({ ...drag });
        const size = resolveToolCreateSize(drag.toolMode, drag.startWorld, drag.currentWorld);
        const rows = formatTooltipLengthRows(size.width, size.height);
        if (drag.toolMode === "addGrid") {
          const counts = resolveGridTooltipCounts(drag.startWorld, drag.currentWorld);
          rows.push(formatTooltipGridCountRow(counts.columns, counts.rows));
        }
        setDragTooltip({
          kind: "tool-create",
          anchor: { x: event.clientX, y: event.clientY },
          rows
        });
        setToolCursorWorld(drag.currentWorld);
        setSnapLines(snapped.lines);
        maybeTriggerSnapFeedback(snapped.lines.length > 0 || endpointAnchorOverlay?.snappedAnchor != null);
        logSnapDebug({
          phase: "drag-tool-create-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "tool-create",
          context: drag.snapContext,
          rawPoint: world,
          snappedPoint: drag.currentWorld,
          offset: snapped.offset,
          lines: snapped.lines
        });
        return;
      }

      if (drag.kind === "tool-bezier-bend") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: world,
              kind: "line-end",
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
        drag.rawCurrentWorld = snapped.snappedPoint ?? world;
        drag.currentWorld = drag.rawCurrentWorld;
        setBezierBendDraft({ ...drag });
        setToolCursorWorld(drag.currentWorld);
        setSnapLines(snapped.lines);
        maybeTriggerSnapFeedback(snapped.lines.length > 0);
        logSnapDebug({
          phase: "drag-bezier-bend-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "tool-bezier-bend",
          context: drag.snapContext,
          rawPoint: world,
          snappedPoint: drag.currentWorld,
          offset: snapped.offset,
          lines: snapped.lines
        });
        return;
      }

      if (drag.kind === "tool-path-segment") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: world,
              kind: "line-end",
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
        drag.rawBendWorld = snapped.snappedPoint ?? world;
        drag.bendWorld = drag.rawBendWorld;
        if (!drag.isBending) {
          const thresholdWorld = PATH_TOOL_BEND_DRAG_THRESHOLD_PX / Math.max(drag.snapContext?.zoom ?? 1, 1e-3);
          drag.isBending = distanceSquared(drag.rawBendWorld, drag.startPointerWorld) > thresholdWorld * thresholdWorld;
        }
        setPathSegmentDraft({ ...drag });
        setToolCursorWorld(drag.endWorld);
        setSnapLines(snapped.lines);
        maybeTriggerSnapFeedback(snapped.lines.length > 0);
        logSnapDebug({
          phase: "drag-tool-path-segment-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "tool-path-segment",
          context: drag.snapContext,
          rawPoint: world,
          snappedPoint: drag.bendWorld,
          offset: snapped.offset,
          lines: snapped.lines
        });
        return;
      }

      if (drag.kind === "tool-freehand") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const nextPoints = appendFreehandSamplePoint(world);
        if (nextPoints) {
          drag.points = nextPoints;
        }
        setToolCursorWorld(world);
        setSnapLines([]);
        maybeTriggerSnapFeedback(false);
        logSnapDebug({
          phase: "drag-tool-freehand-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "tool-freehand",
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (drag.kind === "marquee") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        drag.currentWorld = world;
        setMarqueeDraft({ ...drag });
        if (distanceSquared(world, drag.startWorld) > 0.25) {
          commitMarqueeSelection(drag, world, currentSvg);
        }
        setSnapLines([]);
        maybeTriggerSnapFeedback(false);
        logSnapDebug({
          phase: "drag-marquee-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "marquee",
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (!svgResult || snapshotSource !== source) {
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        maybeTriggerSnapFeedback(false);
        logSnapDebug({
          phase: "drag-move",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: drag.kind,
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (drag.kind === "resize") {
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        maybeTriggerSnapFeedback(false);
        const liveFrame = liveResizeFramesRef.current.get(drag.elementId) ?? null;
        const liveDimensions = liveFrame ? resolveFrameBasis(liveFrame) : null;
        const dimensions = liveDimensions
          ? { width: liveDimensions.width, height: liveDimensions.height }
          : drag.measurementMode === "opposite-corner"
            ? projectResizeDimensionsFromOppositeCorner(world, drag.initialFrame, drag.role)
            : projectResizeDimensionsFromCenter(
              world,
              drag.initialFrame,
              drag.preserveAspectRatio,
              drag.preserveAspectDuringResize || event.shiftKey
            );
        setDragTooltip({
          kind: "resize",
          anchor: { x: event.clientX, y: event.clientY },
          rows: formatTooltipLengthRows(dimensions.width, dimensions.height)
        });
        logSnapDebug({
          phase: "drag-resize-move",
          snapshotMatchesSource: true,
          dragKind: "resize",
          rawPoint: world,
          lines: []
        });

        applyActionWithFeedback(
          {
            kind: "resizeElement",
            elementId: drag.elementId,
            role: drag.role,
            newWorld: world,
            preserveAspect: event.shiftKey,
            preserveAspectRatio: drag.preserveAspectRatio ?? undefined,
            referenceBounds: drag.elementId.startsWith("scope:")
              ? {
                  minX: drag.initialFrame.cornersByRole["bottom-left"].world.x,
                  minY: drag.initialFrame.cornersByRole["bottom-left"].world.y,
                  maxX: drag.initialFrame.cornersByRole["top-right"].world.x,
                  maxY: drag.initialFrame.cornersByRole["top-right"].world.y
                }
              : undefined,
            referenceScopeTransform: drag.elementId.startsWith("scope:")
              ? drag.initialScopeTransform ?? undefined
              : undefined
          },
          drag.historyMergeKey
        );
        return;
      }

      if (drag.kind === "rotate") {
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        maybeTriggerSnapFeedback(false);
        const currentPointerAngleDeg = angleDeg(drag.centerWorld, world);
        const nextRotate = resolveDraggedRotateDeg({
          baseRotateDeg: drag.baseRotateDeg,
          startPointerAngleDeg: drag.startPointerAngleDeg,
          currentPointerAngleDeg,
          shiftKey: event.shiftKey,
          ctrlOrMetaKey: ctrlOrMeta,
          shiftSnapStepDeg: ROTATE_SHIFT_SNAP_STEP_DEG,
          magneticSnapStepDeg: ROTATE_SOFT_SNAP_STEP_DEG,
          magneticSnapThresholdDeg: ROTATE_SOFT_SNAP_THRESHOLD_DEG,
          roundToInteger: true
        });
        logSnapDebug({
          phase: "drag-rotate-move",
          snapshotMatchesSource: true,
          dragKind: "rotate",
          rawPoint: world,
          lines: []
        });
        setDragTooltip({
          kind: "rotate",
          anchor: { x: event.clientX, y: event.clientY },
          rows: [formatTooltipAngleRow(nextRotate)]
        });

        if (Math.abs(normalizeSignedDeg(nextRotate - drag.lastAppliedRotateDeg)) <= 1e-6) {
          return;
        }

        const ok = applyActionWithFeedback(
          {
            kind: "setProperty",
            elementId: drag.elementId,
            level: "command",
            key: "rotate",
            value: Math.abs(nextRotate) <= 1e-6 ? "" : formatNumber(nextRotate),
            clearKeys: ["/tikz/rotate"]
          },
          drag.historyMergeKey
        );
        if (ok.sourceChanged) {
          drag.lastAppliedRotateDeg = nextRotate;
        }
        return;
      }

      if (drag.kind === "element") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        if (drag.elementIds.length === 1) {
          const parsedTarget = parseEditableTargetId(drag.elementIds[0]!);
          if (parsedTarget.kind === "node-adornment") {
            let adornmentDrag = drag.adornmentDrag;
            if (!adornmentDrag) {
              const adornmentElements =
                snapshotScene?.elements.filter((element) => element.adornment?.targetId === parsedTarget.id) ?? [];
              const adornmentElement = selectPrimaryAdornmentElement(adornmentElements);
              const ownerPoint = adornmentElement?.adornment?.ownerPoint;
              if (!ownerPoint) {
                setSnapLines([]);
                maybeTriggerSnapFeedback(false);
                return;
              }
              adornmentDrag = {
                ownerPoint,
                ownerGeometry: adornmentElement?.adornment?.ownerGeometry,
                allowCenter: adornmentElement?.adornment?.kind === "label",
                defaultDistancePt:
                  adornmentElement?.adornment?.defaultDistancePt ?? adornmentElement?.adornment?.distancePt ?? 0
              };
              drag.adornmentDrag = adornmentDrag;
            }
            const rawWorld = world;
            const placement = resolveAdornmentDragPlacement(rawWorld, adornmentDrag.ownerPoint, adornmentDrag.ownerGeometry, {
              allowCenter: adornmentDrag.allowCenter,
              defaultDistancePt: adornmentDrag.defaultDistancePt
            });
            setSnapLines([]);
            maybeTriggerSnapFeedback(false);
            applyActionWithFeedback(
              {
                kind: "moveAdornment",
                targetId: parsedTarget.id,
                ownerPoint: adornmentDrag.ownerPoint,
                newWorld: rawWorld,
                angleRaw: placement.angleRaw,
                distancePt: placement.distancePt
              },
              drag.historyMergeKey
            );
            return;
          }
        }
        const rawTotalDelta = {
          x: world.x - drag.startWorld.x,
          y: world.y - drag.startWorld.y
        };
        const snapped = drag.snapContext && drag.initialSelection
          ? snapSelectionTranslation({
              context: drag.snapContext,
              selection: drag.initialSelection,
              rawDelta: rawTotalDelta,
              modifiers: { ctrlOrMeta }
            })
          : {
              snappedDelta: rawTotalDelta,
              offset: undefined,
              lines: [] as SnapLine[]
            };
        const totalDelta = snapped.snappedDelta ?? rawTotalDelta;
        const actualTotalDelta = drag.lastAppliedTotalDelta;
        const incremental = {
          x: totalDelta.x - actualTotalDelta.x,
          y: totalDelta.y - actualTotalDelta.y
        };
        setSnapLines(snapped.lines);
        maybeTriggerSnapFeedback(snapped.lines.length > 0);
        logSnapDebug({
          phase: "drag-element-move",
          snapshotMatchesSource: true,
          dragKind: "element",
          context: drag.snapContext,
          rawDelta: rawTotalDelta,
          snappedDelta: totalDelta,
          offset: snapped.offset,
          lines: snapped.lines
        });

        if (Math.abs(incremental.x) < 1e-6 && Math.abs(incremental.y) < 1e-6) {
          return;
        }

        const result = applyActionWithFeedback(
          {
            kind: "moveElements",
            elementIds: drag.elementIds,
            delta: incremental
          },
          drag.historyMergeKey
        );
        if (result.sourceChanged) {
          drag.lastAppliedTotalDelta = totalDelta;
        }
        return;
      }

      const resolvedHandleId = resolveHandleIdForDrag(drag, snapshotEditHandles);
      if (!resolvedHandleId) {
        drag.activeEndpointAnchor = null;
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        setWarning("Handle is no longer available after recompute. Release and drag again.");
        maybeTriggerSnapFeedback(false);
        return;
      }

      const snapped = drag.snapContext
        ? snapHandlePosition({
            context: drag.snapContext,
            point: world,
            sourceId: drag.sourceId,
            modifiers: { ctrlOrMeta }
          })
        : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
      let nextWorld = snapped.snappedPoint ?? world;
      let endpointAnchorOverlay: NodeAnchorOverlayState | null = null;
      if (drag.handleKind === "path-point") {
        endpointAnchorOverlay = resolveEndpointAnchorSnap({
          pointerWorld: world,
          zoom: drag.snapContext?.zoom ?? 1,
          nodeAnchorTargets
        });
        drag.activeEndpointAnchor = endpointAnchorOverlay.snappedAnchor;
        if (endpointAnchorOverlay.snappedAnchor) {
          nextWorld = endpointAnchorOverlay.snappedAnchor.world;
        }
      } else {
        drag.activeEndpointAnchor = null;
      }
      const beforeGridResizeWorld = nextWorld;
      if (drag.gridResizeSnap && !ctrlOrMeta) {
        nextWorld = snapGridResizePoint(nextWorld, drag.gridResizeSnap);
      }
      setNodeAnchorOverlay(endpointAnchorOverlay && endpointAnchorOverlay.visibleAnchors.length > 0 ? endpointAnchorOverlay : null);
      setDragTooltip(null);
      setSnapLines(snapped.lines);
      maybeTriggerSnapFeedback(
        snapped.lines.length > 0 ||
          endpointAnchorOverlay?.snappedAnchor != null ||
          pointChanged(beforeGridResizeWorld, nextWorld)
      );
      logSnapDebug({
        phase: "drag-handle-move",
        snapshotMatchesSource: true,
        dragKind: "handle",
        context: drag.snapContext,
        rawPoint: world,
        snappedPoint: nextWorld,
        offset: snapped.offset,
        lines: snapped.lines
      });

      const ok = applyActionWithFeedback(
        resolveHandleDragAction({
          handleId: resolvedHandleId,
          newWorld: nextWorld,
          activeEndpointAnchor: drag.activeEndpointAnchor
        }),
        drag.historyMergeKey
      );
      if (ok.sourceChanged) {
        drag.lastKnownWorld = nextWorld;
      }
    }

    function onPointerUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      resetSnapFeedbackState();
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      const currentSvg = svgResultRef.current;
      const world =
        currentSvg == null
          ? null
          : clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, currentSvg.viewBox);

      if (drag.kind === "marquee") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const finalWorld = world ?? drag.currentWorld;
        const deltaSq = distanceSquared(finalWorld, drag.startWorld);
        const isClickOnly = deltaSq <= 0.25;

        if (isClickOnly) {
          if (!drag.additive) {
            dispatch({ type: "CLEAR_SELECTION" });
          }
        } else if (currentSvg) {
          commitMarqueeSelection(drag, finalWorld, currentSvg);
        }

        setMarqueeDraft(null);
        setSnapLines([]);
        setDragState(null);
        return;
      }

      if (drag.kind === "tool-create") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const rawFinalWorld = world ?? drag.rawCurrentWorld;
        const finalEndpointAnchor =
          drag.toolMode === "addLine" || drag.toolMode === "addArrow"
            ? world
              ? resolveEndpointAnchorSnap({
                  pointerWorld: world,
                  zoom: drag.snapContext?.zoom ?? 1,
                  nodeAnchorTargets
                }).snappedAnchor
              : drag.activeEndpointAnchor
            : null;
        const finalPointerWorld = finalEndpointAnchor?.world ?? rawFinalWorld;
        const snapKind = toolCreateSnapKind(drag.toolMode);
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: finalPointerWorld,
              kind: snapKind,
              anchor: drag.startWorld,
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: finalPointerWorld, lines: [] as SnapLine[] };
        const snappedWorld = snapped.snappedPoint ?? finalPointerWorld;
        let finalWorld = resolveToolCreateCurrentWorld(
          drag.startWorld,
          snappedWorld,
          drag.toolMode,
          event.shiftKey
        );
        if (drag.toolMode === "addGrid" && !ctrlOrMeta) {
          finalWorld = snapPointDeltaToAxisStepMultiples(
            drag.startWorld,
            finalWorld,
            DEFAULT_GRID_TOOL_STEP_PT,
            DEFAULT_GRID_TOOL_STEP_PT
          );
        }
        if (finalEndpointAnchor && (drag.toolMode === "addLine" || drag.toolMode === "addArrow")) {
          finalWorld = finalEndpointAnchor.world;
        }
        setSnapLines(snapped.lines);
        setToolCursorWorld(finalWorld);

        if (drag.toolMode === "addBezier") {
          setPendingBezier({
            startWorld: drag.startWorld,
            endWorld: finalWorld
          });
          setToolCursorWorld(null);
          setToolDraft(null);
          setBezierBendDraft(null);
          setSnapLines([]);
          setDragState(null);
          return;
        }

        queueSelectionForAddedElement({
          x: (drag.startWorld.x + finalWorld.x) / 2,
          y: (drag.startWorld.y + finalWorld.y) / 2
        });
        const rawTemplate = createTemplateForToolDrag(drag.toolMode, drag.startWorld, finalWorld);
        const template =
          rawTemplate.kind === "line"
            ? {
                ...rawTemplate,
                ...(drag.startEndpointAnchor
                  ? {
                      fromAnchor: {
                        nodeName: drag.startEndpointAnchor.nodeName,
                        anchor: drag.startEndpointAnchor.anchor
                      }
                    }
                  : {}),
                ...(rawTemplate.to && finalEndpointAnchor
                  ? {
                      toAnchor: {
                        nodeName: finalEndpointAnchor.nodeName,
                        anchor: finalEndpointAnchor.anchor
                      }
                    }
                  : {})
              }
            : rawTemplate;
        const ok = applyActionWithFeedback({
          kind: "addElement",
          template,
          at: drag.startWorld
        });
        if (!ok.sourceChanged) {
          pendingAddedSelectionRef.current = null;
        }

        if (ok.sourceChanged) {
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          setToolCursorWorld(null);
        }
        setToolDraft(null);
        setSnapLines([]);
        setBezierBendDraft(null);
        setPendingBezier(null);
        setDragState(null);
        return;
      }

      if (drag.kind === "tool-bezier-bend") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const rawFinalWorld = world ?? drag.rawCurrentWorld;
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: rawFinalWorld,
              kind: "line-end",
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: rawFinalWorld, lines: [] as SnapLine[] };
        const finalBend = snapped.snappedPoint ?? rawFinalWorld;
        setSnapLines(snapped.lines);
        setToolCursorWorld(finalBend);

        queueSelectionForAddedElement({
          x: (drag.startWorld.x + drag.endWorld.x) / 2,
          y: (drag.startWorld.y + drag.endWorld.y) / 2
        });
        const template = createBezierTemplateFromBend(drag.startWorld, drag.endWorld, finalBend);
        const ok = applyActionWithFeedback({
          kind: "addElement",
          template,
          at: drag.startWorld
        });
        if (!ok.sourceChanged) {
          pendingAddedSelectionRef.current = null;
        }

        if (ok.sourceChanged) {
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          setToolCursorWorld(null);
        }
        setPendingBezier(null);
        setBezierBendDraft(null);
        setToolDraft(null);
        setSnapLines([]);
        setDragState(null);
        return;
      }

      if (drag.kind === "tool-path-segment") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const rawFinalBend = world ?? drag.rawBendWorld;
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: rawFinalBend,
              kind: "line-end",
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: rawFinalBend, lines: [] as SnapLine[] };
        const finalBend = snapped.snappedPoint ?? rawFinalBend;
        const thresholdWorld = PATH_TOOL_BEND_DRAG_THRESHOLD_PX / Math.max(drag.snapContext?.zoom ?? 1, 1e-3);
        const asBezier =
          drag.isBending || distanceSquared(finalBend, drag.startPointerWorld) > thresholdWorld * thresholdWorld;

        commitPathToolSegment({
          endWorld: drag.endWorld,
          endAnchor: drag.endEndpointAnchor
            ? {
                nodeName: drag.endEndpointAnchor.nodeName,
                anchor: drag.endEndpointAnchor.anchor
              }
            : undefined,
          bendWorld: finalBend,
          asBezier
        });
        setPathSegmentDraft(null);
        setToolCursorWorld(drag.endWorld);
        setSnapLines(snapped.lines);
        setDragState(null);
        return;
      }

      if (drag.kind === "tool-freehand") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        let nextPoints: Point[] | null = null;
        if (world) {
          nextPoints = appendFreehandSamplePoint(world);
          if (nextPoints) {
            drag.points = nextPoints;
          }
          setToolCursorWorld(world);
        }
        setSnapLines([]);
        finalizeFreehandDraft(nextPoints ?? undefined);
        return;
      }

      if (drag.kind === "text-select") {
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        setDragTooltip(null);
        setDragState(null);
        return;
      }

      if (
        drag.kind === "handle" &&
        shouldCommitHandleAnchorOnPointerUp({
          snapshotSource,
          source,
          activeEndpointAnchor: drag.activeEndpointAnchor
        })
      ) {
        const resolvedHandleId = resolveHandleIdForDrag(drag, snapshotEditHandles);
        if (resolvedHandleId && drag.activeEndpointAnchor) {
          applyActionWithFeedback(
            {
              kind: "connectHandle",
              handleId: resolvedHandleId,
              nodeName: drag.activeEndpointAnchor.nodeName,
              anchor: drag.activeEndpointAnchor.anchor
            },
            drag.historyMergeKey
          );
        }
      }

      setNodeAnchorOverlay(null);
      setSnapLines([]);
      setDragTooltip(null);
      setDragState(null);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [
    applyActionWithFeedback,
    dispatch,
    dragRef,
    interactionSvgRef,
    liveResizeFramesRef,
    logSnapDebug,
    onSnapFeedback,
    pendingAddedSelectionRef,
    queueSelectionForAddedElement,
    selectedElementIdsRef,
    setMarqueeDraft,
    setDragTooltip,
    setNodeAnchorOverlay,
    setDragState,
    setSnapLines,
    setTextEditingSession,
    setBezierBendDraft,
    setPathSegmentDraft,
    commitPathToolSegment,
    appendFreehandSamplePoint,
    finalizeFreehandDraft,
    setPendingBezier,
    setToolCursorWorld,
    setToolDraft,
    setWarning,
    snapshotEditHandles,
    snapshotScene,
    snapshotSource,
    nodeAnchorTargets,
    scopeOverlay,
    source,
    sourceBoundsRef,
    svgResult,
    svgResultRef,
    textIndexFromClient
  ]);
}

function snapGridResizePoint(point: Point, config: GridResizeSnapConfig): Point {
  const localPoint = worldToLocal(point, config.transform);
  const anchorLocal = worldToLocal(config.anchorWorld, config.transform);
  if (!localPoint || !anchorLocal) {
    return point;
  }

  const snappedLocal = {
    x: anchorLocal.x + snapDeltaToStep(localPoint.x - anchorLocal.x, config.stepX),
    y: anchorLocal.y + snapDeltaToStep(localPoint.y - anchorLocal.y, config.stepY)
  };
  return applyMatrix(config.transform, snappedLocal);
}

function snapDeltaToStep(delta: number, step: number): number {
  if (!(step > GRID_RESIZE_STEP_EPSILON)) {
    return delta;
  }
  return Math.round(delta / step) * step;
}

function selectPrimaryAdornmentElement(elements: readonly SceneElement[]): SceneElement | null {
  return (
    elements.find((element) => element.kind === "Text") ??
    elements.find((element) => element.kind === "Circle" || element.kind === "Ellipse") ??
    elements[0] ??
    null
  );
}

export function resolveAdornmentDragPlacement(
  point: Point,
  ownerPoint: Point,
  ownerGeometry: AdornmentOwnerGeometry | undefined,
  options: { allowCenter: boolean; defaultDistancePt: number }
): { angleRaw: string; distancePt: number } {
  const center = ownerGeometry?.center ?? ownerPoint;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const radius = Math.sqrt(dx * dx + dy * dy);
  if (options.allowCenter && radius <= ADORNMENT_CENTER_SNAP_THRESHOLD_PT) {
    return { angleRaw: "center", distancePt: 0 };
  }

  let angleDeg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  if (radius > 1e-6) {
    const snappedDeg = Math.round(angleDeg / ADORNMENT_ANGLE_SNAP_STEP_DEG) * ADORNMENT_ANGLE_SNAP_STEP_DEG;
    const deltaDeg = Math.abs((((angleDeg - snappedDeg) % 360) + 540) % 360 - 180);
    if (deltaDeg <= ADORNMENT_ANGLE_SNAP_THRESHOLD_DEG) {
      angleDeg = snappedDeg;
    }
  }

  const radians = (angleDeg * Math.PI) / 180;
  const direction = { x: Math.cos(radians), y: Math.sin(radians) };
  const radialDistanceFromCenter = Math.max(0, dx * direction.x + dy * direction.y);
  const borderDistance = resolveAdornmentOwnerBorderDistance(ownerGeometry, direction);
  let distancePt = Math.max(0, radialDistanceFromCenter - borderDistance);
  if (Math.abs(distancePt - options.defaultDistancePt) <= ADORNMENT_DISTANCE_SNAP_THRESHOLD_PT) {
    distancePt = options.defaultDistancePt;
  } else {
    distancePt = Math.round(distancePt / ADORNMENT_DISTANCE_STEP_PT) * ADORNMENT_DISTANCE_STEP_PT;
  }
  if (options.allowCenter && radialDistanceFromCenter <= borderDistance + ADORNMENT_CENTER_SNAP_THRESHOLD_PT) {
    return { angleRaw: "center", distancePt: 0 };
  }
  return {
    angleRaw: formatAdornmentAngle(angleDeg),
    distancePt
  };
}

function resolveAdornmentOwnerBorderDistance(
  ownerGeometry: AdornmentOwnerGeometry | undefined,
  direction: Point
): number {
  if (!ownerGeometry || ownerGeometry.shape === "coordinate") {
    return 0;
  }
  if (ownerGeometry.anchorPolygon && ownerGeometry.anchorPolygon.length >= 3) {
    const hit = intersectRayWithPolygon({ x: 0, y: 0 }, direction, ownerGeometry.anchorPolygon);
    return hit ? Math.sqrt(hit.x * hit.x + hit.y * hit.y) : 0;
  }
  if (ownerGeometry.shape === "circle") {
    return Math.max(0, ownerGeometry.anchorRadius);
  }
  if (ownerGeometry.shape === "rectangle") {
    const hw = Math.max(ownerGeometry.anchorHalfWidth, 1e-6);
    const hh = Math.max(ownerGeometry.anchorHalfHeight, 1e-6);
    const scale = 1 / Math.max(Math.abs(direction.x) / hw, Math.abs(direction.y) / hh);
    return Number.isFinite(scale) ? scale : 0;
  }
  if (ownerGeometry.shape === "ellipse") {
    const rx = Math.max(ownerGeometry.anchorHalfWidth, 1e-6);
    const ry = Math.max(ownerGeometry.anchorHalfHeight, 1e-6);
    const scale = 1 / Math.sqrt((direction.x * direction.x) / (rx * rx) + (direction.y * direction.y) / (ry * ry));
    return Number.isFinite(scale) ? scale : 0;
  }
  return 0;
}

function formatAdornmentAngle(rawDegrees: number): string {
  let degrees = rawDegrees % 360;
  if (degrees < 0) {
    degrees += 360;
  }
  const keywords = [
    { label: "right", degrees: 0 },
    { label: "above right", degrees: 45 },
    { label: "above", degrees: 90 },
    { label: "above left", degrees: 135 },
    { label: "left", degrees: 180 },
    { label: "below left", degrees: 225 },
    { label: "below", degrees: 270 },
    { label: "below right", degrees: 315 }
  ];
  for (const keyword of keywords) {
    const delta = Math.min(Math.abs(degrees - keyword.degrees), 360 - Math.abs(degrees - keyword.degrees));
    if (delta <= 8) {
      return keyword.label;
    }
  }
  return String(Math.round(degrees));
}
