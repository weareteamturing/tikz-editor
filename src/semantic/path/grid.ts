import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import type { PathOptionItem } from "../../ast/types.js";
import { applyMatrixToVector } from "../transform.js";
import type { Point, ResolvedStyle, ScenePath } from "../types.js";
import type { DiagnosticPushFn } from "./types.js";
import type { SemanticContext } from "../context.js";
import { parseCoordinateLike, parseLength } from "../coords/parse-length.js";
import { coordinateInner, normalizeOptionValue, toRadians } from "./shared.js";
import { DEFAULT_GRID_STEP } from "./constants.js";

export function extractGridSteps(
  item: PathOptionItem,
  pushDiagnostic: DiagnosticPushFn,
  context: SemanticContext
): { stepX?: number; stepY?: number } | null {
  let stepX: number | undefined;
  let stepY: number | undefined;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "step") {
      const pair = parseCoordinateLike(entry.valueRaw);
      if (pair) {
        const parsedX = parseLength(pair.x, "cm");
        const parsedY = parseLength(pair.y, "cm");
        if (parsedX == null || parsedY == null || parsedX < 0 || parsedY < 0) {
          pushDiagnostic("invalid-grid-step", "Grid `step` coordinate must provide positive lengths.", entry.span.from, entry.span.to);
          continue;
        }
        stepX = resolveGridAxisStep(parsedX, "x", hasExplicitLengthUnit(pair.x), context);
        stepY = resolveGridAxisStep(parsedY, "y", hasExplicitLengthUnit(pair.y), context);
        continue;
      }

      const polar = parsePolarStep(entry.valueRaw);
      if (polar) {
        stepX = Math.abs(polar.x);
        stepY = Math.abs(polar.y);
        continue;
      }

      const scalar = parseLength(entry.valueRaw, "cm");
      if (scalar == null || scalar < 0) {
        pushDiagnostic("invalid-grid-step", "Grid `step` must be a positive length.", entry.span.from, entry.span.to);
        continue;
      }
      const hasUnit = hasExplicitLengthUnit(entry.valueRaw);
      stepX = resolveGridAxisStep(scalar, "x", hasUnit, context);
      stepY = resolveGridAxisStep(scalar, "y", hasUnit, context);
      continue;
    }

    if (entry.key === "xstep" || entry.key === "x step") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed == null || parsed < 0) {
        pushDiagnostic("invalid-grid-step", "Grid `xstep` must be a positive length.", entry.span.from, entry.span.to);
        continue;
      }
      stepX = resolveGridAxisStep(parsed, "x", hasExplicitLengthUnit(entry.valueRaw), context);
      continue;
    }

    if (entry.key === "ystep" || entry.key === "y step") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed == null || parsed < 0) {
        pushDiagnostic("invalid-grid-step", "Grid `ystep` must be a positive length.", entry.span.from, entry.span.to);
        continue;
      }
      stepY = resolveGridAxisStep(parsed, "y", hasExplicitLengthUnit(entry.valueRaw), context);
    }
  }

  if (stepX == null && stepY == null) {
    return null;
  }

  return { stepX, stepY };
}

function parsePolarStep(raw: string): { x: number; y: number } | null {
  const inner = coordinateInner(raw);
  if (!inner) {
    return null;
  }

  const parts = splitAllAtTopLevel(inner, ":").map((part) => part.trim());
  if (parts.length !== 2) {
    return null;
  }

  const angle = Number(parts[0]);
  const radius = parseLength(parts[1], "cm");
  if (!Number.isFinite(angle) || radius == null) {
    return null;
  }

  const radians = toRadians(angle);
  return {
    x: radius * Math.cos(radians),
    y: radius * Math.sin(radians)
  };
}

function resolveGridAxisStep(
  step: number,
  axis: "x" | "y",
  hasExplicitUnit: boolean,
  context: SemanticContext
): number {
  if (hasExplicitUnit) {
    return Math.abs(step);
  }

  const frame = context.stack[context.stack.length - 1];
  const delta =
    axis === "x"
      ? applyMatrixToVector(frame.transform, { x: step, y: 0 })
      : applyMatrixToVector(frame.transform, { x: 0, y: step });
  const magnitude = Math.hypot(delta.x, delta.y);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
    return Math.abs(step);
  }
  return Math.abs(magnitude);
}

function hasExplicitLengthUnit(raw: string): boolean {
  const compact = normalizeOptionValue(raw).replace(/\s+/g, "");
  const match = compact.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([A-Za-z]+)?$/);
  return Boolean(match && match[2]);
}

export function makeGridElements(
  sourceId: string,
  itemId: string,
  from: Point,
  to: Point,
  stepX: number,
  stepY: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath[] {
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  const spacingX = stepX >= 0 ? stepX : DEFAULT_GRID_STEP;
  const spacingY = stepY >= 0 ? stepY : DEFAULT_GRID_STEP;

  const paths: ScenePath[] = [];
  if (spacingX > 0) {
    for (let x = minX; x <= maxX + 1e-6; x += spacingX) {
      paths.push({
        kind: "Path",
        id: `scene-grid-x:${sourceId}:${itemId}:${x.toFixed(3)}`,
        sourceId,
        sourceSpan: span,
        style: { ...style },
        commands: [
          { kind: "M", to: { x, y: minY } },
          { kind: "L", to: { x, y: maxY } }
        ]
      });
    }
  }
  if (spacingY > 0) {
    for (let y = minY; y <= maxY + 1e-6; y += spacingY) {
      paths.push({
        kind: "Path",
        id: `scene-grid-y:${sourceId}:${itemId}:${y.toFixed(3)}`,
        sourceId,
        sourceSpan: span,
        style: { ...style },
        commands: [
          { kind: "M", to: { x: minX, y } },
          { kind: "L", to: { x: maxX, y } }
        ]
      });
    }
  }
  return paths;
}
