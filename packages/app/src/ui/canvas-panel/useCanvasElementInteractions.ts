import { useCallback, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { buildSnapContext, collectSelectionGeometry } from "tikz-editor/edit/snapping";
import { clientToWorldPoint } from "./geometry";
import { makeMergeKey, resolveFallbackTextSourceSpanForSourceId, selectionAnchorRatioFromPoint } from "./panel-helpers";
import { requestSourceSelection } from "../source-sync";

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
    setExpandedDensePathSourceId
  } = args;

  const onElementPointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, targetId: string, region?: any) => {
      if (!svgResult || toolMode !== "select") return;
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;

      viewportRef.current?.focus({ preventScroll: true });
      const alreadySelected = selectedElementIds.has(targetId);

      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (beginTextSelectionDrag(event, targetId, region)) {
        return;
      }

      const isAdornmentTarget = targetId.startsWith("node-adornment:");
      setTextEditingSession(null);

      if (!additiveSelection) {
        setExpandedDensePathSourceId(null);
      }

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) return;

      if (additiveSelection) {
        dispatch({ type: "SELECT", id: targetId, additive: true });
        return;
      }

      const draggedIds = alreadySelected && selectedElementIds.size > 0 ? [...selectedElementIds] : [targetId];
      if (!alreadySelected) {
        dispatch({ type: "SELECT", id: targetId, additive: false });
        if (isAdornmentTarget) {
          setSnapLines([]);
          return;
        }
      }

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
      const initialSelection = snapshot.scene
        ? collectSelectionGeometry(snapshot.scene.elements, draggedIds)
        : null;
      const selectionAnchorRatio = initialSelection
        ? selectionAnchorRatioFromPoint(initialSelection.bounds, world)
        : null;
      setSnapLines([]);

      setDragState({
        kind: "element",
        pointerId: event.pointerId,
        elementIds: draggedIds,
        startWorld: world,
        snapContext,
        initialSelection,
        selectionAnchorRatio,
        historyMergeKey: makeMergeKey(
          "drag-element",
          draggedIds.slice().sort().join(","),
          event.pointerId
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
      beginTextSelectionDrag,
      canvasTransform.scale,
      dispatch,
      draggableSourceIds,
      interactionSvgRef,
      logSnapDebug,
      selectedElementIds,
      setDragState,
      setExpandedDensePathSourceId,
      setSnapLines,
      setTextEditingSession,
      setWarning,
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolMode,
      snapGuideInput,
      snapSettingsPatch,
      viewportRef,
      viewportWorldBounds
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
          applyCanvasTextSelection(target, startIndex, endIndex);
          return;
        }
      }

      if (densePathSourceIds.has(sourceId)) {
        dispatch({ type: "SELECT", id: sourceId, additive: false });
        setExpandedDensePathSourceId(sourceId);
        setTextEditingSession(null);
        return;
      }

      const fallbackSpan = resolveFallbackTextSourceSpanForSourceId(targetId, hitRegions, sceneTextByRegionKey);
      if (!fallbackSpan) {
        return;
      }

      dispatch({ type: "SELECT", id: targetId, additive: false });
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
