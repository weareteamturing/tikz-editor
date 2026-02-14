import type { PathOptionItem } from "../../ast/types.js";
import type { OptionListAst } from "../../options/types.js";
import type { SemanticContext } from "../context.js";
import { currentAnchorForDirection, parseDirectionalKey } from "../path/node-positioning.js";
import { resolveContextDelta } from "../style/resolve.js";
import { cloneCustomStyleRegistry } from "../style/custom-styles.js";
import { expandOptionListMacros } from "../style/macro-options.js";
import type { ResolvedStyle } from "../types.js";
import type { NodeLayer, NodeShape } from "./types.js";
import { normalizeOptionValue } from "./utils.js";

export function withDefaultNodePosition(options: OptionListAst | undefined, defaultPos: number | undefined): OptionListAst | undefined {
  if (defaultPos == null) {
    return options;
  }

  const hasExplicitPosition =
    options?.entries.some(
      (entry) =>
        (entry.kind === "kv" && entry.key === "pos") ||
        (entry.kind === "flag" &&
          (entry.key === "midway" ||
            entry.key === "near start" ||
            entry.key === "near end" ||
            entry.key === "very near start" ||
            entry.key === "very near end" ||
            entry.key === "at start" ||
            entry.key === "at end"))
    ) ?? false;

  if (hasExplicitPosition) {
    return options;
  }

  const syntheticEntry = {
    kind: "kv" as const,
    key: "pos",
    valueRaw: String(defaultPos),
    span: options?.span ?? { from: 0, to: 0 },
    raw: `pos=${defaultPos}`
  };

  if (!options) {
    return {
      span: { from: 0, to: 0 },
      raw: `[pos=${defaultPos}]`,
      entries: [syntheticEntry]
    };
  }

  return {
    span: options.span,
    raw: `${options.raw}, pos=${defaultPos}`,
    entries: [...options.entries, syntheticEntry]
  };
}

export function resolveNodeStyle(
  options: PathOptionItem["options"] | undefined,
  baseStyle: ResolvedStyle,
  context: SemanticContext,
  transformScale = 1
): ResolvedStyle {
  let resolvedStyle = { ...baseStyle };
  if (options) {
    const frame = context.stack[context.stack.length - 1];
    const expanded = expandOptionListMacros([options], frame.macroBindings, context.macroTraceCollector ?? undefined);
    const resolved = resolveContextDelta(baseStyle, frame.transform, expanded, cloneCustomStyleRegistry(frame.customStyles));
    resolvedStyle = resolved.style;
  }

  if (Math.abs(transformScale - 1) <= 1e-6) {
    return resolvedStyle;
  }

  return {
    ...resolvedStyle,
    lineWidth: resolvedStyle.lineWidth * transformScale,
    doubleDistance: resolvedStyle.doubleDistance * transformScale,
    fontSize: resolvedStyle.fontSize * transformScale
  };
}

export function resolveNodeOptionScale(
  options: PathOptionItem["options"] | undefined,
  baseStyle: ResolvedStyle,
  context: SemanticContext
): number {
  if (!options) {
    return 1;
  }

  const frame = context.stack[context.stack.length - 1];
  const expanded = expandOptionListMacros([options], frame.macroBindings, context.macroTraceCollector ?? undefined);
  const resolved = resolveContextDelta(baseStyle, frame.transform, expanded, cloneCustomStyleRegistry(frame.customStyles));
  return computeRelativeTransformScale(frame.transform, resolved.transform);
}

export function resolveEffectiveNodeOptions(params: {
  statementOptions: OptionListAst | undefined;
  nodeOptions: OptionListAst | undefined;
  everyNodeStyles: OptionListAst[];
  everyRectangleNodeStyles: OptionListAst[];
  everyCircleNodeStyles: OptionListAst[];
}): OptionListAst | undefined {
  const base = mergeOptionLists([...params.everyNodeStyles, params.statementOptions, params.nodeOptions]);
  const shape = resolveNodeShape(base);
  const shapeStyles =
    shape === "circle"
      ? params.everyCircleNodeStyles
      : shape === "rectangle"
        ? params.everyRectangleNodeStyles
        : [];

  return mergeOptionLists([...params.everyNodeStyles, ...shapeStyles, params.statementOptions, params.nodeOptions]);
}

function mergeOptionLists(lists: Array<OptionListAst | undefined>): OptionListAst | undefined {
  const present = lists.filter((entry): entry is OptionListAst => Boolean(entry));
  if (present.length === 0) {
    return undefined;
  }

  const spanFrom = present.reduce((min, list) => Math.min(min, list.span.from), Number.POSITIVE_INFINITY);
  const spanTo = present.reduce((max, list) => Math.max(max, list.span.to), 0);
  return {
    span: {
      from: Number.isFinite(spanFrom) ? spanFrom : 0,
      to: spanTo
    },
    raw: present.map((list) => list.raw).join(", "),
    entries: present.flatMap((list) => list.entries)
  };
}

export function computeTransformScale(transform: { a: number; b: number; c: number; d: number }): number {
  const sx = Math.hypot(transform.a, transform.b);
  const sy = Math.hypot(transform.c, transform.d);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
    return 1;
  }
  const averaged = (sx + sy) / 2;
  if (!Number.isFinite(averaged) || averaged <= 1e-6) {
    return 1;
  }
  return averaged;
}

function computeRelativeTransformScale(
  baseTransform: { a: number; b: number; c: number; d: number },
  resolvedTransform: { a: number; b: number; c: number; d: number }
): number {
  const base = computeTransformScale(baseTransform);
  const resolved = computeTransformScale(resolvedTransform);
  if (!Number.isFinite(resolved) || resolved <= 1e-6) {
    return 1;
  }
  if (!Number.isFinite(base) || base <= 1e-6) {
    return resolved;
  }
  return resolved / base;
}

export function resolveNodeShape(options: PathOptionItem["options"] | undefined): NodeShape {
  if (!options) {
    return "rectangle";
  }

  let shape: NodeShape = "rectangle";
  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "circle" || entry.key === "rectangle" || entry.key === "ellipse" || entry.key === "coordinate") {
        shape = entry.key;
      }
      continue;
    }
    if (entry.kind === "kv" && entry.key === "shape") {
      const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
      if (normalized === "circle" || normalized === "rectangle" || normalized === "ellipse" || normalized === "coordinate") {
        shape = normalized;
      }
    }
  }
  return shape;
}

export function resolveNodeAnchor(options: PathOptionItem["options"] | undefined): string {
  if (!options) {
    return "center";
  }

  let anchor = "center";
  for (const entry of options.entries) {
    if (entry.kind === "kv") {
      if (entry.key === "anchor") {
        const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase().replaceAll("_", " ");
        if (normalized.length > 0) {
          anchor = normalized;
        }
        continue;
      }

      const directional = parseDirectionalKey(entry.key);
      if (directional) {
        anchor = directional.legacyOf ? "center" : currentAnchorForDirection(directional.direction);
      }
      continue;
    }

    if (entry.kind !== "flag") {
      continue;
    }

    if (entry.key === "centered") {
      anchor = "center";
      continue;
    }

    const directional = parseDirectionalKey(entry.key);
    if (directional) {
      anchor = directional.legacyOf ? "center" : currentAnchorForDirection(directional.direction);
    }
  }

  return anchor;
}

export function resolveNodeLayer(options: PathOptionItem["options"] | undefined, context: SemanticContext): NodeLayer {
  let mode: NodeLayer = context.stack[context.stack.length - 1]?.nodeLayerMode ?? "front";
  if (!options) {
    return mode;
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "behind path") {
        mode = "behind";
      } else if (entry.key === "in front of path") {
        mode = "front";
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "behind path") {
      const boolish = parseBoolish(entry.valueRaw);
      if (boolish != null) {
        mode = boolish ? "behind" : "front";
      }
      continue;
    }
    if (entry.key === "in front of path") {
      const boolish = parseBoolish(entry.valueRaw);
      if (boolish != null) {
        mode = boolish ? "front" : "behind";
      }
    }
  }

  return mode;
}

function parseBoolish(raw: string): boolean | null {
  const normalized = normalizeOptionValue(raw).toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0") {
    return false;
  }
  return null;
}
