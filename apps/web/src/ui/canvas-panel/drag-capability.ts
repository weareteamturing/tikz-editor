import type { EditHandle } from "tikz-editor/semantic/types";

export type DragCapability = {
  draggableHandleIds: ReadonlySet<string>;
  draggableSourceIds: ReadonlySet<string>;
};

export function computeDragCapability(editHandles: readonly EditHandle[]): DragCapability {
  const rewriteTargetsByHandleId = new Map<string, EditHandle | null>();
  for (const handle of editHandles) {
    rewriteTargetsByHandleId.set(handle.id, resolveRewriteTarget(handle, editHandles));
  }

  const draggableHandleIds = new Set<string>();
  for (const handle of editHandles) {
    const rewriteTarget = rewriteTargetsByHandleId.get(handle.id) ?? null;
    if (!rewriteTarget) {
      continue;
    }
    if (rewriteTarget.rewriteMode === "unsupported") {
      if (!isNamedEndpointDetachHandle(handle)) {
        continue;
      }
      if (hasConflictingRewriteTarget(handle, editHandles, rewriteTarget, rewriteTargetsByHandleId)) {
        continue;
      }
      draggableHandleIds.add(handle.id);
      continue;
    }
    if (hasConflictingRewriteTarget(handle, editHandles, rewriteTarget, rewriteTargetsByHandleId)) {
      continue;
    }
    draggableHandleIds.add(handle.id);
  }

  const handlesBySourceId = new Map<string, EditHandle[]>();
  for (const handle of editHandles) {
    const existing = handlesBySourceId.get(handle.sourceId);
    if (existing) {
      existing.push(handle);
    } else {
      handlesBySourceId.set(handle.sourceId, [handle]);
    }
  }

  const draggableSourceIds = new Set<string>();
  for (const [sourceId, handles] of handlesBySourceId) {
    if (handles.length === 0) {
      continue;
    }
    const sourceFullyRewritable = handles.every((handle) => {
      const rewriteTarget = rewriteTargetsByHandleId.get(handle.id) ?? null;
      if (!rewriteTarget || rewriteTarget.rewriteMode === "unsupported") {
        return false;
      }
      return !hasConflictingRewriteTarget(handle, editHandles, rewriteTarget, rewriteTargetsByHandleId);
    });
    if (sourceFullyRewritable) {
      draggableSourceIds.add(sourceId);
    }
  }

  return { draggableHandleIds, draggableSourceIds };
}

function isNamedEndpointDetachHandle(handle: EditHandle): boolean {
  return handle.kind === "path-point" && handle.coordinateForm === "named";
}

function resolveRewriteTarget(handle: EditHandle, editHandles: readonly EditHandle[]): EditHandle | null {
  if (!handle.rewriteTargetHandleId) {
    return handle;
  }
  return editHandles.find((candidate) => candidate.id === handle.rewriteTargetHandleId) ?? null;
}

function hasConflictingRewriteTarget(
  handle: EditHandle,
  allHandles: readonly EditHandle[],
  rewriteTarget: EditHandle,
  rewriteTargetsByHandleId: ReadonlyMap<string, EditHandle | null>
): boolean {
  for (const candidate of allHandles) {
    if (candidate.id === handle.id) {
      continue;
    }
    const candidateRewriteTarget = rewriteTargetsByHandleId.get(candidate.id) ?? null;
    if (!candidateRewriteTarget) {
      continue;
    }
    if (candidateRewriteTarget.id === rewriteTarget.id) {
      continue;
    }
    if (
      candidateRewriteTarget.sourceSpan.from === rewriteTarget.sourceSpan.from &&
      candidateRewriteTarget.sourceSpan.to === rewriteTarget.sourceSpan.to
    ) {
      return true;
    }
  }
  return false;
}
