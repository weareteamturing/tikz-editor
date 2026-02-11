import type { CoordinateItem } from "../../ast/types.js";
import { parseCoordinate } from "../../domains/coordinates/parse.js";
import type { SemanticContext } from "../context.js";
import type { Point } from "../types.js";
import { applyMatrix, applyMatrixToVector } from "../transform.js";
import { parseLength } from "./parse-length.js";

export type EvaluatedCoordinate = {
  point: Point | null;
  diagnostics: string[];
  advancesCurrentPoint: boolean;
};

export function evaluateCoordinate(item: CoordinateItem, context: SemanticContext): EvaluatedCoordinate {
  const diagnostics: string[] = [];
  const frame = context.stack[context.stack.length - 1];

  if (item.form === "named") {
    const named = context.namedCoordinates.get(item.x.trim());
    if (!named) {
      diagnostics.push(`unknown-named-coordinate:${item.x.trim()}`);
      return { point: null, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }
    return {
      point: named,
      diagnostics,
      advancesCurrentPoint: item.relativePrefix === "++"
    };
  }

  if (item.form === "calc" || item.form === "explicit" || item.form === "unknown" || item.form === "xyz") {
    diagnostics.push(`unsupported-coordinate-form:${item.form}`);
    return { point: null, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
  }

  let localPoint: Point | null = null;

  if (item.form === "polar") {
    const angle = Number(item.x.trim());
    const radius = parseLength(item.y, "cm");
    if (!Number.isFinite(angle) || radius == null) {
      diagnostics.push(`invalid-polar-coordinate:${item.raw}`);
      return { point: null, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }

    const radians = (angle * Math.PI) / 180;
    localPoint = {
      x: radius * Math.cos(radians),
      y: radius * Math.sin(radians)
    };
  } else {
    const x = parseLength(item.x, "cm");
    const y = parseLength(item.y, "cm");
    if (x == null || y == null) {
      diagnostics.push(`invalid-cartesian-coordinate:${item.raw}`);
      return { point: null, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }

    localPoint = { x, y };
  }

  if (!localPoint) {
    return { point: null, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
  }

  if (item.relativePrefix) {
    const current = context.currentPoint;
    if (!current) {
      diagnostics.push("relative-coordinate-without-current-point");
      return { point: null, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }
    const delta = applyMatrixToVector(frame.transform, localPoint);
    return {
      point: {
        x: current.x + delta.x,
        y: current.y + delta.y
      },
      diagnostics,
      advancesCurrentPoint: item.relativePrefix === "++"
    };
  }

  return {
    point: applyMatrix(frame.transform, localPoint),
    diagnostics,
    advancesCurrentPoint: true
  };
}

export function evaluateRawCoordinate(
  raw: string,
  context: SemanticContext,
  relativePrefix?: CoordinateItem["relativePrefix"]
): EvaluatedCoordinate {
  const parsed = parseCoordinate(raw);
  const pseudo: CoordinateItem = {
    kind: "Coordinate",
    id: "raw-coordinate",
    span: { from: 0, to: raw.length },
    relativePrefix,
    x: parsed.x,
    y: parsed.y,
    z: parsed.z,
    raw,
    form: parsed.form,
    optionsSpan: parsed.optionsSpan
      ? {
          from: parsed.optionsSpan.from,
          to: parsed.optionsSpan.to
        }
      : undefined,
    options: undefined
  };
  return evaluateCoordinate(pseudo, context);
}
