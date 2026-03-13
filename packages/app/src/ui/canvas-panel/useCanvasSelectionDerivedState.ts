import { useMemo } from "react";
import type { NodeAnchorTarget, ScenePath, SceneText } from "tikz-editor/semantic/types";
import {
  computeVisibleRanges,
  resizeCursorForVector,
  vectorLengthSquared,
  worldToSvgPoint,
  type VisibleRanges
} from "./geometry";
import { boundsFromPoints } from "./interaction-helpers";
import { computeDragCapability } from "./drag-capability";
import { deriveCurveControlLines } from "./curve-controls";
import { buildHitRegions } from "./hit-regions";
import { resolveResizeFrameForSource } from "./resize-frames";
import { RESIZE_FRAME_CORNER_ROLES } from "./resize-frames";
import { resolveRotateHandlePosition } from "./rotate-handle";
import {
  collectMatrixStatementSourceIds,
  collectSelectionBounds,
  collectSourceBounds,
  getHandleCursor,
  preferredNodeBoundsForSource,
  resolveAdornmentOwnerBoundaryPoint,
  resolveBoundsEdgePointToward,
  resolveScenePathShapeHint,
  resizeCursorForRole,
  sourceHasSingleResizablePathShape
} from "./panel-helpers";

export type UseCanvasSelectionDerivedStateArgs = {
  [key: string]: any;
};

export function useCanvasSelectionDerivedState(args: UseCanvasSelectionDerivedStateArgs) {
  const {
    snapshot,
    selectedElementIds,
    collapsedDensePathSourceIds,
    svgResult,
    canvasTransform,
    marqueeDraft,
    toolMode,
    viewportSize,
    ROTATE_HANDLE_OFFSET_PX
  } = args;

  const selectedHandles = useMemo(
    () => snapshot.editHandles.filter((handle: any) => selectedElementIds.has(handle.sourceRef.sourceId)),
    [snapshot.editHandles, selectedElementIds]
  );
  const nodeAnchorTargets = useMemo<readonly NodeAnchorTarget[]>(
    () => snapshot.semanticResult?.nodeAnchorTargets ?? [],
    [snapshot.semanticResult]
  );
  const matrixSourceIds = useMemo(() => {
    const figure = snapshot.parseResult?.figure;
    if (!figure) {
      return new Set<string>();
    }
    return collectMatrixStatementSourceIds(figure.body);
  }, [snapshot.parseResult]);
  const dragCapability = useMemo(
    () => computeDragCapability(snapshot.editHandles),
    [snapshot.editHandles]
  );
  const adornmentTargetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const element of snapshot.scene?.elements ?? []) {
      if (element.adornment?.targetId) {
        ids.add(element.adornment.targetId);
      }
    }
    return ids;
  }, [snapshot.scene]);
  const draggableSourceIds = useMemo(() => {
    const ids = new Set<string>(dragCapability.draggableSourceIds);
    for (const sourceId of matrixSourceIds) {
      ids.add(sourceId);
    }
    for (const targetId of adornmentTargetIds) {
      ids.add(targetId);
    }
    return ids;
  }, [adornmentTargetIds, dragCapability.draggableSourceIds, matrixSourceIds]);

  const selectionBounds = useMemo(() => {
    if (!snapshot.scene || !svgResult) return [];
    return collectSelectionBounds(snapshot.scene.elements, selectedElementIds, svgResult.viewBox);
  }, [snapshot.scene, selectedElementIds, svgResult]);

  const sceneTextByRegionKey = useMemo(() => {
    const elements = snapshot.scene?.elements ?? [];
    const byRegionKey = new Map<string, SceneText>();
    for (const element of elements) {
      if (element.kind !== "Text") {
        continue;
      }
      byRegionKey.set(`hit:${element.id}`, element);
    }
    return byRegionKey;
  }, [snapshot.scene]);

  const sourceBounds = useMemo(() => {
    if (!snapshot.scene || !svgResult) {
      return new Map<string, any>();
    }
    return collectSourceBounds(snapshot.scene.elements, svgResult.viewBox);
  }, [snapshot.scene, svgResult]);

  const selectionBoundsBySource = useMemo(() => {
    const bySource = new Map<string, any>();
    for (const entry of selectionBounds as any[]) {
      bySource.set(entry.sourceId, entry.bounds);
    }
    return bySource;
  }, [selectionBounds]);

  const resizablePathShapeSourceIds = useMemo(() => {
    if (!snapshot.scene) {
      return new Set<string>();
    }

    const result = new Set<string>();
    const statements = snapshot.parseResult?.figure.body;
    for (const sourceId of selectionBoundsBySource.keys()) {
      if (matrixSourceIds.has(sourceId)) {
        continue;
      }
      if (sourceHasSingleResizablePathShape(snapshot.scene.elements, snapshot.editHandles, sourceId, statements)) {
        result.add(sourceId);
      }
    }
    return result;
  }, [matrixSourceIds, selectionBoundsBySource, snapshot.editHandles, snapshot.parseResult, snapshot.scene]);

  const nodeResizeSourceIds = useMemo(() => {
    const sourceIds = new Set<string>();
    for (const handle of selectedHandles as any[]) {
      if (handle.kind === "node-position" && !matrixSourceIds.has(handle.sourceRef.sourceId)) {
        sourceIds.add(handle.sourceRef.sourceId);
      }
    }
    return sourceIds;
  }, [matrixSourceIds, selectedHandles]);

  const resizeFrameSourceIds = useMemo(() => {
    const sourceIds = new Set<string>(resizablePathShapeSourceIds);
    for (const sourceId of nodeResizeSourceIds) {
      sourceIds.add(sourceId);
    }
    return sourceIds;
  }, [nodeResizeSourceIds, resizablePathShapeSourceIds]);

  const matrixSelectionSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sourceId of selectionBoundsBySource.keys()) {
      if (matrixSourceIds.has(sourceId)) {
        ids.add(sourceId);
      }
    }
    return ids;
  }, [matrixSourceIds, selectionBoundsBySource]);

  const selectionFrameSourceIds = useMemo(() => {
    const ids = new Set<string>(resizeFrameSourceIds);
    for (const sourceId of matrixSelectionSourceIds) {
      ids.add(sourceId);
    }
    return ids;
  }, [matrixSelectionSourceIds, resizeFrameSourceIds]);

  const resizeFramesBySource = useMemo(() => {
    const frames = new Map<string, ReturnType<typeof resolveResizeFrameForSource>>();
    if (!snapshot.scene || !svgResult) {
      return frames;
    }
    const statements = snapshot.parseResult?.figure.body;
    for (const sourceId of resizeFrameSourceIds) {
      const path = snapshot.scene.elements.find(
        (element: any): element is ScenePath => element.sourceRef.sourceId === sourceId && element.kind === "Path"
      );
      const pathShapeHint = path ? resolveScenePathShapeHint(path, statements, sourceId) : undefined;
      const frame = resolveResizeFrameForSource(
        snapshot.scene.elements,
        snapshot.editHandles,
        sourceId,
        svgResult.viewBox,
        pathShapeHint
      );
      frames.set(sourceId, frame);
    }
    return frames;
  }, [resizeFrameSourceIds, snapshot.editHandles, snapshot.parseResult, snapshot.scene, svgResult]);

  const selectionBoxes = useMemo(() => {
    const boxes = [...selectionFrameSourceIds]
      .map((sourceId) => {
        const resizeFrame = resizeFramesBySource.get(sourceId) ?? null;
        if (resizeFrame) {
          return {
            key: `selection-box:${sourceId}`,
            sourceId,
            isAdornment: sourceId.startsWith("node-adornment:"),
            kind: "polygon" as const,
            points: resizeFrame.polygonSvg
          };
        }
        const bounds = selectionBoundsBySource.get(sourceId);
        return bounds
          ? {
              key: `selection-box:${sourceId}`,
              sourceId,
              isAdornment: sourceId.startsWith("node-adornment:"),
              kind: "axis-aligned" as const,
              ...bounds
            }
          : null;
      })
      .filter((bounds): bounds is NonNullable<typeof bounds> => bounds != null);
    return boxes;
  }, [resizeFramesBySource, selectionBoundsBySource, selectionFrameSourceIds]);

  const selectedAdornmentConnectors = useMemo(() => {
    if (!snapshot.scene || !svgResult) {
      return [];
    }
    const highlightedAdornmentTargetIds = new Set<string>();
    for (const element of snapshot.scene.elements) {
      const adornment = element.adornment;
      if (!adornment?.ownerPoint) {
        continue;
      }
      if (selectedElementIds.has(adornment.targetId) || selectedElementIds.has(element.sourceRef.sourceId)) {
        highlightedAdornmentTargetIds.add(adornment.targetId);
      }
    }
    const connectors: Array<{ key: string; kind: "label" | "pin"; x1: number; y1: number; x2: number; y2: number }> = [];
    const seen = new Set<string>();
    for (const element of snapshot.scene.elements) {
      const adornment = element.adornment;
      if (
        !adornment ||
        adornment.kind !== "label" ||
        !highlightedAdornmentTargetIds.has(adornment.targetId) ||
        !adornment.ownerPoint ||
        seen.has(adornment.targetId)
      ) {
        continue;
      }
      const bounds = selectionBoundsBySource.get(adornment.targetId);
      if (!bounds) {
        continue;
      }
      const labelCenterWorld = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: svgResult.viewBox.y + svgResult.viewBox.height - (((bounds.minY + bounds.maxY) / 2) - svgResult.viewBox.y)
      };
      const connectorOwnerPoint = resolveAdornmentOwnerBoundaryPoint(
        adornment.ownerGeometry,
        adornment.ownerPoint,
        labelCenterWorld
      );
      const owner = worldToSvgPoint(connectorOwnerPoint, svgResult.viewBox);
      const labelEdge = resolveBoundsEdgePointToward(bounds, owner);
      connectors.push({
        key: `adornment-connector:${adornment.targetId}`,
        kind: adornment.kind,
        x1: owner.x,
        y1: owner.y,
        x2: labelEdge.x,
        y2: labelEdge.y
      });
      seen.add(adornment.targetId);
    }
    return connectors;
  }, [selectedElementIds, selectionBoundsBySource, snapshot.scene, svgResult]);

  const adornmentHighlightBoxes = useMemo(() => {
    if (!snapshot.scene) {
      return [];
    }
    const boxes: Array<{ key: string; minX: number; minY: number; maxX: number; maxY: number }> = [];
    const seen = new Set<string>();
    for (const element of snapshot.scene.elements) {
      const targetId = element.adornment?.targetId;
      if (!targetId || seen.has(targetId)) {
        continue;
      }
      if (!selectedElementIds.has(targetId) && !selectedElementIds.has(element.sourceRef.sourceId)) {
        continue;
      }
      const bounds = selectionBoundsBySource.get(targetId);
      if (!bounds) {
        continue;
      }
      boxes.push({
        key: `adornment-highlight:${targetId}`,
        ...bounds
      });
      seen.add(targetId);
    }
    return boxes;
  }, [selectedElementIds, selectionBoundsBySource, snapshot.scene]);

  const curveControlLines = useMemo(
    () =>
      snapshot.scene
        ? deriveCurveControlLines(snapshot.scene.elements, selectedElementIds, snapshot.editHandles).filter(
            (line) => !collapsedDensePathSourceIds.has(line.sourceId)
          )
        : [],
    [collapsedDensePathSourceIds, selectedElementIds, snapshot.editHandles, snapshot.scene]
  );

  const marqueeBounds = useMemo(() => {
    if (!svgResult || !marqueeDraft) return null;
    return boundsFromPoints(
      worldToSvgPoint(marqueeDraft.startWorld, svgResult.viewBox),
      worldToSvgPoint(marqueeDraft.currentWorld, svgResult.viewBox)
    );
  }, [marqueeDraft, svgResult]);

  const collapsedDensePathEndpointsBySource = useMemo(() => {
    const endpointsBySource = new Map<string, { start: { x: number; y: number }; end: { x: number; y: number } }>();
    if (!snapshot.scene || collapsedDensePathSourceIds.size === 0) {
      return endpointsBySource;
    }
    for (const element of snapshot.scene.elements) {
      if (element.kind !== "Path" || !collapsedDensePathSourceIds.has(element.sourceRef.sourceId)) {
        continue;
      }
      let start: { x: number; y: number } | null = null;
      let end: { x: number; y: number } | null = null;
      for (const command of element.commands) {
        if (command.kind === "M") {
          if (!start) {
            start = command.to;
          }
          end = command.to;
          continue;
        }
        if (command.kind === "L" || command.kind === "C" || command.kind === "A") {
          if (!start) {
            start = command.to;
          }
          end = command.to;
        }
      }
      if (start && end) {
        endpointsBySource.set(element.sourceRef.sourceId, { start, end });
      }
    }
    return endpointsBySource;
  }, [collapsedDensePathSourceIds, snapshot.scene]);

  const handleDisplays = useMemo((): any[] => {
    if (!svgResult) return [];

    const displays: any[] = [];
    const resizeHandleSourceIds = new Set<string>(resizeFrameSourceIds);
    const singleSelectedSourceId =
      selectedElementIds.size === 1
        ? (selectedElementIds.values().next().value ?? null)
        : null;
    const rotateHandleSourceId =
      toolMode === "select" &&
      singleSelectedSourceId &&
      resizeHandleSourceIds.has(singleSelectedSourceId)
        ? singleSelectedSourceId
        : null;

    for (const handle of selectedHandles as any[]) {
      if (handle.kind === "node-position") {
        continue;
      }

      if (collapsedDensePathSourceIds.has(handle.sourceRef.sourceId)) {
        if (handle.kind !== "path-point") {
          continue;
        }
        const endpoints = collapsedDensePathEndpointsBySource.get(handle.sourceRef.sourceId);
        if (!endpoints) {
          continue;
        }
        const matchesStart = distanceSquared(handle.world, endpoints.start) <= 1e-6;
        const matchesEnd = distanceSquared(handle.world, endpoints.end) <= 1e-6;
        if (!matchesStart && !matchesEnd) {
          continue;
        }
        const point = worldToSvgPoint(handle.world, svgResult.viewBox);
        displays.push({
          key: `dense-endpoint:${handle.sourceRef.sourceId}:${handle.id}`,
          x: point.x,
          y: point.y,
          cursor: draggableSourceIds.has(handle.sourceRef.sourceId) ? "move" : "not-allowed",
          kind: "move-element",
          elementId: handle.sourceRef.sourceId
        });
        continue;
      }

      if (handle.kind === "path-point" && resizablePathShapeSourceIds.has(handle.sourceRef.sourceId)) {
        continue;
      }

      const point = worldToSvgPoint(handle.world, svgResult.viewBox);
      const isDraggable = dragCapability.draggableHandleIds.has(handle.id);
      displays.push({
        key: `handle:${handle.id}`,
        x: point.x,
        y: point.y,
        cursor: isDraggable ? getHandleCursor(handle, snapshot.scene, snapshot.editHandles) : "not-allowed",
        kind: "move-handle",
        handle
      });
    }

    for (const sourceId of resizeHandleSourceIds) {
      const resizeFrame = resizeFramesBySource.get(sourceId) ?? null;
      if (resizeFrame) {
        for (const role of RESIZE_FRAME_CORNER_ROLES) {
          const corner = resizeFrame.cornersByRole[role];
          const resizeVector = {
            x: corner.world.x - resizeFrame.centerWorld.x,
            y: corner.world.y - resizeFrame.centerWorld.y
          };
          const topLeft = resizeFrame.cornersByRole["top-left"].svg;
          const topRight = resizeFrame.cornersByRole["top-right"].svg;
          const frameRotationDeg = (Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180) / Math.PI;
          displays.push({
            key: `node-handle:${sourceId}:${role}`,
            x: corner.svg.x,
            y: corner.svg.y,
            cursor:
              vectorLengthSquared(resizeVector) > 1e-12
                ? resizeCursorForVector(resizeVector)
                : resizeCursorForRole(role),
            kind: "resize-element",
            elementId: sourceId,
            role,
            rotationDeg: frameRotationDeg
          });
        }
        continue;
      }

      const fallbackBounds = selectionBoundsBySource.get(sourceId) ?? null;
      const bounds = preferredNodeBoundsForSource(
        snapshot.scene?.elements ?? [],
        sourceId,
        svgResult.viewBox,
        fallbackBounds
      );
      if (!bounds) {
        if (resizablePathShapeSourceIds.has(sourceId)) {
          continue;
        }
        const fallback = (selectedHandles as any[]).find((handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "node-position");
        if (!fallback) continue;
        const point = worldToSvgPoint(fallback.world, svgResult.viewBox);
        displays.push({
          key: `node-handle:${sourceId}:center`,
          x: point.x,
          y: point.y,
          cursor: draggableSourceIds.has(sourceId) ? "move" : "not-allowed",
          kind: "move-element",
          elementId: sourceId
        });
        continue;
      }

      displays.push(
        {
          key: `node-handle:${sourceId}:top-left`,
          x: bounds.minX,
          y: bounds.minY,
          cursor: "nwse-resize",
          kind: "resize-element",
          elementId: sourceId,
          role: "top-left",
          rotationDeg: 0
        },
        {
          key: `node-handle:${sourceId}:top-right`,
          x: bounds.maxX,
          y: bounds.minY,
          cursor: "nesw-resize",
          kind: "resize-element",
          elementId: sourceId,
          role: "top-right",
          rotationDeg: 0
        },
        {
          key: `node-handle:${sourceId}:bottom-left`,
          x: bounds.minX,
          y: bounds.maxY,
          cursor: "nesw-resize",
          kind: "resize-element",
          elementId: sourceId,
          role: "bottom-left",
          rotationDeg: 0
        },
        {
          key: `node-handle:${sourceId}:bottom-right`,
          x: bounds.maxX,
          y: bounds.maxY,
          cursor: "nwse-resize",
          kind: "resize-element",
          elementId: sourceId,
          role: "bottom-right",
          rotationDeg: 0
        }
      );
    }

    if (rotateHandleSourceId) {
      const rotateFrame = resizeFramesBySource.get(rotateHandleSourceId) ?? null;
      if (rotateFrame) {
        const rotateHandlePosition = resolveRotateHandlePosition(
          rotateFrame,
          canvasTransform.scale,
          ROTATE_HANDLE_OFFSET_PX
        );
        displays.push({
          key: `node-handle:${rotateHandleSourceId}:rotate`,
          x: rotateHandlePosition.handleSvg.x,
          y: rotateHandlePosition.handleSvg.y,
          anchorX: rotateHandlePosition.anchorSvg.x,
          anchorY: rotateHandlePosition.anchorSvg.y,
          centerWorld: { ...rotateFrame.centerWorld },
          cursor: "grab",
          kind: "rotate-element",
          elementId: rotateHandleSourceId
        });
      }
    }

    return displays;
  }, [ROTATE_HANDLE_OFFSET_PX, canvasTransform.scale, collapsedDensePathEndpointsBySource, collapsedDensePathSourceIds, dragCapability.draggableHandleIds, draggableSourceIds, resizablePathShapeSourceIds, resizeFrameSourceIds, resizeFramesBySource, selectedElementIds, selectedHandles, selectionBoundsBySource, snapshot.editHandles, snapshot.scene, svgResult, toolMode]);

  const hitRegions = useMemo(() => {
    if (!snapshot.scene || !svgResult) return [];
    return buildHitRegions(snapshot.scene.elements, svgResult.viewBox, canvasTransform.scale);
  }, [snapshot.scene, svgResult, canvasTransform.scale]);

  const visibleRanges = useMemo<VisibleRanges | null>(() => {
    if (!svgResult || viewportSize.width <= 0 || viewportSize.height <= 0) return null;
    return computeVisibleRanges(svgResult.viewBox, canvasTransform, viewportSize.width, viewportSize.height);
  }, [svgResult, canvasTransform, viewportSize]);

  const viewportWorldBounds = useMemo(
    () =>
      visibleRanges
        ? {
            minX: visibleRanges.worldMinX,
            minY: visibleRanges.worldMinY,
            maxX: visibleRanges.worldMaxX,
            maxY: visibleRanges.worldMaxY
          }
        : null,
    [visibleRanges]
  );

  return {
    selectedHandles,
    nodeAnchorTargets,
    matrixSourceIds,
    dragCapability,
    adornmentTargetIds,
    draggableSourceIds,
    selectionBounds,
    sceneTextByRegionKey,
    sourceBounds,
    selectionBoundsBySource,
    resizablePathShapeSourceIds,
    nodeResizeSourceIds,
    resizeFrameSourceIds,
    matrixSelectionSourceIds,
    selectionFrameSourceIds,
    resizeFramesBySource,
    selectionBoxes,
    selectedAdornmentConnectors,
    adornmentHighlightBoxes,
    curveControlLines,
    marqueeBounds,
    handleDisplays,
    hitRegions,
    visibleRanges,
    viewportWorldBounds
  };
}

function distanceSquared(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
