import type { PathItem, PathOptionItem } from "../../ast/types.js";
import type { SemanticContext } from "../context.js";
import { evaluateCoordinate, evaluateRawCoordinate } from "../coords/evaluate.js";
import { parseLength } from "../coords/parse-length.js";
import type { Point, ScenePathCommand } from "../types.js";
import { clamp, interpolate, normalizeOptionValue } from "./shared.js";

export function parseParabolaFromItems(
  items: PathItem[],
  startIndex: number,
  context: SemanticContext
): { consumedIndex: number; commands: ScenePathCommand[]; endPoint: Point } | null {
  const start = context.currentPoint;
  if (!start) {
    return null;
  }

  let cursor = startIndex + 1;
  let parabolaOptions: PathOptionItem["options"] | undefined;

  const maybeOption = items[cursor];
  if (maybeOption?.kind === "PathOption") {
    parabolaOptions = maybeOption.options;
    cursor += 1;
  }

  const parsedOptions = parseParabolaOptions(parabolaOptions);
  let bendSpec = parsedOptions.bend;
  let bendPos = parsedOptions.bendPos;

  const maybeBendKeyword = items[cursor];
  if (maybeBendKeyword?.kind === "PathKeyword" && maybeBendKeyword.keyword === "bend") {
    const bendCoordinate = items[cursor + 1];
    if (!bendCoordinate || bendCoordinate.kind !== "Coordinate") {
      return null;
    }
    bendSpec = {
      kind: "coordinate",
      raw: bendCoordinate.raw,
      relativePrefix: bendCoordinate.relativePrefix
    };
    cursor += 2;
  }

  const targetItem = items[cursor];
  let endPoint: Point | null = null;
  if (targetItem?.kind === "Coordinate") {
    const evaluated = evaluateCoordinate(targetItem, context);
    endPoint = evaluated.world;
  } else if (targetItem?.kind === "PathKeyword" && targetItem.keyword === "cycle") {
    endPoint = context.pathStartPoint;
  }

  if (!endPoint) {
    return null;
  }

  if (!Number.isFinite(bendPos)) {
    bendPos = 0;
  }
  bendPos = clamp(bendPos, 0, 1);
  const savedPoint = interpolate(start, endPoint, bendPos);

  let bendPoint: Point | null = null;
  if (bendSpec.kind === "saved") {
    bendPoint = savedPoint;
  } else if (bendSpec.kind === "height") {
    bendPoint = { x: savedPoint.x, y: savedPoint.y + bendSpec.height };
  } else {
    bendPoint = evaluateParabolaBendCoordinate(bendSpec.raw, context, savedPoint, bendSpec.relativePrefix);
  }

  if (!bendPoint) {
    return null;
  }

  const toBend = {
    x: bendPoint.x - start.x,
    y: bendPoint.y - start.y
  };
  const toEnd = {
    x: endPoint.x - bendPoint.x,
    y: endPoint.y - bendPoint.y
  };

  return {
    consumedIndex: cursor,
    commands: buildParabolaCommands(start, toBend, toEnd),
    endPoint
  };
}

function parseParabolaOptions(options: PathOptionItem["options"] | undefined): {
  bendPos: number;
  bend:
    | { kind: "saved" }
    | { kind: "height"; height: number }
    | { kind: "coordinate"; raw: string; relativePrefix?: "+" | "++" };
} {
  let bendPos = 0;
  let bend:
    | { kind: "saved" }
    | { kind: "height"; height: number }
    | { kind: "coordinate"; raw: string; relativePrefix?: "+" | "++" } = { kind: "saved" };

  if (!options) {
    return { bendPos, bend };
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "bend at end") {
        bendPos = 1;
        bend = { kind: "coordinate", raw: "(0,0)", relativePrefix: "+" };
      } else if (entry.key === "bend at start") {
        bendPos = 0;
        bend = { kind: "coordinate", raw: "(0,0)", relativePrefix: "+" };
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "bend pos") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed)) {
        bendPos = parsed;
      }
      continue;
    }
    if (entry.key === "parabola height") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed != null) {
        bendPos = 0.5;
        bend = { kind: "height", height: parsed };
      }
      continue;
    }
    if (entry.key === "bend") {
      const parsed = parseBendCoordinateValue(entry.valueRaw);
      if (parsed) {
        bend = { kind: "coordinate", raw: parsed.raw, relativePrefix: parsed.relativePrefix };
      }
    }
  }

  return { bendPos, bend };
}

function parseBendCoordinateValue(raw: string): { raw: string; relativePrefix?: "+" | "++" } | null {
  const normalized = normalizeOptionValue(raw);
  if (normalized.length === 0) {
    return null;
  }

  let relativePrefix: "+" | "++" | undefined;
  let coordinateRaw = normalized;
  if (coordinateRaw.startsWith("++")) {
    relativePrefix = "++";
    coordinateRaw = coordinateRaw.slice(2).trim();
  } else if (coordinateRaw.startsWith("+")) {
    relativePrefix = "+";
    coordinateRaw = coordinateRaw.slice(1).trim();
  }

  if (!coordinateRaw.startsWith("(") || !coordinateRaw.endsWith(")")) {
    return null;
  }

  return { raw: coordinateRaw, relativePrefix };
}

function evaluateParabolaBendCoordinate(
  raw: string,
  context: SemanticContext,
  savedPoint: Point,
  relativePrefix?: "+" | "++"
): Point | null {
  if (!relativePrefix) {
    return evaluateRawCoordinate(raw, context).world;
  }

  const originalCurrent = context.currentPoint;
  context.currentPoint = savedPoint;
  const evaluated = evaluateRawCoordinate(raw, context, relativePrefix);
  context.currentPoint = originalCurrent;
  return evaluated.world;
}

function buildParabolaCommands(start: Point, toBend: Point, toEnd: Point): ScenePathCommand[] {
  const commands: ScenePathCommand[] = [];

  const hasBendSegment = Math.abs(toBend.x) > 1e-9 || Math.abs(toBend.y) > 1e-9;
  const bend = { x: start.x + toBend.x, y: start.y + toBend.y };
  if (hasBendSegment) {
    commands.push({
      kind: "C",
      c1: {
        x: start.x + 0.1125 * toBend.x,
        y: start.y + 0.225 * toBend.y
      },
      c2: {
        x: start.x + 0.5 * toBend.x,
        y: start.y + toBend.y
      },
      to: bend
    });
  }

  const hasEndSegment = Math.abs(toEnd.x) > 1e-9 || Math.abs(toEnd.y) > 1e-9;
  if (hasEndSegment) {
    commands.push({
      kind: "C",
      c1: {
        x: bend.x + 0.5 * toEnd.x,
        y: bend.y
      },
      c2: {
        x: bend.x + 0.8875 * toEnd.x,
        y: bend.y + 0.775 * toEnd.y
      },
      to: {
        x: bend.x + toEnd.x,
        y: bend.y + toEnd.y
      }
    });
  }

  return commands;
}
