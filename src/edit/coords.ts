import type { Matrix2D, Point } from "../semantic/types.js";
import { inverseMatrix, applyMatrix, applyMatrixToVector } from "../semantic/transform.js";
import { CM_PER_PT } from "./format.js";

/**
 * Convert a world-space position to local (pre-transform) coordinates.
 * Returns null if the transform is not invertible.
 */
export function worldToLocal(world: Point, transform: Matrix2D): Point | null {
  const inverse = inverseMatrix(transform);
  if (!inverse) {
    return null;
  }
  return applyMatrix(inverse, world);
}

/**
 * Convert a world-space delta to a local-space delta (excludes translation).
 * Returns null if the transform is not invertible.
 */
export function worldDeltaToLocalDelta(delta: Point, transform: Matrix2D): Point | null {
  const inverse = inverseMatrix(transform);
  if (!inverse) {
    return null;
  }
  return applyMatrixToVector(inverse, delta);
}

/**
 * Convert local coordinates (TeX points) to source units (cm).
 */
export function localToSourceUnits(local: Point): Point {
  return {
    x: local.x * CM_PER_PT,
    y: local.y * CM_PER_PT
  };
}
