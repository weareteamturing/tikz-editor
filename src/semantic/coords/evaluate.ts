import type { CoordinateItem } from "../../ast/types.js";
import { parseCoordinate } from "../../domains/coordinates/parse.js";
import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings, type MacroBinding } from "../../macros/index.js";
import type { SemanticContext } from "../context.js";
import type { Point } from "../types.js";
import { applyMatrix, applyMatrixToVector } from "../transform.js";
import { parseLength, parseQuantityExpression } from "./parse-length.js";

export type EvaluatedCoordinate = {
  point: Point | null;
  diagnostics: string[];
  advancesCurrentPoint: boolean;
};

export function evaluateCoordinate(item: CoordinateItem, context: SemanticContext): EvaluatedCoordinate {
  const diagnostics: string[] = [];
  const frame = context.stack[context.stack.length - 1];
  const traceCollector = context.macroTraceCollector ?? undefined;

  if (item.form === "named") {
    const rawName = expandCoordinateComponent(item.x.trim(), frame.macroBindings, traceCollector).trim();
    const candidates = scopedNameCandidates(rawName, frame.namePrefix, frame.nameSuffix);
    const named = candidates.map((candidate) => context.namedCoordinates.get(candidate)).find((candidate) => candidate != null) ?? null;
    if (!named) {
      diagnostics.push(`unknown-named-coordinate:${rawName}`);
      return { point: null, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }
    return {
      point: named,
      diagnostics,
      advancesCurrentPoint: item.relativePrefix === "++"
    };
  }

  if (item.form === "calc") {
    const evaluatedCalc = evaluateCalcCoordinate(
      expandCoordinateComponent(item.x, frame.macroBindings, traceCollector),
      context,
      frame.transform
    );
    return {
      point: evaluatedCalc.point,
      diagnostics: evaluatedCalc.diagnostics,
      advancesCurrentPoint: item.relativePrefix === "++"
    };
  }

  if (item.form === "explicit") {
    const parsed = parseExplicitCoordinate(expandCoordinateComponent(item.x, frame.macroBindings, traceCollector));
    if (!parsed) {
      diagnostics.push(`unsupported-coordinate-form:${item.form}`);
      return { point: null, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }

    const x = parseLength(parsed.x, "cm");
    const y = parseLength(parsed.y, "cm");
    if (x == null || y == null) {
      diagnostics.push(`invalid-explicit-coordinate:${item.raw}`);
      return { point: null, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }

    const local = { x, y };
    return {
      point: applyMatrix(frame.transform, local),
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
      return { point: null, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
    }

    if (Math.abs(z) > 1e-9) {
      diagnostics.push("unsupported-coordinate-z-component");
    }

    return {
      point: applyMatrix(frame.transform, { x, y }),
      diagnostics,
      advancesCurrentPoint: item.relativePrefix === "++"
    };
  }

  if (item.form === "unknown") {
    diagnostics.push(`unsupported-coordinate-form:${item.form}`);
    return { point: null, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
  }

  let localPoint: Point | null = null;

  if (item.form === "polar") {
    const angleQuantity = parseQuantityExpression(expandCoordinateComponent(item.x.trim(), frame.macroBindings, traceCollector));
    const radius = parseLength(expandCoordinateComponent(item.y, frame.macroBindings, traceCollector), "cm");
    if (!angleQuantity || angleQuantity.kind !== "scalar" || radius == null) {
      diagnostics.push(`invalid-polar-coordinate:${item.raw}`);
      return { point: null, diagnostics, advancesCurrentPoint: item.relativePrefix === "++" };
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

function parseExplicitCoordinate(raw: string): { x: string; y: string } | null {
  const trimmed = raw.trim();
  const colon = trimmed.indexOf(":");
  if (colon === -1) {
    return null;
  }

  const kvSegment = trimmed.slice(colon + 1).trim();
  if (kvSegment.length === 0) {
    return null;
  }

  const entries = splitAllAtTopLevel(kvSegment, ",").map((entry) => entry.trim());
  let x: string | null = null;
  let y: string | null = null;

  for (const entry of entries) {
    const eq = entry.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = entry.slice(0, eq).trim().toLowerCase();
    const value = entry.slice(eq + 1).trim();
    if (key === "x") {
      x = value;
    } else if (key === "y") {
      y = value;
    }
  }

  if (!x || !y) {
    return null;
  }
  return { x, y };
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
    if (!left.point || !right.point) {
      return { point: null, diagnostics };
    }
    return {
      point: {
        x: left.point.x + interpolation.factor * (right.point.x - left.point.x),
        y: left.point.y + interpolation.factor * (right.point.y - left.point.y)
      },
      diagnostics
    };
  }

  const evaluated = evaluateRawCoordinate(term, context);
  diagnostics.push(...evaluated.diagnostics);
  return { point: evaluated.point, diagnostics };
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
