import type { NodeAnchorTarget, Point } from "tikz-editor/semantic/types";

const NODE_REVEAL_RADIUS_PX = 44;
const SNAP_RADIUS_PX = 12;

export type EndpointAnchorSnapResult = {
  visibleAnchors: NodeAnchorTarget[];
  snappedAnchor: NodeAnchorTarget | null;
};

export function resolveEndpointAnchorSnap(input: {
  pointerWorld: Point;
  zoom: number;
  nodeAnchorTargets: readonly NodeAnchorTarget[];
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

  const visibleAnchors = nearestNodeAnchors
    .filter((anchor) => anchor.tier === "basic")
    .sort((left, right) => {
      if (left.tier !== right.tier) {
        return left.tier === "basic" ? -1 : 1;
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
