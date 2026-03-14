import type { CoordinateForm, CoordinateItem } from "../../ast/types.js";
import { parseCoordinate } from "../../domains/coordinates/parse.js";
import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings, type MacroBinding } from "../../macros/index.js";
import {
  readNamedCoordinate,
  readNamedNodeGeometry,
  type NamedNodeGeometry,
  type SemanticContext
} from "../context.js";
import type { Matrix2D, Point } from "../types.js";
import { applyMatrix, applyMatrixToVector, identityMatrix, inverseMatrix } from "../transform.js";
import { parseLength, parseQuantityExpression } from "./parse-length.js";
import { intersectRayWithPolygon } from "../nodes/shape-geometry.js";

export type EvaluatedCoordinate = {
  world: Point | null;       // renamed from `point`
  local?: Point | null;      // pre-transform value
  transform: Matrix2D;       // the transform in effect
  coordinateForm: CoordinateForm;
  relativePrefix?: "+" | "++";
  diagnostics: string[];
  advancesCurrentPoint: boolean;
};

type ParsedExplicitCoordinate =
  | { kind: "canvas"; x: string; y: string }
  | { kind: "perpendicular"; horizontalLineThrough: string; verticalLineThrough: string }
  | { kind: "intersection"; firstLine: ParsedLineSpec; secondLine: ParsedLineSpec; solution: number };

type ParsedLineSpec = {
  startRaw: string;
  endRaw: string;
};

export function evaluateCoordinate(item: CoordinateItem, context: SemanticContext): EvaluatedCoordinate {
  const diagnostics: string[] = [];
  const frame = context.stack[context.stack.length - 1];
  const traceCollector = context.macroTraceCollector ?? undefined;

  if (item.form === "named") {
    const rawName = expandCoordinateComponent(item.x.trim(), frame.macroBindings, traceCollector).trim();
    const perpendicular = tryEvaluatePerpendicularCoordinate(rawName, context);
    if (perpendicular) {
      diagnostics.push(...perpendicular.diagnostics);
      return {
        world: perpendicular.point,
        local: undefined,
        transform: identityMatrix(),
        coordinateForm: "named",
        diagnostics,
        advancesCurrentPoint: item.relativePrefix === "++"
      };
    }

    const intersection = tryEvaluateIntersectionCoordinate(rawName, context);
    if (intersection) {
      diagnostics.push(...intersection.diagnostics);
      return {
        world: intersection.point,
        local: undefined,
        transform: identityMatrix(),
        coordinateForm: "named",
        diagnostics,
        advancesCurrentPoint: item.relativePrefix === "++"
      };
    }

    const candidates = scopedNameCandidates(rawName, frame.namePrefix, frame.nameSuffix);
    const named = candidates.map((candidate) => readNamedCoordinate(context, candidate)).find((candidate) => candidate != null) ?? null;
    if (named) {
      return {
        world: named,
        local: undefined,
        transform: identityMatrix(),
        coordinateForm: "named",
        diagnostics,
        advancesCurrentPoint: item.relativePrefix === "++"
      };
    }

    const numericNodeAnchor = tryResolveNumericNodeAnchor(rawName, context, frame.namePrefix, frame.nameSuffix);
    if (numericNodeAnchor) {
      return {
        world: numericNodeAnchor,
        local: undefined,
        transform: identityMatrix(),
        coordinateForm: "named",
        diagnostics,
        advancesCurrentPoint: item.relativePrefix === "++"
      };
    }

    diagnostics.push(`unknown-named-coordinate:${rawName}`);
    return { world: null, local: undefined, transform: identityMatrix(), coordinateForm: "named", diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
  }

  if (item.form === "calc") {
    const evaluatedCalc = evaluateCalcCoordinate(
      expandCoordinateComponent(item.x, frame.macroBindings, traceCollector),
      context,
      frame.transform
    );
    return {
      world: evaluatedCalc.point,
      local: undefined,
      transform: identityMatrix(),
      coordinateForm: "calc",
      diagnostics: evaluatedCalc.diagnostics,
      advancesCurrentPoint: item.relativePrefix === "++"
    };
  }

  if (item.form === "explicit") {
    const parsed = parseExplicitCoordinate(expandCoordinateComponent(item.x, frame.macroBindings, traceCollector));
    if (!parsed) {
      diagnostics.push(`unsupported-coordinate-form:${item.form}`);
      return { world: null, local: undefined, transform: identityMatrix(), coordinateForm: "explicit", diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }
    if (parsed.kind === "canvas") {
      const x = parseLength(parsed.x, "cm");
      const y = parseLength(parsed.y, "cm");
      if (x == null || y == null) {
        diagnostics.push(`invalid-explicit-coordinate:${item.raw}`);
        return { world: null, local: undefined, transform: identityMatrix(), coordinateForm: "explicit", diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
      }

      const localPt = { x, y };
      return {
        world: applyMatrix(frame.transform, localPt),
        local: localPt,
        transform: frame.transform,
        coordinateForm: "explicit",
        diagnostics,
        advancesCurrentPoint: item.relativePrefix === "++"
      };
    }

    if (parsed.kind === "perpendicular") {
      const horizontal = evaluateRawCoordinate(parsed.horizontalLineThrough, context);
      const vertical = evaluateRawCoordinate(parsed.verticalLineThrough, context);
      diagnostics.push(...horizontal.diagnostics, ...vertical.diagnostics);
      if (!horizontal.world || !vertical.world) {
        diagnostics.push(`invalid-explicit-coordinate:${item.raw}`);
        return { world: null, local: undefined, transform: identityMatrix(), coordinateForm: "explicit", diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
      }
      return {
        world: { x: vertical.world.x, y: horizontal.world.y },
        local: undefined,
        transform: identityMatrix(),
        coordinateForm: "explicit",
        diagnostics,
        advancesCurrentPoint: item.relativePrefix === "++"
      };
    }

    const firstStart = evaluateRawCoordinate(parsed.firstLine.startRaw, context);
    const firstEnd = evaluateRawCoordinate(parsed.firstLine.endRaw, context);
    const secondStart = evaluateRawCoordinate(parsed.secondLine.startRaw, context);
    const secondEnd = evaluateRawCoordinate(parsed.secondLine.endRaw, context);
    diagnostics.push(...firstStart.diagnostics, ...firstEnd.diagnostics, ...secondStart.diagnostics, ...secondEnd.diagnostics);
    if (!firstStart.world || !firstEnd.world || !secondStart.world || !secondEnd.world) {
      diagnostics.push(`invalid-explicit-coordinate:${item.raw}`);
      return { world: null, local: undefined, transform: identityMatrix(), coordinateForm: "explicit", diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }

    const intersection = intersectInfiniteLines(
      { start: firstStart.world, end: firstEnd.world },
      { start: secondStart.world, end: secondEnd.world }
    );
    if (!intersection) {
      diagnostics.push(`invalid-explicit-coordinate:${item.raw}`);
      return { world: null, local: undefined, transform: identityMatrix(), coordinateForm: "explicit", diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }

    if (parsed.solution !== 1) {
      diagnostics.push(`invalid-intersection-solution:${parsed.solution}`);
      return { world: null, local: undefined, transform: identityMatrix(), coordinateForm: "explicit", diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }

    return {
      world: intersection,
      local: undefined,
      transform: identityMatrix(),
      coordinateForm: "explicit",
      diagnostics,
      advancesCurrentPoint: item.relativePrefix === "++"
    };
  }

  if (item.form === "xyz") {
    const x = parseLength(expandCoordinateComponent(item.x, frame.macroBindings, traceCollector), "cm");
    const y = parseLength(expandCoordinateComponent(item.y, frame.macroBindings, traceCollector), "cm");
    const z = item.z ? parseLength(expandCoordinateComponent(item.z, frame.macroBindings, traceCollector), "cm") : 0;
    if (x == null || y == null || z == null) {
      diagnostics.push(`invalid-xyz-coordinate:${item.raw}`);
      return { world: null, local: undefined, transform: identityMatrix(), coordinateForm: "xyz", diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }

    if (Math.abs(z) > 1e-9) {
      diagnostics.push("unsupported-coordinate-z-component");
    }

    return {
      world: applyMatrix(frame.transform, { x, y }),
      local: { x, y },
      transform: frame.transform,
      coordinateForm: "xyz",
      diagnostics,
      advancesCurrentPoint: item.relativePrefix === "++"
    };
  }

  if (item.form === "unknown") {
    diagnostics.push(`unsupported-coordinate-form:${item.form}`);
    return { world: null, local: undefined, transform: identityMatrix(), coordinateForm: "unknown", diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
  }

  let localPoint: Point | null = null;

  if (item.form === "polar") {
    const angleQuantity = parseQuantityExpression(expandCoordinateComponent(item.x.trim(), frame.macroBindings, traceCollector));
    const radius = parseLength(expandCoordinateComponent(item.y, frame.macroBindings, traceCollector), "cm");
    if (!angleQuantity || angleQuantity.kind !== "scalar" || radius == null) {
      diagnostics.push(`invalid-polar-coordinate:${item.raw}`);
      return { world: null, local: undefined, transform: identityMatrix(), coordinateForm: "polar", diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }

    const angle = angleQuantity.value;
    const radians = (angle * Math.PI) / 180;
    localPoint = {
      x: radius * Math.cos(radians),
      y: radius * Math.sin(radians)
    };
  } else {
    const x = parseLength(expandCoordinateComponent(item.x, frame.macroBindings, traceCollector), "cm");
    const y = parseLength(expandCoordinateComponent(item.y, frame.macroBindings, traceCollector), "cm");
    if (x == null || y == null) {
      diagnostics.push(`invalid-cartesian-coordinate:${item.raw}`);
      return { world: null, local: undefined, transform: identityMatrix(), coordinateForm: "cartesian", diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }

    localPoint = { x, y };
  }

  if (!localPoint) {
    const form: CoordinateForm = item.form === "polar" ? "polar" : "cartesian";
    return { world: null, local: undefined, transform: identityMatrix(), coordinateForm: form, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
  }

  if (item.relativePrefix) {
    const current = context.currentPoint;
    if (!current) {
      diagnostics.push("relative-coordinate-without-current-point");
      const form: CoordinateForm = item.form === "polar" ? "polar" : "cartesian";
      return { world: null, local: undefined, transform: identityMatrix(), coordinateForm: form, relativePrefix: item.relativePrefix, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }
    const delta = applyMatrixToVector(frame.transform, localPoint);
    const form: CoordinateForm = item.form === "polar" ? "polar" : "cartesian";
    return {
      world: {
        x: current.x + delta.x,
        y: current.y + delta.y
      },
      local: localPoint,
      transform: frame.transform,
      coordinateForm: form,
      relativePrefix: item.relativePrefix,
      diagnostics,
      advancesCurrentPoint: item.relativePrefix === "++"
    };
  }

  const coordinateForm: CoordinateForm = item.form === "polar" ? "polar" : "cartesian";
  return {
    world: applyMatrix(frame.transform, localPoint),
    local: localPoint,
    transform: frame.transform,
    coordinateForm,
    diagnostics,
    advancesCurrentPoint: true
  };
}

function parseExplicitCoordinate(raw: string): ParsedExplicitCoordinate | null {
  const trimmed = raw.trim();
  const csMatch = trimmed.match(/^(.+?)\s*cs\s*:\s*(.+)$/i);
  if (!csMatch) {
    return null;
  }

  const system = csMatch[1].trim().toLowerCase();
  const kvValues = parseTopLevelKvPairs(csMatch[2]);
  if (system === "perpendicular") {
    const horizontalLineThrough = kvValues.get("horizontal line through");
    const verticalLineThrough = kvValues.get("vertical line through");
    if (!horizontalLineThrough || !verticalLineThrough) {
      return null;
    }
    const horizontalRaw = normalizeInlineCoordinateRaw(horizontalLineThrough);
    const verticalRaw = normalizeInlineCoordinateRaw(verticalLineThrough);
    if (!horizontalRaw || !verticalRaw) {
      return null;
    }
    return {
      kind: "perpendicular",
      horizontalLineThrough: horizontalRaw,
      verticalLineThrough: verticalRaw
    };
  }

  if (system === "intersection") {
    const firstLineRaw = kvValues.get("first line");
    const secondLineRaw = kvValues.get("second line");
    if (!firstLineRaw || !secondLineRaw) {
      return null;
    }

    const firstLine = parseLineSpec(firstLineRaw);
    const secondLine = parseLineSpec(secondLineRaw);
    if (!firstLine || !secondLine) {
      return null;
    }

    const solutionRaw = kvValues.get("solution");
    const solution = solutionRaw ? Number(unwrapOuterBraces(solutionRaw)) : 1;
    return {
      kind: "intersection",
      firstLine,
      secondLine,
      solution: Number.isFinite(solution) ? Math.max(1, Math.floor(solution)) : 1
    };
  }

  const x = kvValues.get("x");
  const y = kvValues.get("y");
  if (!x || !y) {
    return null;
  }
  return {
    kind: "canvas",
    x,
    y
  };
}

function tryResolveNumericNodeAnchor(
  rawName: string,
  context: SemanticContext,
  prefix: string,
  suffix: string
): Point | null {
  const parsed = parseNumericNodeAnchor(rawName);
  if (!parsed) {
    return null;
  }

  const geometry =
    scopedNameCandidates(parsed.baseName, prefix, suffix)
      .map((candidate) => readNamedNodeGeometry(context, candidate))
      .find((candidate): candidate is NamedNodeGeometry => candidate != null) ?? null;
  if (!geometry) {
    return null;
  }

  return resolveNumericAnchorPoint(geometry, parsed.degrees);
}

function parseNumericNodeAnchor(rawName: string): { baseName: string; degrees: number } | null {
  const trimmed = rawName.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot >= trimmed.length - 1) {
    return null;
  }

  const baseName = trimmed.slice(0, dot).trim();
  const anchorRaw = trimmed.slice(dot + 1).trim();
  if (baseName.length === 0 || anchorRaw.length === 0) {
    return null;
  }

  const degrees = Number(anchorRaw);
  if (!Number.isFinite(degrees)) {
    return null;
  }

  return {
    baseName,
    degrees: normalizeDegrees(degrees)
  };
}

function normalizeDegrees(value: number): number {
  let normalized = value % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function resolveNumericAnchorPoint(geometry: NamedNodeGeometry, degrees: number): Point | null {
  const radians = (degrees * Math.PI) / 180;
  const direction = {
    x: Math.cos(radians),
    y: Math.sin(radians)
  };
  return intersectNamedGeometryBorder(geometry, direction);
}

function intersectNamedGeometryBorder(geometry: NamedNodeGeometry, direction: Point): Point | null {
  const dx = direction.x;
  const dy = direction.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return geometry.center;
  }

  if (geometry.shape === "coordinate") {
    return geometry.center;
  }

  const transform = geometry.anchorTransform;
  const localDirection = (() => {
    if (!transform) {
      return { x: dx, y: dy };
    }
    const inverse = inverseMatrix(transform);
    if (!inverse) {
      return { x: dx, y: dy };
    }
    return applyMatrixToVector(inverse, { x: dx, y: dy });
  })();
  const localDx = localDirection.x;
  const localDy = localDirection.y;
  const localLen = Math.hypot(localDx, localDy);
  if (!Number.isFinite(localLen) || localLen <= 1e-9) {
    return geometry.center;
  }
  const fromLocal = (point: Point): Point => {
    if (!transform) {
      return {
        x: geometry.center.x + point.x,
        y: geometry.center.y + point.y
      };
    }
    const mapped = applyMatrixToVector(transform, point);
    return {
      x: geometry.center.x + mapped.x,
      y: geometry.center.y + mapped.y
    };
  };

  if (geometry.shape === "circle") {
    const radius = geometry.anchorRadius;
    if (!Number.isFinite(radius) || radius <= 1e-9) {
      return geometry.center;
    }
    return fromLocal({
      x: (localDx / localLen) * radius,
      y: (localDy / localLen) * radius
    });
  }

  if (geometry.shape === "rectangle") {
    const hw = geometry.anchorHalfWidth;
    const hh = geometry.anchorHalfHeight;
    if (!Number.isFinite(hw) || !Number.isFinite(hh) || hw <= 1e-9 || hh <= 1e-9) {
      return geometry.center;
    }
    const scale = 1 / Math.max(Math.abs(localDx) / hw, Math.abs(localDy) / hh);
    return fromLocal({
      x: localDx * scale,
      y: localDy * scale
    });
  }

  if (geometry.shape === "ellipse") {
    const rx = geometry.anchorHalfWidth;
    const ry = geometry.anchorHalfHeight;
    if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 1e-9 || ry <= 1e-9) {
      return geometry.center;
    }
    const scale = 1 / Math.sqrt((localDx * localDx) / (rx * rx) + (localDy * localDy) / (ry * ry));
    if (!Number.isFinite(scale)) {
      return geometry.center;
    }
    return fromLocal({
      x: localDx * scale,
      y: localDy * scale
    });
  }

  if (geometry.anchorPolygon && geometry.anchorPolygon.length >= 3) {
    const border = intersectRayWithPolygon({ x: 0, y: 0 }, { x: dx, y: dy }, geometry.anchorPolygon);
    if (border) {
      return {
        x: geometry.center.x + border.x,
        y: geometry.center.y + border.y
      };
    }
  }

  return geometry.center;
}

function evaluateCalcCoordinate(
  calcRaw: string,
  context: SemanticContext,
  frame: { a: number; b: number; c: number; d: number; e: number; f: number }
): { point: Point | null; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const trimmed = calcRaw.trim();
  if (!trimmed.startsWith("$") || !trimmed.endsWith("$")) {
    return { point: null, diagnostics: ["invalid-calc-coordinate"] };
  }

  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return { point: null, diagnostics: ["invalid-calc-coordinate"] };
  }

  const terms = tokenizeCalcTerms(inner);
  if (terms.length === 0) {
    return { point: null, diagnostics: ["invalid-calc-coordinate"] };
  }

  const origin = applyMatrix(frame, { x: 0, y: 0 });
  let acc = { ...origin };
  let evaluatedAny = false;

  for (const term of terms) {
    const termResult = evaluateCalcTerm(term.term, context);
    diagnostics.push(...termResult.diagnostics);
    if (!termResult.point) {
      return { point: null, diagnostics };
    }

    const vector = {
      x: termResult.point.x - origin.x,
      y: termResult.point.y - origin.y
    };
    acc = term.op === "-" ? { x: acc.x - vector.x, y: acc.y - vector.y } : { x: acc.x + vector.x, y: acc.y + vector.y };
    evaluatedAny = true;
  }

  return { point: evaluatedAny ? acc : null, diagnostics };
}

function tokenizeCalcTerms(input: string): Array<{ op: "+" | "-"; term: string }> {
  const terms: Array<{ op: "+" | "-"; term: string }> = [];
  let op: "+" | "-" = "+";
  let cursor = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if ((char === "+" || char === "-") && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      const token = input.slice(cursor, index).trim();
      if (token.length > 0) {
        terms.push({ op, term: token });
      }
      op = char;
      cursor = index + 1;
    }
  }

  const trailing = input.slice(cursor).trim();
  if (trailing.length > 0) {
    terms.push({ op, term: trailing });
  }

  return terms;
}

function evaluateCalcTerm(term: string, context: SemanticContext): { point: Point | null; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const interpolation = tryParseCalcInterpolation(term);
  if (interpolation) {
    const left = evaluateRawCoordinate(interpolation.left, context);
    const right = evaluateRawCoordinate(interpolation.right, context);
    diagnostics.push(...left.diagnostics, ...right.diagnostics);
    if (!left.world || !right.world) {
      return { point: null, diagnostics };
    }
    return {
      point: {
        x: left.world.x + interpolation.factor * (right.world.x - left.world.x),
        y: left.world.y + interpolation.factor * (right.world.y - left.world.y)
      },
      diagnostics
    };
  }

  const evaluated = evaluateRawCoordinate(term, context);
  diagnostics.push(...evaluated.diagnostics);
  return { point: evaluated.world, diagnostics };
}

function tryParseCalcInterpolation(term: string): { left: string; right: string; factor: number } | null {
  const parts = splitAllAtTopLevel(term, "!").map((part) => part.trim());
  if (parts.length !== 3) {
    return null;
  }

  const [left, factorRaw, right] = parts;
  if (!left.startsWith("(") || !left.endsWith(")") || !right.startsWith("(") || !right.endsWith(")")) {
    return null;
  }

  const factor = Number(factorRaw);
  if (!Number.isFinite(factor)) {
    return null;
  }

  return { left, right, factor };
}

function tryEvaluatePerpendicularCoordinate(
  raw: string,
  context: SemanticContext
): { point: Point | null; diagnostics: string[] } | null {
  const parsed = parsePerpendicularCoordinate(raw);
  if (!parsed) {
    return null;
  }

  const left = evaluateRawCoordinate(parsed.leftRaw, context);
  const right = evaluateRawCoordinate(parsed.rightRaw, context);
  const diagnostics = [...left.diagnostics, ...right.diagnostics];
  if (!left.world || !right.world) {
    diagnostics.push("invalid-perpendicular-coordinate");
    return { point: null, diagnostics };
  }

  if (parsed.operator === "|-") {
    return {
      point: {
        x: left.world.x,
        y: right.world.y
      },
      diagnostics
    };
  }

  return {
    point: {
      x: right.world.x,
      y: left.world.y
    },
    diagnostics
  };
}

function parsePerpendicularCoordinate(raw: string): { operator: "|-" | "-|"; leftRaw: string; rightRaw: string } | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const unwrapped = unwrapOuterBraces(trimmed);
  if (unwrapped !== trimmed) {
    candidates.push(unwrapped);
  }

  for (const candidate of candidates) {
    const split = splitAtTopLevelOperator(candidate, ["|-", "-|"]);
    if (!split) {
      continue;
    }

    const leftRaw = normalizeInlineCoordinateRaw(split.left);
    const rightRaw = normalizeInlineCoordinateRaw(split.right);
    if (!leftRaw || !rightRaw) {
      continue;
    }

    return {
      operator: split.operator as "|-" | "-|",
      leftRaw,
      rightRaw
    };
  }

  return null;
}

function tryEvaluateIntersectionCoordinate(
  raw: string,
  context: SemanticContext
): { point: Point | null; diagnostics: string[] } | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const unwrapped = unwrapOuterBraces(trimmed);
  if (unwrapped !== trimmed) {
    candidates.push(unwrapped);
  }

  let prefixMatch: RegExpMatchArray | null = null;
  for (const candidate of candidates) {
    prefixMatch = candidate.match(/^intersection(?:\s+(\d+))?\s+of\s+(.+)$/i);
    if (prefixMatch) {
      break;
    }
  }
  if (!prefixMatch) {
    return null;
  }

  const diagnostics: string[] = [];
  const solution = prefixMatch[1] ? Number(prefixMatch[1]) : 1;
  const objectPair = splitAtTopLevelKeyword(prefixMatch[2], "and");
  if (!objectPair) {
    return { point: null, diagnostics: ["invalid-intersection-coordinate"] };
  }

  const firstLine = parseLineSpec(objectPair.left);
  const secondLine = parseLineSpec(objectPair.right);
  if (!firstLine || !secondLine) {
    return { point: null, diagnostics: ["invalid-intersection-coordinate"] };
  }

  const firstStart = evaluateRawCoordinate(firstLine.startRaw, context);
  const firstEnd = evaluateRawCoordinate(firstLine.endRaw, context);
  const secondStart = evaluateRawCoordinate(secondLine.startRaw, context);
  const secondEnd = evaluateRawCoordinate(secondLine.endRaw, context);
  diagnostics.push(...firstStart.diagnostics, ...firstEnd.diagnostics, ...secondStart.diagnostics, ...secondEnd.diagnostics);

  if (!firstStart.world || !firstEnd.world || !secondStart.world || !secondEnd.world) {
    diagnostics.push("invalid-intersection-coordinate");
    return { point: null, diagnostics };
  }

  if (!Number.isFinite(solution) || solution !== 1) {
    diagnostics.push(`invalid-intersection-solution:${prefixMatch[1] ?? String(solution)}`);
    return { point: null, diagnostics };
  }

  const point = intersectInfiniteLines(
    { start: firstStart.world, end: firstEnd.world },
    { start: secondStart.world, end: secondEnd.world }
  );
  if (!point) {
    diagnostics.push("invalid-intersection-coordinate");
    return { point: null, diagnostics };
  }

  return { point, diagnostics };
}

function parseLineSpec(raw: string): ParsedLineSpec | null {
  const normalized = unwrapOuterBraces(raw.trim());
  const split = splitAtTopLevelOperator(normalized, ["--"]);
  if (!split) {
    return null;
  }

  const startRaw = normalizeInlineCoordinateRaw(split.left);
  const endRaw = normalizeInlineCoordinateRaw(split.right);
  if (!startRaw || !endRaw) {
    return null;
  }

  return { startRaw, endRaw };
}

function normalizeInlineCoordinateRaw(raw: string): string | null {
  let normalized = raw.trim();
  while (normalized.startsWith("{") && normalized.endsWith("}") && normalized.length >= 2) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.startsWith("(") && normalized.endsWith(")")) {
    return normalized;
  }
  return `(${normalized})`;
}

function parseTopLevelKvPairs(raw: string): Map<string, string> {
  const pairs = new Map<string, string>();
  const entries = splitAllAtTopLevel(raw, ",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  for (const entry of entries) {
    const separator = findTopLevelEquals(entry);
    if (separator === -1) {
      continue;
    }
    const key = entry.slice(0, separator).trim().toLowerCase();
    const value = entry.slice(separator + 1).trim();
    if (key.length > 0) {
      pairs.set(key, value);
    }
  }
  return pairs;
}

function findTopLevelEquals(input: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === "=" && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return i;
    }
  }

  return -1;
}

function splitAtTopLevelOperator(
  input: string,
  operators: string[]
): { left: string; right: string; operator: string } | null {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (parenDepth !== 0 || braceDepth !== 0 || bracketDepth !== 0) {
      continue;
    }

    for (const operator of operators) {
      if (input.startsWith(operator, i)) {
        return {
          left: input.slice(0, i).trim(),
          right: input.slice(i + operator.length).trim(),
          operator
        };
      }
    }
  }

  return null;
}

function splitAtTopLevelKeyword(input: string, keyword: string): { left: string; right: string } | null {
  const needle = ` ${keyword} `;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i <= input.length - needle.length; i += 1) {
    const char = input[i];
    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      const candidate = input.slice(i, i + needle.length).toLowerCase();
      if (candidate === needle) {
        return {
          left: input.slice(0, i).trim(),
          right: input.slice(i + needle.length).trim()
        };
      }
    }
  }

  return null;
}

function unwrapOuterBraces(raw: string): string {
  let normalized = raw.trim();
  while (normalized.startsWith("{") && normalized.endsWith("}") && normalized.length >= 2) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function intersectInfiniteLines(
  first: { start: Point; end: Point },
  second: { start: Point; end: Point }
): Point | null {
  const firstDirection = {
    x: first.end.x - first.start.x,
    y: first.end.y - first.start.y
  };
  const secondDirection = {
    x: second.end.x - second.start.x,
    y: second.end.y - second.start.y
  };
  const denominator = cross(firstDirection, secondDirection);
  if (Math.abs(denominator) <= 1e-9) {
    return null;
  }

  const delta = {
    x: second.start.x - first.start.x,
    y: second.start.y - first.start.y
  };
  const t = cross(delta, secondDirection) / denominator;
  return {
    x: first.start.x + t * firstDirection.x,
    y: first.start.y + t * firstDirection.y
  };
}

function cross(left: Point, right: Point): number {
  return left.x * right.y - left.y * right.x;
}

function scopedNameCandidates(name: string, prefix: string, suffix: string): string[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return [trimmed];
  }

  const scoped = applyNameScope(trimmed, prefix, suffix);
  return scoped === trimmed ? [trimmed] : [scoped, trimmed];
}

function applyNameScope(name: string, prefix: string, suffix: string): string {
  if (prefix.length === 0 && suffix.length === 0) {
    return name;
  }

  const dot = name.indexOf(".");
  if (dot === -1) {
    return `${prefix}${name}${suffix}`;
  }

  const base = name.slice(0, dot);
  const anchor = name.slice(dot);
  return `${prefix}${base}${suffix}${anchor}`;
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

function expandCoordinateComponent(
  raw: string,
  bindings: ReadonlyMap<string, MacroBinding>,
  trace: SemanticContext["macroTraceCollector"] | undefined
): string {
  return expandMacroBindings(raw, bindings, {
    maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
    trace: trace ?? undefined
  });
}
