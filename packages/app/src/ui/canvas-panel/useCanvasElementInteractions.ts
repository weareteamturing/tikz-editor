import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { buildSnapContext, collectSelectionGeometryFromBounds, collectSourceWorldBounds } from "tikz-editor/edit/snapping";
import type { EditHandle, Point, SceneElement } from "tikz-editor/semantic/types";
import { resolveEligibleExplicitPath, type ExplicitPathAnalysis, type ExplicitPathSegment } from "tikz-editor/edit/path-editing";
import { closestPointOnLine, closestPointOnCubic } from "tikz-editor/edit/curve-math";
import { clientToWorldPoint } from "./geometry";
import { makeMergeKey, selectionAnchorRatioFromPoint } from "./panel-helpers";
import {
  isSourceWithinScope,
  type ScopeOverlayIndex,
  resolveFocusedScopeIdForSelection,
  resolveScopeAwarePointerDownTarget,
  resolveScopeAwarePointerUpDrillTarget
} from "./scope-overlay";

export type UseCanvasElementInteractionsArgs = {
  [key: string]: any;
};

export function useCanvasElementInteractions(args: UseCanvasElementInteractionsArgs) {
  const {
    svgResult,
    toolMode,
    selectedElementIds,
    viewportRef,
    beginCanvasTextInteraction,
    setTextEditingSession,
    interactionSvgRef,
    dispatch,
    draggableSourceIds,
    snapshot,
    source,
    setWarning,
    onBucketFillRegion,
    setSnapLines,
    logSnapDebug,
    snapGuideInput,
    snapSettingsPatch,
    canvasTransform,
    viewportWorldBounds,
    setDragState,
    resolveEditableTextTarget,
    densePathSourceIds,
    expandedDensePathSourceId,
    setExpandedDensePathSourceId,
    scopeOverlay,
    focusedScopeId,
    applyActionWithFeedback,
    activeFigureId,
    parseOptions
  } = args;

  const pendingScopeDrillRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    selectedScopeId: string;
    hitSourceId: string;
    dragIds: string[];
    moved: boolean;
    dragStarted: boolean;
  } | null>(null);

  const startElementDrag = useCallback(
    (
      pointerId: number,
      world: { x: number; y: number },
      draggedIds: string[],
      options: { adornmentDragFromText?: boolean } = {}
    ) => {
      if (draggedIds.some((id) => !draggableSourceIds.has(id))) {
        setSnapLines([]);
        return;
      }

      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before dragging.");
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-start-element",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: "element",
          rawPoint: world,
          lines: []
        });
        return;
      }

      const snapExcludedSourceIds = collectSnapExcludedSourceIds(draggedIds, scopeOverlay, snapshot.scene?.elements);

      const snapContext = snapshot.scene
        ? buildSnapContext({
            sceneElements: snapshot.scene.elements,
            selectedSourceIds: snapExcludedSourceIds,
            guides: snapGuideInput,
            settings: snapSettingsPatch,
            zoom: canvasTransform.scale,
            viewportWorld: viewportWorldBounds
          })
        : null;
      const worldBoundsBySource = snapshot.scene
        ? collectSourceWorldBounds(snapshot.scene.elements)
        : new Map<string, { minX: number; minY: number; maxX: number; maxY: number; sourceId: string }>();
      const worldInteractionBoundsBySource = new Map(worldBoundsBySource);
      for (const scopeId of scopeOverlay.scopesById.keys()) {
        let mergedBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
        for (const [sourceId, sourceBounds] of worldBoundsBySource.entries()) {
          const ancestors = scopeOverlay.ancestorScopeIdsBySourceId.get(sourceId) ?? [];
          if (!ancestors.includes(scopeId)) {
            continue;
          }
          mergedBounds = mergedBounds
            ? {
                minX: Math.min(mergedBounds.minX, sourceBounds.minX),
                minY: Math.min(mergedBounds.minY, sourceBounds.minY),
                maxX: Math.max(mergedBounds.maxX, sourceBounds.maxX),
                maxY: Math.max(mergedBounds.maxY, sourceBounds.maxY)
              }
            : {
                minX: sourceBounds.minX,
                minY: sourceBounds.minY,
                maxX: sourceBounds.maxX,
                maxY: sourceBounds.maxY
              };
        }
        if (!mergedBounds) {
          continue;
        }
        worldInteractionBoundsBySource.set(scopeId, {
          ...mergedBounds,
          sourceId: scopeId
        });
      }

      const initialSelection = collectSelectionGeometryFromBounds(worldInteractionBoundsBySource, draggedIds);
      const selectionAnchorRatio = initialSelection
        ? selectionAnchorRatioFromPoint(initialSelection.bounds, world)
        : null;
      setSnapLines([]);

      setDragState({
        kind: "element",
        pointerId,
        elementIds: draggedIds,
        startWorld: world,
        adornmentDragFromText:
          draggedIds.length === 1 && draggedIds[0]?.startsWith("node-adornment:")
            ? options.adornmentDragFromText === true
            : undefined,
        lastAppliedTotalDelta: { x: 0, y: 0 },
        snapContext,
        initialSelection,
        selectionAnchorRatio,
        historyMergeKey: makeMergeKey(
          "drag-element",
          draggedIds.slice().sort().join(","),
          pointerId
        )
      });
      logSnapDebug({
        phase: "drag-start-element",
        snapshotMatchesSource: true,
        dragKind: "element",
        context: snapContext,
        rawPoint: world,
        lines: []
      });
    },
    [
      canvasTransform.scale,
      draggableSourceIds,
      logSnapDebug,
      scopeOverlay.ancestorScopeIdsBySourceId,
      scopeOverlay.scopesById,
      setDragState,
      setSnapLines,
      setWarning,
      snapGuideInput,
      snapSettingsPatch,
      snapshot.scene,
      snapshot.source,
      source,
      viewportWorldBounds
    ]
  );

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const pending = pendingScopeDrillRef.current;
      if (!pending || pending.pointerId !== event.pointerId || pending.dragStarted) {
        return;
      }
      const dx = event.clientX - pending.startClientX;
      const dy = event.clientY - pending.startClientY;
      if ((dx * dx) + (dy * dy) <= 16) {
        return;
      }
      pending.moved = true;
      if (pending.dragIds.length === 0 || !svgResult) {
        return;
      }
      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        return;
      }
      startElementDrag(event.pointerId, world, pending.dragIds);
      pending.dragStarted = true;
    }

    function onPointerUp(event: PointerEvent) {
      const pending = pendingScopeDrillRef.current;
      if (!pending || pending.pointerId !== event.pointerId) {
        return;
      }
      pendingScopeDrillRef.current = null;
      if (pending.moved) {
        return;
      }

      const selectedScopeId = selectedElementIds.size === 1
        ? (selectedElementIds.values().next().value ?? null)
        : null;
      if (!selectedScopeId || selectedScopeId !== pending.selectedScopeId) {
        return;
      }

      const drillTarget = resolveScopeAwarePointerUpDrillTarget({
        selectedScopeId,
        hitSourceId: pending.hitSourceId,
        scopeOverlay
      });
      if (!drillTarget || drillTarget === selectedScopeId) {
        return;
      }

      dispatch({ type: "SELECT", id: drillTarget, additive: false });
      dispatch({ type: "SET_FOCUSED_SCOPE", scopeId: resolveFocusedScopeIdForSelection(drillTarget, scopeOverlay) });
      setSnapLines([]);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dispatch, interactionSvgRef, scopeOverlay, selectedElementIds, setSnapLines, startElementDrag, svgResult]);

  const onElementPointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, targetId: string, region?: any) => {
      if (!svgResult) return;
      if (toolMode === "addBucket") {
        if (event.button !== 0) {
          return;
        }
        viewportRef.current?.focus({ preventScroll: true });
        setTextEditingSession(null);
        event.preventDefault();
        event.stopPropagation();
        onBucketFillRegion(region);
        return;
      }
      if (toolMode !== "select") return;
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;
      const hitSourceId = typeof region?.sourceId === "string" ? region.sourceId : targetId;
      const matrixEdgeSelection =
        region?.shape === "rect" && region.matrixEdgeSelection
          ? region.matrixEdgeSelection
          : null;
      const resolvedTargetId = resolveScopeAwarePointerDownTarget({
        hitTargetId: targetId,
        hitSourceId,
        scopeOverlay,
        focusedScopeId
      });

      viewportRef.current?.focus({ preventScroll: true });
      const alreadySelected = selectedElementIds.has(resolvedTargetId);

      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (!additiveSelection && matrixEdgeSelection && event.button === 0) {
        setTextEditingSession(null);
        setExpandedDensePathSourceId(null);
        dispatch({ type: "SELECT_RANGE", ids: matrixEdgeSelection.selectionIds });
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(matrixEdgeSelection.matrixSourceId, scopeOverlay)
        });
        setSnapLines([]);
        return;
      }

      const textTarget = resolvedTargetId === targetId ? resolveEditableTextTarget(targetId, region) : null;
      if (!additiveSelection && textTarget) {
        dispatch({ type: "SELECT", id: targetId, additive: false });
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(targetId, scopeOverlay)
        });
        beginCanvasTextInteraction(event, textTarget);
        return;
      }

      const isAdornmentTarget = resolvedTargetId.startsWith("node-adornment:");
      setTextEditingSession(null);

      // Keep dense-path expansion when re-clicking the same selected dense path.
      if (
        !additiveSelection &&
        !(expandedDensePathSourceId != null && resolvedTargetId === expandedDensePathSourceId)
      ) {
        setExpandedDensePathSourceId(null);
      }

      const singleSelectedId = selectedElementIds.size === 1
        ? (selectedElementIds.values().next().value ?? null)
        : null;
      const singleSelectedScopeId =
        singleSelectedId && scopeOverlay.scopesById.has(singleSelectedId) ? singleSelectedId : null;
      const shouldDeferScopeDrillToPointerUp =
        !additiveSelection &&
        singleSelectedScopeId != null &&
        resolvedTargetId === singleSelectedScopeId &&
        isSourceWithinScope(singleSelectedScopeId, hitSourceId, scopeOverlay);

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) return;

      if (additiveSelection) {
        dispatch({ type: "SELECT", id: resolvedTargetId, additive: true });
        return;
      }

      if (shouldDeferScopeDrillToPointerUp) {
        const canDragSelectedScope = draggableSourceIds.has(singleSelectedScopeId);
        pendingScopeDrillRef.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          selectedScopeId: singleSelectedScopeId,
          hitSourceId,
          dragIds: canDragSelectedScope ? [singleSelectedScopeId] : [],
          moved: false,
          dragStarted: false
        };
        setSnapLines([]);
        return;
      }

      const draggedIds = alreadySelected && selectedElementIds.size > 0 ? [...selectedElementIds] : [resolvedTargetId];
      if (!alreadySelected) {
        dispatch({ type: "SELECT", id: resolvedTargetId, additive: false });
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(resolvedTargetId, scopeOverlay)
        });
        if (isAdornmentTarget || event.pointerType === "touch") {
          // On touch: selecting an unselected element doesn't immediately start a drag;
          // the user can begin a new gesture to drag once it's selected.
          setSnapLines([]);
          return;
        }
      } else if (selectedElementIds.size === 1 && selectedElementIds.has(resolvedTargetId)) {
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(resolvedTargetId, scopeOverlay)
        });
      }

      const adornmentDragFromText =
        isAdornmentTarget &&
        region?.shape === "rect" &&
        typeof region.sceneTextKey === "string";
      startElementDrag(event.pointerId, world, draggedIds, { adornmentDragFromText });
    },
    [
      beginCanvasTextInteraction,
      dispatch,
      draggableSourceIds,
      focusedScopeId,
      interactionSvgRef,
      onBucketFillRegion,
      selectedElementIds,
      setExpandedDensePathSourceId,
      setSnapLines,
      setTextEditingSession,
      startElementDrag,
      scopeOverlay,
      svgResult,
      toolMode,
      viewportRef
    ]
  );

  const tryInsertPathPoint = useCallback(
    (event: ReactMouseEvent<SVGElement>, sourceId: string): boolean => {
      if (!svgResult || snapshot.source !== source) return false;

      const resolved = resolveEligibleExplicitPath(
        source,
        sourceId,
        parseOptions ?? {
          activeFigureId:
            activeFigureId == null
              ? (snapshot.figures.length > 1 ? null : undefined)
              : activeFigureId
        }
      );
      if (resolved.kind !== "eligible") return false;
      const analysis = resolved.analysis;

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) return false;

      const result = findClosestSegmentPoint(snapshot.editHandles, sourceId, analysis, world);
      if (!result) return false;

      // Threshold: 12px screen distance
      const thresholdWorld = 12 / canvasTransform.scale;
      if (result.distance > thresholdWorld) return false;

      applyActionWithFeedback({
        kind: "insertPathPoint",
        elementId: sourceId,
        segmentIndex: result.segmentIndex,
        point: result.point
      });
      return true;
    },
    [svgResult, snapshot, source, activeFigureId, interactionSvgRef, canvasTransform.scale, applyActionWithFeedback]
  );

  const onElementDoubleClick = useCallback(
    (event: ReactMouseEvent<SVGElement>, targetId: string, region?: any) => {
      if (toolMode !== "select") return;

      const sourceId = typeof region?.sourceId === "string" ? region.sourceId : targetId;
      const textTarget = resolveEditableTextTarget(targetId, region);

      event.preventDefault();
      event.stopPropagation();
      if (textTarget) {
        return;
      }
      viewportRef.current?.focus({ preventScroll: true });

      if (densePathSourceIds.has(sourceId)) {
        if (expandedDensePathSourceId === sourceId) {
          // Expanded dense paths should use double-click for point insertion first.
          if (tryInsertPathPoint(event, sourceId)) {
            return;
          }
          // Missed insertion is a no-op; keep dense path expanded.
          return;
        }
        dispatch({ type: "SELECT", id: sourceId, additive: false });
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(sourceId, scopeOverlay)
        });
        setExpandedDensePathSourceId(sourceId);
        setTextEditingSession(null);
        return;
      }

      // Try to insert a point on a path segment
      if (tryInsertPathPoint(event, sourceId)) {
        return;
      }
    },
    [
      dispatch,
      densePathSourceIds,
      scopeOverlay,
      setExpandedDensePathSourceId,
      setTextEditingSession,
      toolMode,
      viewportRef,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      source, snapshot, svgResult, interactionSvgRef, canvasTransform, applyActionWithFeedback, activeFigureId,
      expandedDensePathSourceId, resolveEditableTextTarget
    ]
  );

  return {
    onElementPointerDown,
    onElementDoubleClick
  };
}

export function collectSnapExcludedSourceIds(
  draggedIds: readonly string[],
  scopeOverlay: ScopeOverlayIndex,
  sceneElements?: readonly SceneElement[]
): string[] {
  if (draggedIds.length === 0) {
    return [...draggedIds];
  }

  const selectedForSnap = new Set<string>(draggedIds);
  const draggedScopeIds = draggedIds.filter((id) => scopeOverlay.scopesById.has(id));
  if (draggedScopeIds.length > 0) {
    for (const [sourceId, ancestorScopeIds] of scopeOverlay.ancestorScopeIdsBySourceId.entries()) {
      if (draggedScopeIds.some((scopeId) => ancestorScopeIds.includes(scopeId))) {
        selectedForSnap.add(sourceId);
      }
    }
  }

  if (sceneElements && sceneElements.length > 0) {
    const candidateSourceIds = new Set(sceneElements.map((element) => element.sourceRef.sourceId));
    for (const candidateSourceId of candidateSourceIds) {
      for (const selectedSourceId of selectedForSnap) {
        if (isSyntheticTreeDescendantSourceId(candidateSourceId, selectedSourceId)) {
          selectedForSnap.add(candidateSourceId);
          break;
        }
      }
    }
  }

  return [...selectedForSnap];
}

function isSyntheticTreeDescendantSourceId(candidateSourceId: string, selectedSourceId: string): boolean {
  return candidateSourceId.startsWith(`${selectedSourceId}:tree-child:`);
}

function findClosestSegmentPoint(
  editHandles: readonly EditHandle[],
  sourceId: string,
  analysis: ExplicitPathAnalysis,
  pointer: Point
): { segmentIndex: number; point: Point; distance: number } | null {
  let best: { segmentIndex: number; point: Point; distance: number } | null = null;

  for (let i = 0; i < analysis.segments.length; i++) {
    const seg = analysis.segments[i]!;
    const startW = resolveAnchorWorld(editHandles, sourceId, analysis.anchors[seg.startAnchorIndex]!);
    const endW = resolveAnchorWorld(editHandles, sourceId, analysis.anchors[seg.endAnchorIndex]!);
    if (!startW || !endW) continue;

    let closest: { point: Point };
    if (seg.kind === "line") {
      closest = closestPointOnLine(pointer, startW, endW);
    } else if (seg.kind === "cubic") {
      const c1Item = seg.control1Index != null ? analysis.statement.items[seg.control1Index] : null;
      const c2Item = seg.control2Index != null ? analysis.statement.items[seg.control2Index] : null;
      if (!c1Item || c1Item.kind !== "Coordinate" || !c2Item || c2Item.kind !== "Coordinate") continue;
      const c1W = resolveControlWorld(editHandles, sourceId, c1Item.span);
      const c2W = seg.usedAnd ? resolveControlWorld(editHandles, sourceId, c2Item.span) : c1W;
      if (!c1W || !c2W) continue;
      closest = closestPointOnCubic(pointer, startW, c1W, c2W, endW);
    } else {
      continue;
    }

    const dist = Math.hypot(closest.point.x - pointer.x, closest.point.y - pointer.y);
    if (!best || dist < best.distance) {
      best = { segmentIndex: i, point: closest.point, distance: dist };
    }
  }

  return best;
}

function resolveAnchorWorld(
  editHandles: readonly EditHandle[],
  sourceId: string,
  anchor: ExplicitPathAnalysis["anchors"][number]
): Point | null {
  const handle = editHandles.find(
    (h) =>
      h.sourceRef.sourceId === sourceId &&
      h.kind === "path-point" &&
      h.sourceRef.sourceSpan.from === anchor.item.span.from &&
      h.sourceRef.sourceSpan.to === anchor.item.span.to
  );
  return handle ? handle.world : null;
}

function resolveControlWorld(
  editHandles: readonly EditHandle[],
  sourceId: string,
  span: { from: number; to: number }
): Point | null {
  const handle = editHandles.find(
    (h) =>
      h.sourceRef.sourceId === sourceId &&
      h.kind === "path-control" &&
      h.sourceRef.sourceSpan.from === span.from &&
      h.sourceRef.sourceSpan.to === span.to
  );
  return handle ? handle.world : null;
}
