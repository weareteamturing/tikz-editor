import type { ToOperationItem, PathStatement } from "../../ast/types.js";
import type { SemanticContext } from "../context.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import {
  evaluateNodeItem,
  maybeResolveNamedCoordinateBorderPointFromRaw
} from "../nodes/evaluate.js";
import type { Point, ResolvedStyle, SceneElement, ScenePath, ScenePathCommand } from "../types.js";
import type { DiagnosticPushFn, FeatureMarkFn, PlacementSegment } from "./types.js";
import { makePath } from "./elements.js";
import { appendPathPoint, roundClosedPathStartCorner } from "./segments.js";
import { normalizeOptionValue, toRadians } from "./shared.js";

export function applyToOperation(
  item: ToOperationItem,
  context: SemanticContext,
  statement: PathStatement,
  style: ResolvedStyle,
  activePath: ScenePath | null,
  previousSegmentRoundedCorners: number | null,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn
): {
  activePath: ScenePath | null;
  segment: PlacementSegment | null;
  behindNodeElements: SceneElement[];
  frontNodeElements: SceneElement[];
  previousSegmentRoundedCorners?: number | null;
} {
  const behindNodeElements: SceneElement[] = [];
  const frontNodeElements: SceneElement[] = [];
  const target = item.target ?? parseToTarget(item.raw);
  if (!target) {
    markFeature("to_operation", "unsupported");
    pushDiagnostic("unsupported-to-operation", "`to` operation target is not yet supported.", item.span.from, item.span.to);
    return { activePath, segment: null, behindNodeElements, frontNodeElements };
  }

  markFeature("to_operation", "supported");
  markFeature("keyword_to", "supported");
  markFeature("path_operators_basic", "supported");

  if (target.kind === "cycle") {
    if (activePath) {
      if (context.currentPoint && context.pathStartPoint) {
        const closingFrom = context.currentPoint;
        const pathStart = context.pathStartPoint;
        appendPathPoint(
          activePath.commands,
          "--",
          closingFrom,
          pathStart,
          previousSegmentRoundedCorners,
          style.roundedCorners
        );
        context.currentPoint = pathStart;
        roundClosedPathStartCorner(activePath.commands, closingFrom, pathStart, style.roundedCorners);
      }
      activePath.commands.push({ kind: "Z" });
      context.currentPoint = context.pathStartPoint;
    }
    return {
      activePath,
      segment: null,
      behindNodeElements,
      frontNodeElements,
      previousSegmentRoundedCorners: null
    };
  }

  const evaluated = evaluateRawCoordinate(target.raw, context, target.relativePrefix);
  if (!evaluated.point) {
    markFeature("to_operation", "unsupported");
    for (const code of evaluated.diagnostics) {
      pushDiagnostic(code, `to-operation target issue: ${code}`, item.span.from, item.span.to);
    }
    return { activePath, segment: null, behindNodeElements, frontNodeElements };
  }
  const resolvedTargetPoint = maybeResolveNamedCoordinateBorderPointFromRaw(target.raw, evaluated.point, context.currentPoint, context);

  let path = activePath;
  if (!path) {
    if (context.currentPoint) {
      path = makePath(statement.id, item.id, style, item.span);
      path.commands.push({ kind: "M", to: context.currentPoint });
    } else {
      path = makePath(statement.id, item.id, style, item.span);
      path.commands.push({ kind: "M", to: resolvedTargetPoint });
      context.pathStartPoint = resolvedTargetPoint;
      context.currentPoint = resolvedTargetPoint;
      markFeature("svg_path", "supported");
      return {
        activePath: path,
        segment: null,
        behindNodeElements,
        frontNodeElements,
        previousSegmentRoundedCorners: null
      };
    }
  }

  const start = context.currentPoint;
  let segment: PlacementSegment | null = null;
  let nextRoundedCorners = previousSegmentRoundedCorners;
  const curved = extractToCurveOptions(item.options);
  if (start && curved) {
    segment = appendToCurve(path.commands, start, resolvedTargetPoint, curved);
    nextRoundedCorners = style.roundedCorners;
    markFeature("path_operator_curves", "supported");
  } else {
    const appended = appendPathPoint(
      path.commands,
      "--",
      context.currentPoint,
      resolvedTargetPoint,
      previousSegmentRoundedCorners,
      style.roundedCorners
    );
    segment = appended.segment;
    nextRoundedCorners = appended.nextRoundedCorners;
  }
  context.currentPoint = resolvedTargetPoint;

  for (const node of item.nodes ?? []) {
    const resolvedNode = evaluateNodeItem(node, statement, context, style, markFeature, pushDiagnostic, segment, undefined, 0.5);
    behindNodeElements.push(...resolvedNode.behindElements);
    frontNodeElements.push(...resolvedNode.frontElements);
  }

  markFeature("svg_path", "supported");
  return {
    activePath: path,
    segment,
    behindNodeElements,
    frontNodeElements,
    previousSegmentRoundedCorners: nextRoundedCorners
  };
}

function parseToTarget(raw: string): { kind: "cycle" } | { kind: "coordinate"; raw: string; relativePrefix?: "+" | "++" } | null {
  if (/\bcycle\b/i.test(raw)) {
    return { kind: "cycle" };
  }

  const match = raw.match(/(to\b[\s\S]*?)(\+\+|\+)?(\([^\)]*\))\s*$/i);
  if (!match) {
    return null;
  }

  const prefix = match[2] === "++" ? "++" : match[2] === "+" ? "+" : undefined;
  return {
    kind: "coordinate",
    raw: match[3],
    relativePrefix: prefix
  };
}

function extractToCurveOptions(
  options: ToOperationItem["options"]
): {
  out: number;
  in: number;
  outLooseness: number;
  inLooseness: number;
} | null {
  if (!options) {
    return null;
  }

  let out: number | null = null;
  let inAngle: number | null = null;
  let looseness: number | null = null;
  let outLooseness: number | null = null;
  let inLooseness: number | null = null;

  for (const entry of options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "out") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed)) {
        out = parsed;
      }
      continue;
    }

    if (entry.key === "in") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed)) {
        inAngle = parsed;
      }
      continue;
    }

    if (entry.key === "looseness") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed) && parsed >= 0) {
        looseness = parsed;
      }
      continue;
    }

    if (entry.key === "out looseness") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed) && parsed >= 0) {
        outLooseness = parsed;
      }
      continue;
    }

    if (entry.key === "in looseness") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed) && parsed >= 0) {
        inLooseness = parsed;
      }
    }
  }

  if (out == null || inAngle == null) {
    return null;
  }

  const shared = looseness ?? 1;
  return {
    out,
    in: inAngle,
    outLooseness: outLooseness ?? shared,
    inLooseness: inLooseness ?? shared
  };
}

function appendToCurve(
  commands: ScenePathCommand[],
  from: Point,
  to: Point,
  options: { out: number; in: number; outLooseness: number; inLooseness: number }
): PlacementSegment {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const baseDistance = Math.hypot(dx, dy) * 0.3915;

  const outDistance = baseDistance * options.outLooseness;
  const inDistance = baseDistance * options.inLooseness;

  const outRadians = toRadians(options.out);
  const inRadians = toRadians(options.in);
  const c1 = {
    x: from.x + outDistance * Math.cos(outRadians),
    y: from.y + outDistance * Math.sin(outRadians)
  };
  const c2 = {
    x: to.x + inDistance * Math.cos(inRadians),
    y: to.y + inDistance * Math.sin(inRadians)
  };

  commands.push({
    kind: "C",
    c1,
    c2,
    to
  });

  return {
    kind: "cubic",
    from,
    c1,
    c2,
    to
  };
}
