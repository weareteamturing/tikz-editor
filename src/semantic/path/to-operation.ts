import type { EdgeOperationItem, ToOperationItem, PathStatement } from "../../ast/types.js";
import type { SemanticContext } from "../context.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import {
  evaluateNodeItem,
  maybeResolveNamedCoordinateBorderPointFromRaw,
  maybeResolveNamedCoordinateBorderPointFromRawAlongAngle
} from "../nodes/evaluate.js";
import type { FeatureId } from "../../capabilities/feature-ids.js";
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
  pushDiagnostic: DiagnosticPushFn,
  startCoordinateRaw: string | null = null
): {
  activePath: ScenePath | null;
  segment: PlacementSegment | null;
  behindNodeElements: SceneElement[];
  frontNodeElements: SceneElement[];
  previousSegmentRoundedCorners?: number | null;
} {
  return applyToLikeOperation(item, context, statement, style, activePath, previousSegmentRoundedCorners, markFeature, pushDiagnostic, {
    operationKeyword: "to",
    operationFeature: "to_operation",
    keywordFeature: "keyword_to",
    unsupportedDiagnostic: "unsupported-to-operation",
    allowImplicitMoveToTargetWhenNoStart: true,
    startCoordinateRaw
  });
}

export function applyEdgeOperation(
  item: EdgeOperationItem,
  context: SemanticContext,
  statement: PathStatement,
  style: ResolvedStyle,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn,
  startPoint: Point | null,
  startCoordinateRaw: string | null = null
): {
  activePath: ScenePath | null;
  segment: PlacementSegment | null;
  behindNodeElements: SceneElement[];
  frontNodeElements: SceneElement[];
  previousSegmentRoundedCorners?: number | null;
} {
  const savedCurrentPoint = context.currentPoint;
  const savedPathStartPoint = context.pathStartPoint;
  context.currentPoint = startPoint;
  context.pathStartPoint = startPoint;

  const handled = applyToLikeOperation(item, context, statement, style, null, null, markFeature, pushDiagnostic, {
    operationKeyword: "edge",
    operationFeature: "edge_operation",
    keywordFeature: "keyword_edge",
    unsupportedDiagnostic: "unsupported-edge-operation",
    allowImplicitMoveToTargetWhenNoStart: false,
    startCoordinateRaw
  });

  context.currentPoint = savedCurrentPoint;
  context.pathStartPoint = savedPathStartPoint;
  return handled;
}

function applyToLikeOperation(
  item: ToOperationItem | EdgeOperationItem,
  context: SemanticContext,
  statement: PathStatement,
  style: ResolvedStyle,
  activePath: ScenePath | null,
  previousSegmentRoundedCorners: number | null,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn,
  config: {
    operationKeyword: "to" | "edge";
    operationFeature: FeatureId;
    keywordFeature: FeatureId;
    unsupportedDiagnostic: string;
    allowImplicitMoveToTargetWhenNoStart: boolean;
    startCoordinateRaw?: string | null;
  }
): {
  activePath: ScenePath | null;
  segment: PlacementSegment | null;
  behindNodeElements: SceneElement[];
  frontNodeElements: SceneElement[];
  previousSegmentRoundedCorners?: number | null;
} {
  const behindNodeElements: SceneElement[] = [];
  const frontNodeElements: SceneElement[] = [];
  const target = item.target ?? parseToTarget(item.raw, config.operationKeyword);
  if (!target) {
    markFeature(config.operationFeature, "unsupported");
    pushDiagnostic(
      config.unsupportedDiagnostic,
      `\`${config.operationKeyword}\` operation target is not yet supported.`,
      item.span.from,
      item.span.to
    );
    return { activePath, segment: null, behindNodeElements, frontNodeElements };
  }

  markFeature(config.operationFeature, "supported");
  markFeature(config.keywordFeature, "supported");
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
    markFeature(config.operationFeature, "unsupported");
    for (const code of evaluated.diagnostics) {
      pushDiagnostic(code, `${config.operationKeyword}-operation target issue: ${code}`, item.span.from, item.span.to);
    }
    return { activePath, segment: null, behindNodeElements, frontNodeElements };
  }

  const startPoint = context.currentPoint;
  if (!startPoint && !config.allowImplicitMoveToTargetWhenNoStart) {
    markFeature(config.operationFeature, "unsupported");
    pushDiagnostic(
      config.unsupportedDiagnostic,
      `\`${config.operationKeyword}\` operation requires a current point before the operation.`,
      item.span.from,
      item.span.to
    );
    return { activePath, segment: null, behindNodeElements, frontNodeElements };
  }

  const resolvedStartPoint =
    startPoint && config.startCoordinateRaw
      ? maybeResolveNamedCoordinateBorderPointFromRaw(config.startCoordinateRaw, startPoint, evaluated.point, context)
      : startPoint;
  const resolvedTargetPoint = maybeResolveNamedCoordinateBorderPointFromRaw(
    target.raw,
    evaluated.point,
    resolvedStartPoint ?? startPoint,
    context
  );
  let effectiveStartPoint = resolvedStartPoint ?? startPoint;
  let effectiveTargetPoint = resolvedTargetPoint;
  const curved = effectiveStartPoint ? extractToCurveOptions(item.options, effectiveStartPoint, effectiveTargetPoint) : null;
  if (effectiveStartPoint && curved) {
    if (config.startCoordinateRaw) {
      effectiveStartPoint = maybeResolveNamedCoordinateBorderPointFromRawAlongAngle(
        config.startCoordinateRaw,
        effectiveStartPoint,
        curved.out,
        context
      );
    }
    effectiveTargetPoint = maybeResolveNamedCoordinateBorderPointFromRawAlongAngle(target.raw, effectiveTargetPoint, curved.in, context);
  }

  let path = activePath;
  if (!path) {
    if (effectiveStartPoint) {
      path = makePath(statement.id, item.id, style, item.span);
      path.commands.push({ kind: "M", to: effectiveStartPoint });
      context.pathStartPoint = effectiveStartPoint;
    } else {
      path = makePath(statement.id, item.id, style, item.span);
      path.commands.push({ kind: "M", to: effectiveTargetPoint });
      context.pathStartPoint = effectiveTargetPoint;
      context.currentPoint = effectiveTargetPoint;
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

  const start = effectiveStartPoint;
  let segment: PlacementSegment | null = null;
  let nextRoundedCorners = previousSegmentRoundedCorners;
  if (start && curved) {
    segment = appendToCurve(path.commands, start, effectiveTargetPoint, curved);
    nextRoundedCorners = style.roundedCorners;
    markFeature("path_operator_curves", "supported");
  } else {
    const appended = appendPathPoint(
      path.commands,
      "--",
      start,
      effectiveTargetPoint,
      previousSegmentRoundedCorners,
      style.roundedCorners
    );
    segment = appended.segment;
    nextRoundedCorners = appended.nextRoundedCorners;
  }
  context.currentPoint = effectiveTargetPoint;

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

function parseToTarget(
  raw: string,
  operationKeyword: "to" | "edge"
): { kind: "cycle" } | { kind: "coordinate"; raw: string; relativePrefix?: "+" | "++" } | null {
  if (/\bcycle\b/i.test(raw)) {
    return { kind: "cycle" };
  }

  const match = raw.match(new RegExp(`(${operationKeyword}\\\\b[\\\\s\\\\S]*?)(\\\\+\\\\+|\\\\+)?(\\([^\\)]*\\))\\s*$`, "i"));
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
  options: ToOperationItem["options"],
  from: Point,
  to: Point
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
  let bendDirection: "left" | "right" | null = null;
  let bendAngle = 30;

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "bend left") {
        bendDirection = "left";
        bendAngle = 30;
      } else if (entry.key === "bend right") {
        bendDirection = "right";
        bendAngle = 30;
      }
      continue;
    }

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
      continue;
    }

    if (entry.key === "bend left" || entry.key === "bend right") {
      const normalized = normalizeOptionValue(entry.valueRaw);
      const parsed = normalized.length === 0 ? 30 : Number(normalized);
      bendDirection = entry.key === "bend left" ? "left" : "right";
      if (Number.isFinite(parsed)) {
        bendAngle = parsed;
      } else {
        bendAngle = 30;
      }
    }
  }

  if ((out == null || inAngle == null) && bendDirection) {
    const baseHeading = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    const sign = bendDirection === "left" ? 1 : -1;
    out = baseHeading + sign * bendAngle;
    inAngle = baseHeading + 180 - sign * bendAngle;
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
