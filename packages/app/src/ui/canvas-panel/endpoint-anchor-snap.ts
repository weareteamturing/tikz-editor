import type { NodeAnchorTarget, Point } from "tikz-editor/semantic/types";

const NODE_REVEAL_RADIUS_PX = 44;
const SNAP_RADIUS_PX = 12;

export type EndpointAnchorSnapResult = {
  visibleAnchors: NodeAnchorTarget[];
  snappedAnchor: NodeAnchorTarget | null;
};

export type MatrixCellAnchorHint = {
  matrixSourceId: string;
  cellSourceId: string;
  row: number;
  column: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

export function resolveEndpointAnchorSnap(input: {
  pointerWorld: Point;
  zoom: number;
  nodeAnchorTargets: readonly NodeAnchorTarget[];
  matrixCellAnchorHints?: readonly MatrixCellAnchorHint[];
}): EndpointAnchorSnapResult {
  const zoom = Math.max(input.zoom, 1e-6);
  if (input.nodeAnchorTargets.length === 0) {
    return {
      visibleAnchors: [],
      snappedAnchor: null
    };
  }

  const revealNodeRadius = NODE_REVEAL_RADIUS_PX / zoom;
  const snapRadius = SNAP_RADIUS_PX / zoom;
  const revealNodeRadiusSq = revealNodeRadius * revealNodeRadius;
  const snapRadiusSq = snapRadius * snapRadius;

  const byNode = new Map<string, NodeAnchorTarget[]>();
  for (const target of input.nodeAnchorTargets) {
    const existing = byNode.get(target.nodeName);
    if (existing) {
      existing.push(target);
    } else {
      byNode.set(target.nodeName, [target]);
    }
  }

  let nearestNodeAnchors: NodeAnchorTarget[] | null = null;
  let nearestNodeDistanceSq = Number.POSITIVE_INFINITY;
  const nearestMatrixCellHint = resolveNearestMatrixCellHint(input.pointerWorld, input.matrixCellAnchorHints ?? []);
  const preferredMatrixCellAnchors = nearestMatrixCellHint
    ? resolvePreferredMatrixCellAnchors(byNode, nearestMatrixCellHint.row, nearestMatrixCellHint.column, input.pointerWorld)
    : null;
  if (preferredMatrixCellAnchors && preferredMatrixCellAnchors.distanceSq <= revealNodeRadiusSq) {
    nearestNodeAnchors = preferredMatrixCellAnchors.anchors;
    nearestNodeDistanceSq = preferredMatrixCellAnchors.distanceSq;
  }
  for (const anchors of byNode.values()) {
    const extent = deriveNodeExtent(anchors);
    if (!extent) {
      continue;
    }
    const distSq = distanceSquaredToBounds(input.pointerWorld, extent);
    if (distSq < nearestNodeDistanceSq) {
      nearestNodeDistanceSq = distSq;
      nearestNodeAnchors = anchors;
    }
  }

  if (!nearestNodeAnchors || nearestNodeDistanceSq > revealNodeRadiusSq) {
    return {
      visibleAnchors: [],
      snappedAnchor: null
    };
  }

  const visibleAnchorGroups: NodeAnchorTarget[][] = [nearestNodeAnchors];
  const nearestNodeName = nearestNodeAnchors[0]?.nodeName ?? null;
  if (
    preferredMatrixCellAnchors &&
    preferredMatrixCellAnchors.distanceSq <= revealNodeRadiusSq &&
    preferredMatrixCellAnchors.anchors.length > 0
  ) {
    const preferredName = preferredMatrixCellAnchors.anchors[0]?.nodeName ?? null;
    if (preferredName && preferredName !== nearestNodeName) {
      visibleAnchorGroups.push(preferredMatrixCellAnchors.anchors);
    }
    const relatedMatrixAnchors = resolveRelatedMatrixNodeAnchors(byNode, preferredMatrixCellAnchors.anchors, input.pointerWorld);
    if (relatedMatrixAnchors && relatedMatrixAnchors.distanceSq <= revealNodeRadiusSq) {
      const relatedName = relatedMatrixAnchors.anchors[0]?.nodeName ?? null;
      if (
        relatedName &&
        relatedName !== nearestNodeName &&
        relatedName !== preferredName
      ) {
        visibleAnchorGroups.push(relatedMatrixAnchors.anchors);
      }
    }
  }

  const uniqueVisibleAnchors = new Map<string, NodeAnchorTarget>();
  for (const group of visibleAnchorGroups) {
    for (const anchor of group) {
      if (anchor.tier !== "basic") {
        continue;
      }
      uniqueVisibleAnchors.set(`${anchor.nodeName}:${anchor.anchor}`, anchor);
    }
  }
  const visibleAnchors = [...uniqueVisibleAnchors.values()].sort((left, right) => {
    const byNode = left.nodeName.localeCompare(right.nodeName);
    if (byNode !== 0) {
      return byNode;
    }
    return left.anchor.localeCompare(right.anchor);
  });

  let snappedAnchor: NodeAnchorTarget | null = null;
  let snappedDistanceSq = Number.POSITIVE_INFINITY;
  for (const anchor of visibleAnchors) {
    const distSq = distanceSquared(anchor.world, input.pointerWorld);
    if (distSq > snapRadiusSq || distSq >= snappedDistanceSq) {
      continue;
    }
    snappedDistanceSq = distSq;
    snappedAnchor = anchor;
  }

  return {
    visibleAnchors,
    snappedAnchor
  };
}

function resolveNearestMatrixCellHint(
  pointerWorld: Point,
  hints: readonly MatrixCellAnchorHint[]
): MatrixCellAnchorHint | null {
  let nearest: MatrixCellAnchorHint | null = null;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  for (const hint of hints) {
    const distanceSq = distanceSquaredToBounds(pointerWorld, hint.bounds);
    if (distanceSq >= nearestDistanceSq) {
      continue;
    }
    nearest = hint;
    nearestDistanceSq = distanceSq;
  }
  return nearest;
}

function resolvePreferredMatrixCellAnchors(
  anchorsByNode: ReadonlyMap<string, NodeAnchorTarget[]>,
  row: number,
  column: number,
  pointerWorld: Point
): { anchors: NodeAnchorTarget[]; distanceSq: number } | null {
  let best: { anchors: NodeAnchorTarget[]; distanceSq: number } | null = null;
  for (const [nodeName, anchors] of anchorsByNode.entries()) {
    const parsed = parseTrailingMatrixCellIndices(nodeName);
    if (!parsed || parsed.row !== row || parsed.column !== column) {
      continue;
    }
    const extent = deriveNodeExtent(anchors);
    if (!extent) {
      continue;
    }
    const distanceSq = distanceSquaredToBounds(pointerWorld, extent);
    if (!best || distanceSq < best.distanceSq) {
      best = { anchors, distanceSq };
    }
  }
  return best;
}

function resolveRelatedMatrixNodeAnchors(
  anchorsByNode: ReadonlyMap<string, NodeAnchorTarget[]>,
  preferredCellAnchors: readonly NodeAnchorTarget[],
  pointerWorld: Point
): { anchors: NodeAnchorTarget[]; distanceSq: number } | null {
  let best: { anchors: NodeAnchorTarget[]; distanceSq: number } | null = null;
  for (const anchor of preferredCellAnchors) {
    const parsed = parseTrailingMatrixCellIndices(anchor.nodeName);
    if (!parsed) {
      continue;
    }
    const baseNodeName = anchor.nodeName.slice(0, parsed.suffixStart);
    if (!baseNodeName) {
      continue;
    }
    const anchors = anchorsByNode.get(baseNodeName);
    if (!anchors || anchors.length === 0) {
      continue;
    }
    const extent = deriveNodeExtent(anchors);
    if (!extent) {
      continue;
    }
    const distanceSq = distanceSquaredToBounds(pointerWorld, extent);
    if (!best || distanceSq < best.distanceSq) {
      best = { anchors, distanceSq };
    }
  }
  return best;
}

function parseTrailingMatrixCellIndices(nodeName: string): { row: number; column: number; suffixStart: number } | null {
  const match = /-(\d+)-(\d+)$/.exec(nodeName.trim());
  if (!match) {
    return null;
  }
  const row = Number.parseInt(match[1] ?? "", 10);
  const column = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isInteger(row) || !Number.isInteger(column) || row <= 0 || column <= 0) {
    return null;
  }
  return { row, column, suffixStart: match.index };
}

function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function deriveNodeExtent(
  anchors: readonly NodeAnchorTarget[]
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const candidates = anchors.filter((anchor) => anchor.tier === "basic");
  const source = candidates.length > 0 ? candidates : anchors;
  if (source.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const anchor of source) {
    minX = Math.min(minX, anchor.world.x);
    minY = Math.min(minY, anchor.world.y);
    maxX = Math.max(maxX, anchor.world.x);
    maxY = Math.max(maxY, anchor.world.y);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function distanceSquaredToBounds(
  point: Point,
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
): number {
  const clampedX = Math.min(bounds.maxX, Math.max(bounds.minX, point.x));
  const clampedY = Math.min(bounds.maxY, Math.max(bounds.minY, point.y));
  const dx = point.x - clampedX;
  const dy = point.y - clampedY;
  return dx * dx + dy * dy;
}
