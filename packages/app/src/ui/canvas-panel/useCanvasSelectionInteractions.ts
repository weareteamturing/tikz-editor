import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { resolveScopeAwareSelectionTarget } from "./scope-overlay";

export type UseCanvasSelectionInteractionsArgs = {
  [key: string]: any;
};

export function useCanvasSelectionInteractions(args: UseCanvasSelectionInteractionsArgs) {
  const {
    openCanvasContextMenuAt,
    setTextEditingSession,
    selectedElementIds,
    scopeOverlay
  } = args;

  const onElementContextMenu = useCallback(
    (event: ReactMouseEvent<SVGElement>, sourceId: string, region?: any, handleId?: string | null) => {
      event.preventDefault();
      event.stopPropagation();
      const hitSourceId = typeof region?.sourceId === "string" ? region.sourceId : sourceId;
      const resolvedSourceId = resolveScopeAwareSelectionTarget({
        hitTargetId: sourceId,
        hitSourceId,
        selectedSourceIds: selectedElementIds,
        additiveSelection: false,
        scopeOverlay,
        allowDrillDown: false
      });
      openCanvasContextMenuAt(event.clientX, event.clientY, resolvedSourceId, handleId ?? null);
    },
    [openCanvasContextMenuAt, scopeOverlay, selectedElementIds]
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
