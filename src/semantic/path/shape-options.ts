import type { PathOptionItem } from "../../ast/types.js";
import { parseLength } from "../coords/parse-length.js";
import type { DiagnosticPushFn } from "./types.js";

export function extractEllipseRadii(item: PathOptionItem, pushDiagnostic: DiagnosticPushFn): { rx: number; ry: number } | null {
  let rx: number | null = null;
  let ry: number | null = null;
  let radius: number | null = null;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "x radius") {
      rx = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "y radius") {
      ry = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "radius") {
      radius = parseLength(entry.valueRaw, "cm");
    }
  }

  if (radius != null) {
    return { rx: radius, ry: radius };
  }

  if (rx != null && ry != null) {
    return { rx, ry };
  }

  if (rx == null && ry == null) {
    return null;
  }

  pushDiagnostic("invalid-ellipse-radii", "Ellipse requires both x radius and y radius.", item.span.from, item.span.to);
  return null;
}

export function extractCircleShapeOptions(item: PathOptionItem): {
  radius?: number;
  rx?: number;
  ry?: number;
  rotation?: number;
} {
  let radius: number | undefined;
  let rx: number | undefined;
  let ry: number | undefined;
  let rotation: number | undefined;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "radius") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed != null) {
        radius = parsed;
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
    } else if (entry.key === "rotate") {
      const parsed = Number(entry.valueRaw);
      if (Number.isFinite(parsed)) {
        rotation = parsed;
      }
    }
  }

  return { radius, rx, ry, rotation };
}

export function extractRoundedCorners(options: PathOptionItem["options"], current: number | null): number | null | undefined {
  let next = current;
  let changed = false;

  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key === "sharp corners") {
      next = null;
      changed = true;
      continue;
    }
    if (entry.kind === "flag" && entry.key === "rounded corners") {
      next = parseLength("4pt", "pt") ?? 4;
      changed = true;
      continue;
    }
    if (entry.kind === "kv" && entry.key === "rounded corners") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        next = parsed;
        changed = true;
      }
    }
  }

  return changed ? next : undefined;
}
