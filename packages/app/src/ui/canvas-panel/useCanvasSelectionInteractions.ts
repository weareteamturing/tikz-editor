import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import type { EditHandle } from "tikz-editor/semantic/types";
import type { SvgViewBox } from "tikz-editor/svg/types";
import { resolveScopeAwareContextMenuTarget } from "./scope-overlay";
import { clientToWorldPoint } from "./geometry";

export type UseCanvasSelectionInteractionsArgs = {
  [key: string]: any;
};

export function useCanvasSelectionInteractions(args: UseCanvasSelectionInteractionsArgs) {
  const {
    openCanvasContextMenuAt,
    setTextEditingSession,
    selectedElementIds,
    scopeOverlay,
    focusedScopeId,
    snapshot,
    svgResult,
    interactionSvgRef,
    canvasTransform
  } = args;

  const onElementContextMenu = useCallback(
    (event: ReactMouseEvent<SVGElement>, sourceId: string, region?: any, handleId?: string | null) => {
      event.preventDefault();
      event.stopPropagation();
      const hitSourceId = typeof region?.sourceId === "string" ? region.sourceId : sourceId;
      const resolvedSourceId = resolveScopeAwareContextMenuTarget({
        hitTargetId: sourceId,
        hitSourceId,
        selectedSourceIds: selectedElementIds,
        scopeOverlay,
        focusedScopeId
      });

      let resolvedHandleId = handleId ?? null;
      if (!resolvedHandleId && resolvedSourceId && svgResult) {
        resolvedHandleId = findNearestPathPointHandle(
          event.clientX,
          event.clientY,
          resolvedSourceId,
          snapshot.editHandles,
          interactionSvgRef.current,
          svgResult.viewBox,
          canvasTransform.scale
        );
      }

      openCanvasContextMenuAt(event.clientX, event.clientY, resolvedSourceId, resolvedHandleId);
    },
    [focusedScopeId, openCanvasContextMenuAt, scopeOverlay, selectedElementIds, snapshot.editHandles, svgResult, interactionSvgRef, canvasTransform.scale]
  );

  const onCanvasContextMenu = useCallback(
    (event: ReactMouseEvent<SVGElement | HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setTextEditingSession(null);
      openCanvasContextMenuAt(event.clientX, event.clientY, null);
    },
    [openCanvasContextMenuAt, setTextEditingSession]
  );

  return {
    onElementContextMenu,
    onCanvasContextMenu
  };
}

/** Threshold in screen pixels for snapping right-click to nearest path-point handle. */
const CONTEXT_MENU_HANDLE_THRESHOLD_PX = 12;

function findNearestPathPointHandle(
  clientX: number,
  clientY: number,
  sourceId: string,
  editHandles: readonly EditHandle[],
  svgElement: SVGSVGElement | null,
  viewBox: SvgViewBox,
  zoom: number
): string | null {
  const world = clientToWorldPoint(clientX, clientY, svgElement, viewBox);
  if (!world) return null;

  const thresholdWorld = CONTEXT_MENU_HANDLE_THRESHOLD_PX / zoom;
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const handle of editHandles) {
    if (handle.sourceRef.sourceId !== sourceId || handle.kind !== "path-point") continue;
    const dist = Math.hypot(handle.world.x - world.x, handle.world.y - world.y);
    if (dist < bestDist && dist <= thresholdWorld) {
      bestDist = dist;
      bestId = handle.id;
    }
  }

  return bestId;
}
