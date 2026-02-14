import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import type { PathOptionItem } from "../../ast/types.js";
import type { DiagnosticPushFn, ArcParameters, PlacementSegment } from "./types.js";
import { coordinateInner, toRadians } from "./shared.js";
import { parseLength } from "../coords/parse-length.js";
import type { Point, ResolvedStyle, ScenePathCommand } from "../types.js";

export function extractArcParameters(item: PathOptionItem, pushDiagnostic: DiagnosticPushFn, style: ResolvedStyle): ArcParameters | null {
  let startAngle: number | null = null;
  let endAngle: number | null = null;
  let deltaAngle: number | null = null;
  let rx: number | null = style.xRadius ?? style.radius;
  let ry: number | null = style.yRadius ?? style.radius;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "start angle") {
      const parsed = Number(entry.valueRaw);
      if (Number.isFinite(parsed)) {
        startAngle = parsed;
      }
    } else if (entry.key === "end angle") {
      const parsed = Number(entry.valueRaw);
      if (Number.isFinite(parsed)) {
        endAngle = parsed;
      }
    } else if (entry.key === "delta angle") {
      const parsed = Number(entry.valueRaw);
      if (Number.isFinite(parsed)) {
        deltaAngle = parsed;
      }
    } else if (entry.key === "radius") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed != null) {
        rx = parsed;
        ry = parsed;
      }
    } else if (entry.key === "x radius") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed != null) {
        rx = parsed;
      }
    } else if (entry.key === "y radius") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed != null) {
        ry = parsed;
      }
    }
  }

  if (startAngle == null) {
    pushDiagnostic("invalid-arc-parameters", "Arc requires a start angle.", item.span.from, item.span.to);
    return null;
  }

  const resolvedEndAngle = endAngle ?? (deltaAngle != null ? startAngle + deltaAngle : null);
  if (resolvedEndAngle == null) {
    pushDiagnostic("invalid-arc-parameters", "Arc requires an end angle or delta angle.", item.span.from, item.span.to);
    return null;
  }

  if (rx != null && ry != null) {
    return {
      startAngle,
      endAngle: resolvedEndAngle,
      rx,
      ry
    };
  }

  pushDiagnostic("invalid-arc-parameters", "Arc requires `radius` or both `x radius` and `y radius`.", item.span.from, item.span.to);
  return null;
}

export function parseArcShorthand(raw: string): ArcParameters | null {
  const inner = coordinateInner(raw);
  if (!inner) {
    return null;
  }

  const parts = splitAllAtTopLevel(inner, ":").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length !== 3) {
    return null;
  }

  const startAngle = Number(parts[0]);
  const endAngle = Number(parts[1]);
  if (!Number.isFinite(startAngle) || !Number.isFinite(endAngle)) {
    return null;
  }

  const radiiSpec = parts[2];
  const elliptical = radiiSpec.match(/^(.+?)\s+and\s+(.+)$/i);
  if (elliptical) {
    const rx = parseLength(elliptical[1].trim(), "cm");
    const ry = parseLength(elliptical[2].trim(), "cm");
    if (rx == null || ry == null) {
      return null;
    }
    return { startAngle, endAngle, rx, ry };
  }

  const radius = parseLength(radiiSpec, "cm");
  if (radius == null) {
    return null;
  }

  return { startAngle, endAngle, rx: radius, ry: radius };
}

export function appendArcCommand(
  commands: ScenePathCommand[],
  from: Point,
  params: ArcParameters
): { endpoint: Point; segment: PlacementSegment } {
  const endpoint = arcEndpoint(from, params);
  commands.push({
    kind: "A",
    rx: Math.abs(params.rx),
    ry: Math.abs(params.ry),
    xAxisRotation: 0,
    largeArc: Math.abs(params.endAngle - params.startAngle) > 180,
    sweep: params.endAngle >= params.startAngle,
    to: endpoint
  });
  return {
    endpoint,
    segment: {
      kind: "arc",
      from,
      to: endpoint,
      params
    }
  };
}

function arcEndpoint(from: Point, params: ArcParameters): Point {
  const center = arcCenter(from, params);
  const endRadians = toRadians(params.endAngle);
  return {
    x: center.x + params.rx * Math.cos(endRadians),
    y: center.y + params.ry * Math.sin(endRadians)
  };
}

function arcCenter(from: Point, params: ArcParameters): Point {
  const startRadians = toRadians(params.startAngle);
  return {
    x: from.x - params.rx * Math.cos(startRadians),
    y: from.y - params.ry * Math.sin(startRadians)
  };
}
