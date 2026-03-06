import type { EditAction } from "tikz-editor/edit/actions";
import type { NodeAnchorTarget, Point } from "tikz-editor/semantic/types";

export function resolveHandleDragAction(input: {
  handleId: string;
  newWorld: Point;
  activeEndpointAnchor: NodeAnchorTarget | null;
}): EditAction {
  if (input.activeEndpointAnchor) {
    return {
      kind: "connectHandle",
      handleId: input.handleId,
      nodeName: input.activeEndpointAnchor.nodeName,
      anchor: input.activeEndpointAnchor.anchor
    };
  }

  return {
    kind: "moveHandle",
    handleId: input.handleId,
    newWorld: input.newWorld
  };
}

export function shouldCommitHandleAnchorOnPointerUp(input: {
  snapshotSource: string;
  source: string;
  activeEndpointAnchor: NodeAnchorTarget | null;
}): boolean {
  return input.snapshotSource === input.source && input.activeEndpointAnchor != null;
}
