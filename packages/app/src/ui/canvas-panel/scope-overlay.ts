import type { Statement } from "tikz-editor/ast/types";
import type { SceneElement } from "tikz-editor/semantic/types";
import type { Bounds } from "./types";

export type ScopeOverlayNode = {
  scopeId: string;
  parentScopeId: string | null;
  childStatementIds: string[];
  bounds: Bounds | null;
};

export type ScopeOverlayIndex = {
  scopesById: Map<string, ScopeOverlayNode>;
  ancestorScopeIdsBySourceId: Map<string, string[]>;
  boundsByScopeId: Map<string, Bounds>;
};

export type ResolveScopeAwareSelectionTargetInput = {
  hitTargetId: string;
  hitSourceId: string;
  scopeOverlay: ScopeOverlayIndex;
  focusedScopeId?: string | null;
};

export function buildScopeOverlayIndex(
  statements: readonly Statement[] | undefined,
  boundsBySourceId: ReadonlyMap<string, Bounds>
): ScopeOverlayIndex {
  const scopesById = new Map<string, ScopeOverlayNode>();
  const ancestorScopeIdsBySourceId = new Map<string, string[]>();
  const boundsByScopeId = new Map<string, Bounds>();

  if (!statements || statements.length === 0) {
    return {
      scopesById,
      ancestorScopeIdsBySourceId,
      boundsByScopeId
    };
  }

  const visit = (
    items: readonly Statement[],
    parentScopeId: string | null,
    ancestors: string[]
  ): Bounds | null => {
    let mergedBounds: Bounds | null = null;

    for (const statement of items) {
      ancestorScopeIdsBySourceId.set(statement.id, [...ancestors]);

      if (statement.kind !== "Scope") {
        const ownBounds = boundsBySourceId.get(statement.id) ?? null;
        if (ownBounds) {
          mergedBounds = mergedBounds ? mergeBounds(mergedBounds, ownBounds) : ownBounds;
        }
        continue;
      }

      const childBounds = visit(statement.body, statement.id, [...ancestors, statement.id]);
      scopesById.set(statement.id, {
        scopeId: statement.id,
        parentScopeId,
        childStatementIds: statement.body.map((entry) => entry.id),
        bounds: childBounds
      });
      if (childBounds) {
        boundsByScopeId.set(statement.id, childBounds);
        mergedBounds = mergedBounds ? mergeBounds(mergedBounds, childBounds) : childBounds;
      }
    }

    return mergedBounds;
  };

  visit(statements, null, []);

  return {
    scopesById,
    ancestorScopeIdsBySourceId,
    boundsByScopeId
  };
}

export function augmentScopeOverlayWithMatrices(
  baseOverlay: ScopeOverlayIndex,
  sceneElements: readonly SceneElement[] | undefined,
  boundsBySourceId: ReadonlyMap<string, Bounds>
): ScopeOverlayIndex {
  if (!sceneElements || sceneElements.length === 0) {
    return baseOverlay;
  }

  const matrixToCells = new Map<string, Set<string>>();
  for (const element of sceneElements) {
    const matrixCell = element.matrixCell;
    if (!matrixCell) {
      continue;
    }
    const matrixId = matrixCell.matrixSourceId.trim();
    const cellId = matrixCell.cellSourceId.trim();
    if (matrixId.length === 0 || cellId.length === 0) {
      continue;
    }
    let cells = matrixToCells.get(matrixId);
    if (!cells) {
      cells = new Set<string>();
      matrixToCells.set(matrixId, cells);
    }
    cells.add(cellId);
  }

  if (matrixToCells.size === 0) {
    return baseOverlay;
  }

  const scopesById = new Map(baseOverlay.scopesById);
  const ancestorScopeIdsBySourceId = new Map(baseOverlay.ancestorScopeIdsBySourceId);
  const boundsByScopeId = new Map(baseOverlay.boundsByScopeId);

  for (const [matrixSourceId, cellIds] of matrixToCells.entries()) {
    const matrixAncestors = ancestorScopeIdsBySourceId.get(matrixSourceId) ?? [];
    const parentScopeId = matrixAncestors.length > 0 ? matrixAncestors[matrixAncestors.length - 1] ?? null : null;

    let matrixBounds = boundsBySourceId.get(matrixSourceId) ?? null;
    if (!matrixBounds) {
      for (const cellId of cellIds) {
        const cellBounds = boundsBySourceId.get(cellId);
        if (!cellBounds) {
          continue;
        }
        matrixBounds = matrixBounds ? mergeBounds(matrixBounds, cellBounds) : cellBounds;
      }
    }

    scopesById.set(matrixSourceId, {
      scopeId: matrixSourceId,
      parentScopeId,
      childStatementIds: [...cellIds],
      bounds: matrixBounds
    });

    ancestorScopeIdsBySourceId.set(matrixSourceId, [...matrixAncestors]);
    if (matrixBounds) {
      boundsByScopeId.set(matrixSourceId, matrixBounds);
    }

    for (const cellId of cellIds) {
      const existingAncestors = ancestorScopeIdsBySourceId.get(cellId) ?? matrixAncestors;
      const withoutMatrix = existingAncestors.filter((ancestorId) => ancestorId !== matrixSourceId);
      ancestorScopeIdsBySourceId.set(cellId, [...withoutMatrix, matrixSourceId]);
    }
  }

  return {
    scopesById,
    ancestorScopeIdsBySourceId,
    boundsByScopeId
  };
}

export function augmentScopeOverlayWithTrees(
  baseOverlay: ScopeOverlayIndex,
  sceneElements: readonly SceneElement[] | undefined,
  boundsBySourceId: ReadonlyMap<string, Bounds>
): ScopeOverlayIndex {
  if (!sceneElements || sceneElements.length === 0) {
    return baseOverlay;
  }

  // Collect tree parent → child metadata.
  // A "parent" is either the root statement or a child that itself has children.
  const parentToChildrenInfo = new Map<string, Map<string, NonNullable<SceneElement["treeChild"]>>>();
  const childInfoByChildId = new Map<string, NonNullable<SceneElement["treeChild"]>>();

  for (const element of sceneElements) {
    const tc = element.treeChild;
    if (!tc) {
      continue;
    }
    if (!childInfoByChildId.has(tc.childSourceId)) {
      childInfoByChildId.set(tc.childSourceId, tc);
    }
    let children = parentToChildrenInfo.get(tc.parentSourceId);
    if (!children) {
      children = new Map<string, NonNullable<SceneElement["treeChild"]>>();
      parentToChildrenInfo.set(tc.parentSourceId, children);
    }
    children.set(tc.childSourceId, tc);
  }

  if (parentToChildrenInfo.size === 0) {
    return baseOverlay;
  }

  const parentToChildren = new Map<string, string[]>();
  for (const [parentSourceId, childInfoMap] of parentToChildrenInfo.entries()) {
    const orderedChildren = [...childInfoMap.values()]
      .sort((a, b) => a.childIndex - b.childIndex)
      .map((entry) => entry.childSourceId);
    parentToChildren.set(parentSourceId, orderedChildren);
  }

  const scopesById = new Map(baseOverlay.scopesById);
  const ancestorScopeIdsBySourceId = new Map(baseOverlay.ancestorScopeIdsBySourceId);
  const boundsByScopeId = new Map(baseOverlay.boundsByScopeId);

  const ancestorCache = new Map<string, string[]>();
  const ancestorVisiting = new Set<string>();
  const resolveAncestors = (sourceId: string): string[] => {
    const cached = ancestorCache.get(sourceId);
    if (cached) {
      return cached;
    }
    if (ancestorVisiting.has(sourceId)) {
      return [];
    }
    ancestorVisiting.add(sourceId);
    const childInfo = childInfoByChildId.get(sourceId);
    let ancestors: string[];
    if (childInfo) {
      const parentAncestors = resolveAncestors(childInfo.parentSourceId);
      ancestors = [...parentAncestors, childInfo.parentSourceId];
    } else {
      ancestors = [...(ancestorScopeIdsBySourceId.get(sourceId) ?? [])];
    }
    ancestorVisiting.delete(sourceId);
    ancestorCache.set(sourceId, ancestors);
    return ancestors;
  };

  const boundsCache = new Map<string, Bounds | null>();
  const boundsVisiting = new Set<string>();
  const resolveSubtreeBounds = (sourceId: string): Bounds | null => {
    if (boundsCache.has(sourceId)) {
      return boundsCache.get(sourceId) ?? null;
    }
    if (boundsVisiting.has(sourceId)) {
      return boundsBySourceId.get(sourceId) ?? null;
    }
    boundsVisiting.add(sourceId);
    let merged = boundsBySourceId.get(sourceId) ?? null;
    for (const childId of parentToChildren.get(sourceId) ?? []) {
      const childBounds = resolveSubtreeBounds(childId);
      if (childBounds) {
        merged = merged ? mergeBounds(merged, childBounds) : childBounds;
      }
    }
    boundsVisiting.delete(sourceId);
    boundsCache.set(sourceId, merged);
    return merged;
  };

  // Build scope for every node that has children (root or intermediate).
  for (const [parentId, childIds] of parentToChildren.entries()) {
    const parentAncestors = resolveAncestors(parentId);
    const parentScopeId = parentAncestors.length > 0 ? parentAncestors[parentAncestors.length - 1] ?? null : null;
    const scopeBounds = resolveSubtreeBounds(parentId);

    scopesById.set(parentId, {
      scopeId: parentId,
      parentScopeId,
      childStatementIds: [...childIds],
      bounds: scopeBounds
    });

    ancestorScopeIdsBySourceId.set(parentId, [...parentAncestors]);
    if (scopeBounds) {
      boundsByScopeId.set(parentId, scopeBounds);
    }

    // Register each child with ancestors including this parent scope.
    for (const childId of childIds) {
      ancestorScopeIdsBySourceId.set(childId, [...parentAncestors, parentId]);
    }
  }

  return {
    scopesById,
    ancestorScopeIdsBySourceId,
    boundsByScopeId
  };
}

export function resolveScopeAwareSelectionTarget(
  input: ResolveScopeAwareSelectionTargetInput
): string {
  return resolveScopeAwarePointerDownTarget(input);
}

export function resolveScopeAwarePointerDownTarget(
  input: ResolveScopeAwareSelectionTargetInput
): string {
  const { hitTargetId, hitSourceId, scopeOverlay, focusedScopeId = null } = input;
  const ancestorScopes = scopeOverlay.ancestorScopeIdsBySourceId.get(hitSourceId) ?? [];
  const outermost = resolveOutermostScopeUnderFocus(ancestorScopes, focusedScopeId);
  return outermost ?? hitTargetId;
}

export function resolveScopeAwarePointerUpDrillTarget(input: {
  selectedScopeId: string | null;
  hitSourceId: string;
  scopeOverlay: ScopeOverlayIndex;
}): string | null {
  const { selectedScopeId, hitSourceId, scopeOverlay } = input;
  if (!selectedScopeId || !scopeOverlay.scopesById.has(selectedScopeId)) {
    return null;
  }
  const ancestorScopes = scopeOverlay.ancestorScopeIdsBySourceId.get(hitSourceId) ?? [];
  return resolveDirectChildWithinScope(selectedScopeId, hitSourceId, ancestorScopes);
}

export function resolveScopeAwareContextMenuTarget(input: {
  hitTargetId: string;
  hitSourceId: string;
  selectedSourceIds: ReadonlySet<string>;
  scopeOverlay: ScopeOverlayIndex;
  focusedScopeId?: string | null;
}): string {
  const {
    hitTargetId,
    hitSourceId,
    selectedSourceIds,
    scopeOverlay,
    focusedScopeId = null
  } = input;
  const singleSelectedId = selectedSourceIds.size === 1 ? [...selectedSourceIds][0] ?? null : null;
  const ancestorScopes = scopeOverlay.ancestorScopeIdsBySourceId.get(hitSourceId) ?? [];

  if (
    singleSelectedId &&
    (singleSelectedId === hitTargetId || singleSelectedId === hitSourceId)
  ) {
    return singleSelectedId;
  }

  if (singleSelectedId && scopeOverlay.scopesById.has(singleSelectedId) && ancestorScopes.includes(singleSelectedId)) {
    return singleSelectedId;
  }

  return resolveScopeAwarePointerDownTarget({
    hitTargetId,
    hitSourceId,
    scopeOverlay,
    focusedScopeId
  });
}

export function resolveScopeAwareMarqueeSelection(input: {
  selectionBounds: Bounds;
  sourceBoundsById: ReadonlyMap<string, Bounds>;
  scopeOverlay: ScopeOverlayIndex;
}): string[] {
  const { selectionBounds, sourceBoundsById, scopeOverlay } = input;
  const selectedScopeIds = new Set<string>();

  for (const [scopeId, bounds] of scopeOverlay.boundsByScopeId) {
    if (boundsContainedWithin(bounds, selectionBounds)) {
      selectedScopeIds.add(scopeId);
    }
  }

  const selectedIds: string[] = [];
  for (const [sourceId, bounds] of sourceBoundsById) {
    if (!boundsContainedWithin(bounds, selectionBounds)) {
      continue;
    }
    const ancestors = scopeOverlay.ancestorScopeIdsBySourceId.get(sourceId) ?? [];
    if (ancestors.length === 0) {
      selectedIds.push(sourceId);
    }
  }

  for (const scopeId of selectedScopeIds) {
    const ancestors = scopeOverlay.ancestorScopeIdsBySourceId.get(scopeId) ?? [];
    if (ancestors.some((ancestorId) => selectedScopeIds.has(ancestorId))) {
      continue;
    }
    selectedIds.push(scopeId);
  }

  return selectedIds;
}

export function resolveFocusedScopeIdForSelection(
  selectedSourceId: string,
  scopeOverlay: ScopeOverlayIndex
): string | null {
  const selectedScope = scopeOverlay.scopesById.get(selectedSourceId);
  if (selectedScope) {
    return selectedScope.parentScopeId;
  }
  const ancestors = scopeOverlay.ancestorScopeIdsBySourceId.get(selectedSourceId) ?? [];
  return ancestors.length > 0 ? ancestors[ancestors.length - 1]! : null;
}

export function isSourceWithinScope(
  scopeId: string | null | undefined,
  sourceId: string,
  scopeOverlay: ScopeOverlayIndex
): boolean {
  if (!scopeId) {
    return false;
  }
  const ancestors = scopeOverlay.ancestorScopeIdsBySourceId.get(sourceId) ?? [];
  return ancestors.includes(scopeId);
}

export function isWorldPointWithinScopeBounds(
  scopeId: string | null | undefined,
  world: { x: number; y: number },
  scopeOverlay: ScopeOverlayIndex
): boolean {
  if (!scopeId) {
    return false;
  }
  const bounds = scopeOverlay.boundsByScopeId.get(scopeId);
  if (!bounds) {
    return false;
  }
  return (
    world.x >= bounds.minX &&
    world.x <= bounds.maxX &&
    world.y >= bounds.minY &&
    world.y <= bounds.maxY
  );
}

function resolveDirectChildWithinScope(
  scopeId: string,
  hitSourceId: string,
  ancestorScopes: readonly string[]
): string | null {
  const scopeIndex = ancestorScopes.indexOf(scopeId);
  if (scopeIndex < 0) {
    return null;
  }
  if (scopeIndex < ancestorScopes.length - 1) {
    return ancestorScopes[scopeIndex + 1] ?? null;
  }
  return hitSourceId;
}

function resolveOutermostScopeUnderFocus(
  ancestorScopes: readonly string[],
  focusedScopeId: string | null
): string | null {
  if (ancestorScopes.length === 0) {
    return null;
  }
  if (!focusedScopeId) {
    return ancestorScopes[0] ?? null;
  }
  const focusedIndex = ancestorScopes.indexOf(focusedScopeId);
  if (focusedIndex < 0) {
    return ancestorScopes[0] ?? null;
  }
  if (focusedIndex >= ancestorScopes.length - 1) {
    return null;
  }
  return ancestorScopes[focusedIndex + 1] ?? null;
}

function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

function boundsContainedWithin(inner: Bounds, outer: Bounds): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}
