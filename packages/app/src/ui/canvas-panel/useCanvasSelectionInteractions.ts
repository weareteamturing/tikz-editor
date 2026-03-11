import { useCallback, type MouseEvent as ReactMouseEvent } from "react";

export type UseCanvasSelectionInteractionsArgs = {
  [key: string]: any;
};

export function useCanvasSelectionInteractions(args: UseCanvasSelectionInteractionsArgs) {
  const {
    openCanvasContextMenuAt,
    setTextEditingSession
  } = args;

  const onElementContextMenu = useCallback(
    (event: ReactMouseEvent<SVGElement>, sourceId: string, _region?: any, handleId?: string | null) => {
      event.preventDefault();
      event.stopPropagation();
      openCanvasContextMenuAt(event.clientX, event.clientY, sourceId, handleId ?? null);
    },
    [openCanvasContextMenuAt]
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
