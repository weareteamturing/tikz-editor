import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { buildSnapContext } from "tikz-editor/edit/snapping";
import type { ResizeRole } from "tikz-editor/edit/actions";
import type { EditHandle, Point, ScenePath } from "tikz-editor/semantic/types";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import { clientToWorldPoint } from "./geometry";
import { resolveResizeFrameForSource } from "./resize-frames";
import { angleDeg } from "./rotate-handle";
import {
  ellipseAspectRatioForSource,
  findPathStatementById,
  getHandleCursor,
  makeMergeKey,
  resolveGridResizeSnapForHandleDrag,
  resolveRotateDegreesFromOptions,
  resolveScenePathShapeHint,
  resizeCursorForRole
} from "./panel-helpers";

export type UseCanvasHandleInteractionsArgs = {
  [key: string]: any;
};

export function useCanvasHandleInteractions(args: UseCanvasHandleInteractionsArgs) {
  const {
    svgResult,
    toolMode,
    viewportRef,
    dispatch,
    setTextEditingSession,
    setNodeAnchorOverlay,
    selectedElementIds,
    dragCapability,
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
    interactionSvgRef,
    resolveRotateWriteTargetId
  } = args;

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, handle: EditHandle) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();
      setTextEditingSession(null);
      setNodeAnchorOverlay(null);
      dispatch({ type: "SET_ACTIVE_HANDLE", handleId: handle.id });

      if (additiveSelection) {
        dispatch({ type: "SELECT", id: handle.sourceRef.sourceId, additive: true });
        return;
      }

      if (selectedElementIds.size !== 1 || !selectedElementIds.has(handle.sourceRef.sourceId)) {
        dispatch({ type: "SELECT", id: handle.sourceRef.sourceId, additive: false });
      }

      if (!dragCapability.draggableHandleIds.has(handle.id)) {
        setSnapLines([]);
        return;
      }

      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before dragging.");
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-start-handle",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: "handle",
          rawPoint: handle.world,
          lines: []
        });
        return;
      }

      const snapContext = snapshot.scene
        ? buildSnapContext({
            sceneElements: snapshot.scene.elements,
            selectedSourceIds: [handle.sourceRef.sourceId],
            guides: snapGuideInput,
            settings: snapSettingsPatch,
            zoom: canvasTransform.scale,
            viewportWorld: viewportWorldBounds
          })
        : null;
      setSnapLines([]);
      const handleCursor = getHandleCursor(handle, snapshot.scene, snapshot.editHandles);
      const gridResizeSnap = resolveGridResizeSnapForHandleDrag(
        handle,
        snapshot.editHandles,
        snapshot.parseResult?.figure.body
      );

      setDragState({
        kind: "handle",
        pointerId: event.pointerId,
        handleId: handle.id,
        sourceId: handle.sourceRef.sourceId,
        handleKind: handle.kind,
        cursor: handleCursor,
        lastKnownWorld: { ...handle.world },
        snapContext,
        gridResizeSnap,
        historyMergeKey: makeMergeKey("drag-handle", handle.id, event.pointerId),
        activeEndpointAnchor: null
      });
      logSnapDebug({
        phase: "drag-start-handle",
        snapshotMatchesSource: true,
        dragKind: "handle",
        context: snapContext,
        rawPoint: handle.world,
        lines: []
      });
    },
    [
      canvasTransform.scale,
      dispatch,
      dragCapability.draggableHandleIds,
      logSnapDebug,
      selectedElementIds,
      setDragState,
      setNodeAnchorOverlay,
      setSnapLines,
      setTextEditingSession,
      setWarning,
      snapshot.editHandles,
      snapshot.parseResult,
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

  const onResizeHandlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, sourceId: string, role: ResizeRole, cursor: string) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();
      setTextEditingSession(null);

      if (additiveSelection) {
        dispatch({ type: "SELECT", id: sourceId, additive: true });
        return;
      }

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        return;
      }

      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before dragging.");
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-start-resize",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: "resize",
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (selectedElementIds.size !== 1 || !selectedElementIds.has(sourceId)) {
        dispatch({ type: "SELECT", id: sourceId, additive: false });
      }

      const statements = snapshot.parseResult?.figure.body;
      const sourceElements = snapshot.scene?.elements.filter((element: any) => element.sourceRef.sourceId === sourceId) ?? [];
      const pathElement = sourceElements.find((element: any): element is ScenePath => element.kind === "Path");
      const pathShapeHint = pathElement ? resolveScenePathShapeHint(pathElement, statements, sourceId) : undefined;
      const isCircleResizeSource =
        pathShapeHint === "circle" || sourceElements.some((element: any) => element.kind === "Circle");
      const initialFrame = resolveResizeFrameForSource(
        snapshot.scene?.elements ?? [],
        snapshot.editHandles,
        sourceId,
        svgResult.viewBox,
        pathShapeHint
      );
      if (!initialFrame) {
        setWarning("Resize tooltip needs a resolvable resize frame.");
        return;
      }

      setSnapLines([]);
      setDragState({
        kind: "resize",
        pointerId: event.pointerId,
        elementId: sourceId,
        role,
        cursor: cursor || resizeCursorForRole(role),
        preserveAspectRatio: isCircleResizeSource ? 1 : ellipseAspectRatioForSource(snapshot.scene?.elements ?? [], sourceId),
        initialFrame,
        measurementMode: pathShapeHint === "rectangle" ? "opposite-corner" : "center",
        preserveAspectDuringResize: isCircleResizeSource,
        historyMergeKey: makeMergeKey("drag-resize", `${sourceId}:${role}`, event.pointerId)
      });
      logSnapDebug({
        phase: "drag-start-resize",
        snapshotMatchesSource: true,
        dragKind: "resize",
        rawPoint: world,
        lines: []
      });
    },
    [
      dispatch,
      interactionSvgRef,
      logSnapDebug,
      selectedElementIds,
      setDragState,
      setSnapLines,
      setTextEditingSession,
      setWarning,
      snapshot.editHandles,
      snapshot.parseResult,
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolMode,
      viewportRef
    ]
  );

  const onRotateHandlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, sourceId: string, centerWorld: Point, cursor: string) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();
      setTextEditingSession(null);
      setNodeAnchorOverlay(null);

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        return;
      }

      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before dragging.");
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-start-rotate",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: "rotate",
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (selectedElementIds.size !== 1 || !selectedElementIds.has(sourceId)) {
        dispatch({ type: "SELECT", id: sourceId, additive: false });
      }

      const rotateTargetId = resolveRotateWriteTargetId(sourceId);
      const resolvedRotateTarget = resolvePropertyTarget(source, rotateTargetId);
      const baseRotateDeg =
        resolvedRotateTarget.kind === "found"
          ? resolveRotateDegreesFromOptions(resolvedRotateTarget.target.options)
          : 0;

      setSnapLines([]);
      setDragState({
        kind: "rotate",
        pointerId: event.pointerId,
        elementId: rotateTargetId,
        cursor: cursor === "not-allowed" ? "not-allowed" : "grabbing",
        centerWorld,
        startPointerAngleDeg: angleDeg(centerWorld, world),
        baseRotateDeg,
        lastAppliedRotateDeg: baseRotateDeg,
        historyMergeKey: makeMergeKey("drag-rotate", sourceId, event.pointerId)
      });
      logSnapDebug({
        phase: "drag-start-rotate",
        snapshotMatchesSource: true,
        dragKind: "rotate",
        rawPoint: world,
        lines: []
      });
    },
    [
      dispatch,
      interactionSvgRef,
      logSnapDebug,
      resolveRotateWriteTargetId,
      selectedElementIds,
      setDragState,
      setNodeAnchorOverlay,
      setSnapLines,
      setTextEditingSession,
      setWarning,
      snapshot.source,
      source,
      svgResult,
      toolMode,
      viewportRef
    ]
  );

  const resolveRotateWriteTargetIdInternal = useCallback(
    (sourceId: string): string => {
      const statements = snapshot.parseResult?.figure.body;
      if (statements) {
        const statement = findPathStatementById(statements, sourceId);
        if (statement?.command === "node") {
          const inlineNode = statement.items.find((item: any) => item.kind === "Node");
          if (inlineNode && inlineNode.kind === "Node") {
            return inlineNode.id;
          }
        }
      }

      const sourceElements = snapshot.scene?.elements.filter((element: any) => element.sourceRef.sourceId === sourceId) ?? [];
      const preferredElements = sourceElements.filter((element: any) => element.kind !== "Text");
      const candidates = preferredElements.length > 0 ? preferredElements : sourceElements;
      let fallbackTargetId: string | null = null;
      for (const element of candidates) {
        const commandEntry = [...element.styleChain].reverse().find((entry: any) => entry.kind === "command");
        const targetId = commandEntry?.sourceRef?.sourceId?.trim();
        if (!targetId) {
          continue;
        }
        const resolvedTarget = resolvePropertyTarget(source, targetId);
        if (resolvedTarget.kind !== "found") {
          continue;
        }
        if (resolvedTarget.target.kind === "node-item") {
          return targetId;
        }
        if (resolvedTarget.target.options) {
          return targetId;
        }
        fallbackTargetId ??= targetId;
      }
      return fallbackTargetId ?? sourceId;
    },
    [snapshot.parseResult, snapshot.scene, source]
  );

  return {
    onHandlePointerDown,
    onResizeHandlePointerDown,
    onRotateHandlePointerDown,
    resolveRotateWriteTargetId: resolveRotateWriteTargetIdInternal
  };
}
