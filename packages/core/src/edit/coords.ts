import type { FrameLocalPoint, SourceCmPoint, WorldPoint } from "../coords/points.js";
import type { FrameTransform } from "../coords/transforms.js";
import { ptToCm } from "../coords/source.js";
import { unsafePoint } from "../coords/points.js";
import { worldToFrameLocal, worldVectorToFrameLocal } from "../coords/frame.js";

/**
 * Convert a world-space position to local (pre-transform) coordinates.
 * Returns null if the transform is not invertible.
 */
export function worldToFrameLocalPoint(world: WorldPoint, transform: FrameTransform): FrameLocalPoint | null {
  return worldToFrameLocal(world as FrameLocalPoint & WorldPoint, transform);
}

/**
 * Convert a world-space delta to a local-space delta (excludes translation).
 * Returns null if the transform is not invertible.
 */
export function worldVectorToFrameLocalPoint(delta: WorldPoint, transform: FrameTransform): FrameLocalPoint | null {
  return worldVectorToFrameLocal(delta as FrameLocalPoint & WorldPoint, transform);
}

/**
 * Convert local coordinates (TeX points) to source units (cm).
 */
export function frameLocalPtToSourceCmPoint(local: FrameLocalPoint): SourceCmPoint {
  return unsafePoint<SourceCmPoint>(ptToCm(local.x as never).valueOf(), ptToCm(local.y as never).valueOf());
}

export const worldToLocal = worldToFrameLocalPoint;
export const worldDeltaToLocalDelta = worldVectorToFrameLocalPoint;
export const localToSourceUnits = frameLocalPtToSourceCmPoint;
