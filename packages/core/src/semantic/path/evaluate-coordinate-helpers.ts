import type { WorldPoint } from "../../coords/points.js";
import type { CoordinateForm, CoordinateItem } from "../../ast/types.js";
import { parseLength, parseQuantityExpression } from "../coords/parse-length.js";
import type { EvaluatedCoordinate } from "../coords/evaluate.js";
import { applyMatrixToVector, identityMatrix } from "../transform.js";
import { DEFAULT_GRID_STEP } from "./constants.js";
import type { PlacementSegment } from "./types.js";

function inferSegmentEndHeadingDegrees(segment: PlacementSegment | null): number {
  if (!segment) {
    return 0;
  }

  let direction: WorldPoint | null = null;
  if (segment.kind === "line") {
    direction = {
      x: segment.to.x - segment.from.x,
      y: segment.to.y - segment.from.y
    };
  } else if (segment.kind === "hv") {
    direction = {
      x: segment.to.x - segment.bend.x,
      y: segment.to.y - segment.bend.y
    };
  } else if (segment.kind === "cubic") {
    direction = {
      x: segment.to.x - segment.c2.x,
      y: segment.to.y - segment.c2.y
    };
    if (Math.hypot(direction.x, direction.y) <= 1e-9) {
      direction = {
        x: segment.to.x - segment.from.x,
        y: segment.to.y - segment.from.y
      };
    }
  } else if (segment.kind === "arc") {
    direction = {
      x: segment.to.x - segment.from.x,
      y: segment.to.y - segment.from.y
    };
  }

  if (!direction || Math.hypot(direction.x, direction.y) <= 1e-9) {
    return 0;
  }
  return (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
}

export function evaluateTurnCoordinate(
  item: CoordinateItem,
  currentPoint: WorldPoint | null,
  transform: { a: number; b: number; c: number; d: number; e: number; f: number },
  lastPlacementSegment: PlacementSegment | null
): EvaluatedCoordinate | null {
  const hasTurnOption = item.options?.entries.some(
    (entry) =>
      (entry.kind === "flag" && entry.key === "turn") ||
      (entry.kind === "kv" && entry.key === "turn")
  );
  if (!hasTurnOption) {
    return null;
  }

  const polarForm: CoordinateForm = "polar";
  if (item.form !== "polar") {
    return {
      kind: "invalid",
      world: null,
      coordinateForm: polarForm,
      diagnostics: [`invalid-turn-coordinate:${item.raw}`],
      advancesCurrentPoint: true
    };
  }

  if (!currentPoint) {
    return {
      kind: "invalid",
      world: null,
      coordinateForm: polarForm,
      diagnostics: ["turn-coordinate-without-current-point"],
      advancesCurrentPoint: true
    };
  }

  const angleQuantity = parseQuantityExpression(item.x.trim());
  const radius = parseLength(item.y, "cm");
  if (!angleQuantity || angleQuantity.kind !== "scalar" || radius == null) {
    return {
      kind: "invalid",
      world: null,
      coordinateForm: polarForm,
      diagnostics: [`invalid-polar-coordinate:${item.raw}`],
      advancesCurrentPoint: true
    };
  }

  const heading = inferSegmentEndHeadingDegrees(lastPlacementSegment);
  const absoluteAngle = heading + angleQuantity.value;
  const radians = (absoluteAngle * Math.PI) / 180;
  const localVector = {
    x: radius * Math.cos(radians),
    y: radius * Math.sin(radians)
  };
  const delta = applyMatrixToVector(transform, localVector);

  return {
    kind: "transformed",
    world: {
      x: currentPoint.x + delta.x,
      y: currentPoint.y + delta.y
    },
    local: localVector,
    frame: transform,
    coordinateForm: polarForm,
    relativePrefix: item.relativePrefix,
    diagnostics: [],
    advancesCurrentPoint: true
  };
}

export function resolveDefaultGridStep(
  transform: { a: number; b: number; c: number; d: number },
  axis: "x" | "y"
): number {
  const oneCoordinateUnit = parseLength("1", "cm") ?? DEFAULT_GRID_STEP;
  const vector =
    axis === "x"
      ? applyMatrixToVector(transform, { x: oneCoordinateUnit, y: 0 })
      : applyMatrixToVector(transform, { x: 0, y: oneCoordinateUnit });
  const magnitude = Math.hypot(vector.x, vector.y);
  return Number.isFinite(magnitude) && magnitude > 1e-9 ? magnitude : DEFAULT_GRID_STEP;
}
