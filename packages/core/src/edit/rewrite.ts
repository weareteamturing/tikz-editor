import type { EditHandle, Point } from "../semantic/types.js";
import { worldToLocal, worldDeltaToLocalDelta, localToSourceUnits } from "./coords.js";
import { formatNumber } from "./format.js";
import { formatCoordinate, formatPolarCoordinate } from "./style.js";

/**
 * Compute a replacement source string for moving a handle to a new world position.
 * Returns null if the rewrite cannot be performed.
 */
export function rewriteCoordinate(
  newWorld: Point,
  handle: EditHandle,
  source: string
): string | null {
  if (handle.rewriteMode === "unsupported") {
    return rewriteUnsupportedCoordinate(newWorld, handle, source);
  }

  if (handle.rewriteMode === "delta") {
    return rewriteDelta(newWorld, handle, source);
  }

  switch (handle.coordinateForm) {
    case "cartesian":
      return rewriteCartesian(newWorld, handle, source);
    case "polar":
      return rewritePolar(newWorld, handle, source);
    case "xyz":
      return null;
    default:
      return null;
  }
}

export function supportsUnsupportedCoordinateDetach(handle: EditHandle): boolean {
  return handle.kind === "path-point" && handle.coordinateForm === "named";
}

function rewriteUnsupportedCoordinate(
  newWorld: Point,
  handle: EditHandle,
  source: string
): string | null {
  if (!supportsUnsupportedCoordinateDetach(handle)) {
    return null;
  }

  return rewriteCartesian(newWorld, {
    ...handle,
    coordinateForm: "cartesian"
  }, source);
}

function rewriteCartesian(
  newWorld: Point,
  handle: EditHandle,
  source: string
): string | null {
  const local = worldToLocal(newWorld, handle.transform);
  if (!local) {
    return null;
  }
  const cm = localToSourceUnits(local);
  const oldRaw = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  const coordinate = formatCoordinate(oldRaw, formatNumber(cm.x), formatNumber(cm.y));
  return applyInsertionSyntax(source, handle, coordinate);
}

function rewritePolar(
  newWorld: Point,
  handle: EditHandle,
  source: string
): string | null {
  const local = worldToLocal(newWorld, handle.transform);
  if (!local) {
    return null;
  }
  const cm = localToSourceUnits(local);
  const { angleDeg, radius } = toPolar(cm);
  const oldRaw = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  const coordinate = formatPolarCoordinate(oldRaw, formatNumber(angleDeg), formatNumber(radius));
  return applyInsertionSyntax(source, handle, coordinate);
}

function rewriteDelta(
  newWorld: Point,
  handle: EditHandle,
  source: string
): string | null {
  const base = handle.relativeBaseWorld;
  if (!base) {
    return null;
  }
  const delta: Point = {
    x: newWorld.x - base.x,
    y: newWorld.y - base.y
  };
  const localDelta = worldDeltaToLocalDelta(delta, handle.transform);
  if (!localDelta) {
    return null;
  }
  const cm = localToSourceUnits(localDelta);
  const oldRaw = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  if (handle.coordinateForm === "polar") {
    const { angleDeg, radius } = toPolar(cm);
    const coordinate = formatPolarCoordinate(oldRaw, formatNumber(angleDeg), formatNumber(radius));
    return applyInsertionSyntax(source, handle, coordinate);
  }
  if (handle.coordinateForm === "xyz") {
    return null;
  }
  const coordinate = formatCoordinate(oldRaw, formatNumber(cm.x), formatNumber(cm.y));
  return applyInsertionSyntax(source, handle, coordinate);
}

function applyInsertionSyntax(source: string, handle: EditHandle, coordinate: string): string {
  if (!handle.insertion) {
    return coordinate;
  }

  if (handle.insertion.kind === "node-inline-at") {
    const offset = handle.sourceRef.sourceSpan.from;
    const previousChar = offset > 0 ? source[offset - 1] : "";
    const nextChar = offset < source.length ? source[offset] : "";
    const leading = previousChar.length > 0 && !/\s/.test(previousChar) ? " " : "";
    const trailing = nextChar.length > 0 && !/\s/.test(nextChar) && nextChar !== ";" ? " " : "";
    return `${leading}at ${coordinate}${trailing}`;
  }

  return coordinate;
}

function toPolar(point: Point): { angleDeg: number; radius: number } {
  const radius = Math.sqrt(point.x * point.x + point.y * point.y);
  let angleDeg = (Math.atan2(point.y, point.x) * 180) / Math.PI;
  if (angleDeg < 0) {
    angleDeg += 360;
  }
  return { angleDeg, radius };
}
