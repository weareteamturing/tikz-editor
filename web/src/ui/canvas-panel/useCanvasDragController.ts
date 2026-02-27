import { useEffect } from "react";
import type { EditAction } from "tikz-editor/edit/actions";
import {
  collectSelectionGeometry,
  snapHandlePosition,
  snapSelectionTranslation,
  snapToolPointer,
  type SnapLine
} from "tikz-editor/edit/snapping";
import type { EditHandle, Point, SceneElement } from "tikz-editor/semantic/types";
import type { SvgViewBox } from "tikz-editor/svg/index";

import {
  boundsFromPoints,
  collectSourceIdsInBounds,
  createTemplateForToolDrag,
  deriveSelectionTranslationDeltaFromAnchor,
  resolveHandleIdForDrag,
  resolveToolCreateCurrentWorld
} from "./interaction-helpers";
import { clientToWorldPoint, distanceSquared, worldToSvgPoint } from "./geometry";
import { toolCreateSnapKind } from "../tool-config";
import type {
  ApplyActionFeedback,
  Bounds,
  DragState,
  PendingAddedSelection,
  SnapDebugLogInput,
  TextIndexMappingTarget,
  TextSelectionOverlay
} from "./types";
import { requestSourceSelection } from "../source-sync";

export function useCanvasDragController(params: {
  applyActionWithFeedback: (action: EditAction, mergeKey?: string) => ApplyActionFeedback;
  dispatch: (action: any) => void;
  logSnapDebug: (input: SnapDebugLogInput) => void;
  queueSelectionForAddedElement: (preferredWorld: Point) => void;
  snapshotSource: string;
  snapshotScene: { elements: SceneElement[] } | null;
  snapshotEditHandles: EditHandle[];
  source: string;
  svgResult: { viewBox: SvgViewBox } | null;
  dragRef: { current: DragState | null };
  svgResultRef: { current: { viewBox: SvgViewBox } | null };
  interactionSvgRef: { current: SVGSVGElement | null };
  selectedElementIdsRef: { current: ReadonlySet<string> };
  sourceBoundsRef: { current: ReadonlyMap<string, Bounds> };
  pendingAddedSelectionRef: { current: PendingAddedSelection | null };
  setDragState: (drag: DragState | null) => void;
  setSnapLines: (lines: SnapLine[]) => void;
  setToolDraft: (draft: Extract<DragState, { kind: "tool-create" }> | null) => void;
  setToolCursorWorld: (point: Point | null) => void;
  setMarqueeDraft: (draft: Extract<DragState, { kind: "marquee" }> | null) => void;
  setWarning: (warning: string | null) => void;
  setTextSelectionOverlay: (overlay: TextSelectionOverlay | null) => void;
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
    source,
    svgResult,
    dragRef,
    svgResultRef,
    interactionSvgRef,
    selectedElementIdsRef,
    sourceBoundsRef,
    pendingAddedSelectionRef,
    setDragState,
    setSnapLines,
    setToolDraft,
    setToolCursorWorld,
    setMarqueeDraft,
    setWarning,
    setTextSelectionOverlay,
    textIndexFromClient
  } = params;

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      if (drag.kind === "pan") {
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
        return;
      }

      if (drag.kind === "text-select") {
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
        setTextSelectionOverlay({
          sourceId: drag.sourceId,
          textLength: drag.textLength,
          totalWidth: drag.totalWidth,
          fontSizePt: drag.fontSizePt,
          startIndex: drag.anchorIndex,
          endIndex: drag.headIndex,
          rotation: drag.rotation,
          cx: drag.cx,
          cy: drag.cy,
          width: drag.width,
          height: drag.height,
          prefixTable: drag.prefixTable
        });
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-text-select-move",
          snapshotMatchesSource: true,
          dragKind: "text-select",
          lines: []
        });
        return;
      }

      const currentSvg = svgResultRef.current;
      if (!currentSvg) {
        return;
      }

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, currentSvg.viewBox);
      if (!world) return;

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
        drag.rawCurrentWorld = snapped.snappedPoint ?? world;
        drag.currentWorld = resolveToolCreateCurrentWorld(
          drag.startWorld,
          drag.rawCurrentWorld,
          drag.toolMode,
          event.shiftKey
        );
        setToolDraft({ ...drag });
        setToolCursorWorld(drag.currentWorld);
        setSnapLines(snapped.lines);
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

      if (drag.kind === "marquee") {
        drag.currentWorld = world;
        setMarqueeDraft({ ...drag });
        setSnapLines([]);
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
        setSnapLines([]);
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
        setSnapLines([]);
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
            preserveAspectRatio: drag.preserveAspectRatio ?? undefined
          },
          drag.historyMergeKey
        );
        return;
      }

      if (drag.kind === "element") {
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
        const actualTotalDelta = drag.initialSelection && snapshotScene
          ? deriveSelectionTranslationDeltaFromAnchor(
              drag.initialSelection,
              collectSelectionGeometry(snapshotScene.elements, drag.elementIds),
              drag.selectionAnchorRatio
            )
          : { x: 0, y: 0 };
        const incremental = {
          x: totalDelta.x - actualTotalDelta.x,
          y: totalDelta.y - actualTotalDelta.y
        };
        setSnapLines(snapped.lines);
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

        applyActionWithFeedback(
          {
            kind: "moveElements",
            elementIds: drag.elementIds,
            delta: incremental
          },
          drag.historyMergeKey
        );
        return;
      }

      const resolvedHandleId = resolveHandleIdForDrag(drag, snapshotEditHandles);
      if (!resolvedHandleId) {
        setWarning("Handle is no longer available after recompute. Release and drag again.");
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
      const nextWorld = snapped.snappedPoint ?? world;
      setSnapLines(snapped.lines);
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
        {
          kind: "moveHandle",
          handleId: resolvedHandleId,
          newWorld: nextWorld
        },
        drag.historyMergeKey
      );
      if (ok.sourceChanged) {
        drag.lastKnownWorld = nextWorld;
      }
    }

    function onPointerUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      const currentSvg = svgResultRef.current;
      const world =
        currentSvg == null
          ? null
          : clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, currentSvg.viewBox);

      if (drag.kind === "marquee") {
        const finalWorld = world ?? drag.currentWorld;
        const deltaSq = distanceSquared(finalWorld, drag.startWorld);
        const isClickOnly = deltaSq <= 0.25;

        if (isClickOnly) {
          if (!drag.additive) {
            dispatch({ type: "CLEAR_SELECTION" });
          }
        } else if (currentSvg) {
          const selection = boundsFromPoints(
            worldToSvgPoint(drag.startWorld, currentSvg.viewBox),
            worldToSvgPoint(finalWorld, currentSvg.viewBox)
          );
          const hitIds = collectSourceIdsInBounds(sourceBoundsRef.current, selection);
          if (drag.additive) {
            const merged = new Set(selectedElementIdsRef.current);
            for (const id of hitIds) {
              merged.add(id);
            }
            dispatch({ type: "SELECT_RANGE", ids: [...merged] });
          } else {
            dispatch({ type: "SELECT_RANGE", ids: hitIds });
          }
        }

        setMarqueeDraft(null);
        setSnapLines([]);
        setDragState(null);
        return;
      }

      if (drag.kind === "tool-create") {
        const rawFinalWorld = world ?? drag.rawCurrentWorld;
        const snapKind = toolCreateSnapKind(drag.toolMode);
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: rawFinalWorld,
              kind: snapKind,
              anchor: drag.startWorld,
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: rawFinalWorld, lines: [] as SnapLine[] };
        const snappedWorld = snapped.snappedPoint ?? rawFinalWorld;
        const finalWorld = resolveToolCreateCurrentWorld(
          drag.startWorld,
          snappedWorld,
          drag.toolMode,
          event.shiftKey
        );
        setSnapLines(snapped.lines);
        setToolCursorWorld(finalWorld);

        queueSelectionForAddedElement({
          x: (drag.startWorld.x + finalWorld.x) / 2,
          y: (drag.startWorld.y + finalWorld.y) / 2
        });
        const template = createTemplateForToolDrag(drag.toolMode, drag.startWorld, finalWorld);
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
      }

      if (drag.kind === "text-select") {
        setSnapLines([]);
        setDragState(null);
        return;
      }

      setSnapLines([]);
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
    logSnapDebug,
    pendingAddedSelectionRef,
    queueSelectionForAddedElement,
    selectedElementIdsRef,
    setMarqueeDraft,
    setDragState,
    setSnapLines,
    setTextSelectionOverlay,
    setToolCursorWorld,
    setToolDraft,
    setWarning,
    snapshotEditHandles,
    snapshotScene,
    snapshotSource,
    source,
    sourceBoundsRef,
    svgResult,
    svgResultRef,
    textIndexFromClient
  ]);
}
