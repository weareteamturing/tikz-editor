import type { PathItem, PathOptionItem, Span } from "../../ast/types.js";
import type { SemanticContext } from "../context.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import { createEditHandle } from "../edit-handles.js";
import type { DiagnosticPushFn, PlacementSegment } from "../path/types.js";
import type { Point } from "../types.js";
import { arcCenter, clamp, interpolate, normalizeOptionValue, toRadians } from "./utils.js";

export function resolveNodeTargetPoint(
  item: PathItem & { kind: "Node"; atRaw?: string; atSpan?: Span; atRelativePrefix?: "+" | "++" },
  context: SemanticContext,
  handleSourceId: string,
  span: { from: number; to: number },
  pushDiagnostic: DiagnosticPushFn,
  options: PathOptionItem["options"] | undefined,
  segment: PlacementSegment | null,
  defaultPoint?: Point,
  opts: { allowImplicitOriginHandle?: boolean } = {}
): Point {
  if (item.atRaw) {
    const evaluated = evaluateRawCoordinate(item.atRaw, context, item.atRelativePrefix);
    if (evaluated.world) {
      const handleSpan = item.atSpan ?? span;
      const handle = createEditHandle(evaluated, handleSpan, handleSourceId, "node-position", context);
      if (handle) context.editHandles.push(handle);
      return evaluated.world;
    }
    for (const code of evaluated.diagnostics) {
      pushDiagnostic(code, `Node placement issue: ${code}`, span.from, span.to);
    }
  }

  let optionAtRaw: string | null = null;
  let optionAtSpan: Span | null = null;
  for (const entry of options?.entries ?? []) {
    if (entry.kind === "kv" && entry.key === "at") {
      optionAtRaw = normalizeOptionValue(entry.valueRaw);
      optionAtSpan = entry.span;
    }
  }
  if (optionAtRaw && optionAtRaw.length > 0) {
    const evaluated = evaluateRawCoordinate(optionAtRaw, context);
    if (evaluated.world) {
      const handleSpan = optionAtSpan ?? span;
      const handle = createEditHandle(evaluated, handleSpan, handleSourceId, "node-position", context);
      if (handle) context.editHandles.push(handle);
      return evaluated.world;
    }
    for (const code of evaluated.diagnostics) {
      pushDiagnostic(code, `Node placement issue: ${code}`, span.from, span.to);
    }
  }

  const pos = resolveNodePositionFraction(options);
  if (pos != null && segment) {
    return pointAtPlacementSegment(segment, pos);
  }

  if (segment) {
    return pointAtSegmentEnd(segment);
  }

  if (opts.allowImplicitOriginHandle) {
    const frame = context.stack[context.stack.length - 1];
    const insertionOffset = resolveImplicitNodePlacementInsertionOffset(item, context.source);
    const implicitPoint = defaultPoint ?? context.currentPoint ?? { x: 0, y: 0 };
    context.editHandles.push({
      id: `handle:${handleSourceId}:node-position:${context.editHandles.length}`,
      runtimeId: `handle:${handleSourceId}:node-position:${context.editHandles.length}`,
      sourceRef: {
        sourceId: handleSourceId,
        sourceSpan: { from: insertionOffset, to: insertionOffset },
        sourceFingerprint: context.sourceFingerprint
      },
      kind: "node-position",
      world: implicitPoint,
      local: { x: 0, y: 0 },
      transform: frame?.transform ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      sourceText: "",
      coordinateForm: "cartesian",
      rewriteMode: "direct",
      insertion: { kind: "node-inline-at" }
    });
  }

  return defaultPoint ?? context.currentPoint ?? { x: 0, y: 0 };
}

function resolveImplicitNodePlacementInsertionOffset(
  item: PathItem & { kind: "Node"; textSource: "group" | "option"; textSpan: Span },
  source: string
): number {
  if (item.textSource === "group" && item.textSpan.from > item.span.from && source[item.textSpan.from - 1] === "{") {
    return item.textSpan.from - 1;
  }
  return item.span.to;
}

export function resolveNodePositionFraction(options: PathOptionItem["options"] | undefined): number | null {
  if (!options) {
    return null;
  }

  let value: number | null = null;
  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "midway") {
        value = 0.5;
      } else if (entry.key === "near start") {
        value = 0.25;
      } else if (entry.key === "near end") {
        value = 0.75;
      } else if (entry.key === "very near start") {
        value = 0.125;
      } else if (entry.key === "very near end") {
        value = 0.875;
      } else if (entry.key === "at start") {
        value = 0;
      } else if (entry.key === "at end") {
        value = 1;
      }
      continue;
    }

    if (entry.kind === "kv" && entry.key === "pos") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed)) {
        value = parsed;
      }
    }
  }

  if (value == null) {
    return null;
  }
  return clamp(value, 0, 1);
}

export function pointAtPlacementSegment(segment: PlacementSegment, t: number): Point {
  const clamped = clamp(t, 0, 1);
  if (segment.kind === "line") {
    return interpolate(segment.from, segment.to, clamped);
  }

  if (segment.kind === "hv") {
    if (clamped <= 0.5) {
      return interpolate(segment.from, segment.bend, clamped * 2);
    }
    return interpolate(segment.bend, segment.to, (clamped - 0.5) * 2);
  }

  if (segment.kind === "cubic") {
    return cubicPoint(segment.from, segment.c1, segment.c2, segment.to, clamped);
  }

  const center = arcCenter(segment.from, segment.params);
  const angle = segment.params.startAngle + (segment.params.endAngle - segment.params.startAngle) * clamped;
  const radians = toRadians(angle);
  return {
    x: center.x + segment.params.rx * Math.cos(radians),
    y: center.y + segment.params.ry * Math.sin(radians)
  };
}

function pointAtSegmentEnd(segment: PlacementSegment): Point {
  if (segment.kind === "line" || segment.kind === "hv" || segment.kind === "cubic" || segment.kind === "arc") {
    return segment.to;
  }
  return pointAtPlacementSegment(segment, 1);
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
  };
}
