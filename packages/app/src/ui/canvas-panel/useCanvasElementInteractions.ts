import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { buildSnapContext, collectSelectionGeometryFromBounds } from "tikz-editor/edit/snapping";
import { clientToWorldPoint } from "./geometry";
import { makeMergeKey, resolveFallbackTextSourceSpanForSourceId, selectionAnchorRatioFromPoint } from "./panel-helpers";
import { requestSourceSelection } from "../source-sync";
import {
  isSourceWithinScope,
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
    beginTextSelectionDrag,
    setTextEditingSession,
    interactionSvgRef,
    dispatch,
    draggableSourceIds,
    interactionBoundsBySource,
    snapshot,
    source,
    setWarning,
    setSnapLines,
    logSnapDebug,
    snapGuideInput,
    snapSettingsPatch,
    canvasTransform,
    viewportWorldBounds,
    setDragState,
    resolveEditableTextTarget,
    resolvePrefixTableForTarget,
    textIndexFromClient,
    applyCanvasTextSelection,
    hitRegions,
    sceneTextByRegionKey,
    findWordRangeAtIndex,
    densePathSourceIds,
    setExpandedDensePathSourceId,
    scopeOverlay,
    focusedScopeId
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
    (pointerId: number, world: { x: number; y: number }, draggedIds: string[]) => {
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

      const snapContext = snapshot.scene
        ? buildSnapContext({
            sceneElements: snapshot.scene.elements,
            selectedSourceIds: draggedIds,
            guides: snapGuideInput,
            settings: snapSettingsPatch,
            zoom: canvasTransform.scale,
            viewportWorld: viewportWorldBounds
          })
        : null;
      const initialSelection = collectSelectionGeometryFromBounds(interactionBoundsBySource, draggedIds);
      const selectionAnchorRatio = initialSelection
        ? selectionAnchorRatioFromPoint(initialSelection.bounds, world)
        : null;
      setSnapLines([]);

      setDragState({
        kind: "element",
        pointerId,
        elementIds: draggedIds,
        startWorld: world,
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
      interactionBoundsBySource,
      logSnapDebug,
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
      if (!svgResult || toolMode !== "select") return;
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;
      const hitSourceId = typeof region?.sourceId === "string" ? region.sourceId : targetId;
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

      if (resolvedTargetId === targetId && beginTextSelectionDrag(event, targetId, region)) {
        return;
      }

      const isAdornmentTarget = resolvedTargetId.startsWith("node-adornment:");
      setTextEditingSession(null);

      if (!additiveSelection) {
        setExpandedDensePathSourceId(null);
      }

      const singleSelectedId = selectedElementIds.size === 1
        ? (selectedElementIds.values().next().value ?? null)
        : null;
      const singleSelectedScopeId =
        singleSelectedId && scopeOverlay.scopesById.has(singleSelectedId) ? singleSelectedId : null;
      const hitSourceHasNodePositionHandle = snapshot.editHandles.some(
        (handle) => handle.kind === "node-position" && handle.sourceRef.sourceId === hitSourceId
      );
      const shouldDeferScopeDrillToPointerUp =
        !additiveSelection &&
        singleSelectedScopeId != null &&
        resolvedTargetId === singleSelectedScopeId &&
        isSourceWithinScope(singleSelectedScopeId, hitSourceId, scopeOverlay);

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) return;

      if (additiveSelection) {
        dispatch({ type: "SELECT", id: resolvedTargetId, additive: true });
        dispatch({ type: "SET_FOCUSED_SCOPE", scopeId: null });
        return;
      }

      if (shouldDeferScopeDrillToPointerUp) {
        const canDragSelectedScope =
          draggableSourceIds.has(singleSelectedScopeId) &&
          !hitSourceHasNodePositionHandle;
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
        if (isAdornmentTarget) {
          setSnapLines([]);
          return;
        }
      } else if (selectedElementIds.size === 1 && selectedElementIds.has(resolvedTargetId)) {
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(resolvedTargetId, scopeOverlay)
        });
      }

      startElementDrag(event.pointerId, world, draggedIds);
    },
    [
      beginTextSelectionDrag,
      dispatch,
      draggableSourceIds,
      focusedScopeId,
      interactionSvgRef,
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

  const onElementDoubleClick = useCallback(
    (event: ReactMouseEvent<SVGElement>, targetId: string, region?: any) => {
      if (toolMode !== "select") return;

      const target = resolveEditableTextTarget(targetId, region);
      const sourceId = typeof region?.sourceId === "string" ? region.sourceId : targetId;

      event.preventDefault();
      event.stopPropagation();
      viewportRef.current?.focus({ preventScroll: true });

      if (target) {
        const prefixTable = resolvePrefixTableForTarget(target);
        const clickIndex = textIndexFromClient(
          event.clientX,
          event.clientY,
          {
            textLength: target.text.length,
            totalWidth: target.totalWidth,
            region: target.region
          },
          prefixTable
        );
        if (clickIndex != null) {
          const wordRange = findWordRangeAtIndex(target.text, clickIndex);
          const startIndex = wordRange?.start ?? clickIndex;
          const endIndex = wordRange?.end ?? clickIndex;
          dispatch({ type: "SELECT", id: targetId, additive: false });
          dispatch({
            type: "SET_FOCUSED_SCOPE",
            scopeId: resolveFocusedScopeIdForSelection(targetId, scopeOverlay)
          });
          applyCanvasTextSelection(target, startIndex, endIndex);
          return;
        }
      }

      if (densePathSourceIds.has(sourceId)) {
        dispatch({ type: "SELECT", id: sourceId, additive: false });
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(sourceId, scopeOverlay)
        });
        setExpandedDensePathSourceId(sourceId);
        setTextEditingSession(null);
        return;
      }

      const fallbackSpan = resolveFallbackTextSourceSpanForSourceId(targetId, hitRegions, sceneTextByRegionKey);
      if (!fallbackSpan) {
        return;
      }

      dispatch({ type: "SELECT", id: targetId, additive: false });
      dispatch({
        type: "SET_FOCUSED_SCOPE",
        scopeId: resolveFocusedScopeIdForSelection(targetId, scopeOverlay)
      });
      requestSourceSelection({
        from: fallbackSpan.from,
        to: fallbackSpan.to,
        anchor: fallbackSpan.from,
        head: fallbackSpan.to,
        sourceId: targetId,
        focus: true
      });
      setTextEditingSession(null);
    },
    [
      applyCanvasTextSelection,
      dispatch,
      densePathSourceIds,
      findWordRangeAtIndex,
      hitRegions,
      resolveEditableTextTarget,
      resolvePrefixTableForTarget,
      sceneTextByRegionKey,
      scopeOverlay,
      setExpandedDensePathSourceId,
      setTextEditingSession,
      textIndexFromClient,
      toolMode,
      viewportRef
    ]
  );

  return {
    onElementPointerDown,
    onElementDoubleClick
  };
}
