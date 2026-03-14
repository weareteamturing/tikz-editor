import type { Statement } from "tikz-editor/ast/types";
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
  selectedSourceIds: ReadonlySet<string>;
  additiveSelection: boolean;
  scopeOverlay: ScopeOverlayIndex;
  allowDrillDown?: boolean;
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

export function resolveScopeAwareSelectionTarget(
  input: ResolveScopeAwareSelectionTargetInput
): string {
  const {
    hitTargetId,
    hitSourceId,
    selectedSourceIds,
    additiveSelection,
    scopeOverlay,
    allowDrillDown = true
  } = input;

  if (additiveSelection) {
    return hitTargetId;
  }

  const ancestorScopes = scopeOverlay.ancestorScopeIdsBySourceId.get(hitSourceId) ?? [];
  const singleSelectedId = selectedSourceIds.size === 1 ? [...selectedSourceIds][0] ?? null : null;
  if (
    singleSelectedId &&
    (singleSelectedId === hitTargetId || singleSelectedId === hitSourceId)
  ) {
    return singleSelectedId;
  }
  if (singleSelectedId && scopeOverlay.scopesById.has(singleSelectedId)) {
    if (!allowDrillDown) {
      if (ancestorScopes.includes(singleSelectedId)) {
        return singleSelectedId;
      }
    } else {
      const directChild = resolveDirectChildWithinScope(singleSelectedId, hitSourceId, ancestorScopes);
      if (directChild) {
        return directChild;
      }
    }
  }

  if (ancestorScopes.length > 0) {
    return ancestorScopes[ancestorScopes.length - 1]!;
  }

  return hitTargetId;
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

function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}
