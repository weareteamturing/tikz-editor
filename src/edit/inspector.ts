import type { StyleLevel } from "./actions.js";
import { resolvePropertyTarget } from "./property-target.js";
import { normalizeColor, resolveDefineColorModel } from "../semantic/style/colors.js";
import { findTopLevelCharacter, parseStyleValueAsOptionList, readBalancedBlock, stripEnclosingBraces } from "../semantic/style/option-utils.js";
import type { ArrowMarker, ArrowTipKind, EditHandle, SceneElement, ScenePathCommand } from "../semantic/types.js";

export type ArrowTipPresetId =
  | "none"
  | "arrow"
  | "stealth"
  | "latex"
  | "triangle"
  | "circle"
  | "square"
  | "kite"
  | "bar"
  | "hooks"
  | "custom";

export type DashStylePresetId =
  | "solid"
  | "dashed"
  | "densely dashed"
  | "loosely dashed"
  | "dotted"
  | "densely dotted"
  | "loosely dotted"
  | "custom";

export type LineCapPresetId = "butt" | "round" | "square" | "custom";

export type LineJoinPresetId = "miter" | "round" | "bevel" | "custom";

export type PathMorphingDecorationPresetId =
  | "none"
  | "zigzag"
  | "straight zigzag"
  | "random steps"
  | "saw"
  | "bent"
  | "bumps"
  | "coil"
  | "snake"
  | "custom";

export type ArrowTipSide = "start" | "end";

export type ArrowTipPresetOption = {
  value: Exclude<ArrowTipPresetId, "custom">;
  label: string;
};

export type DashStylePresetOption = {
  value: Exclude<DashStylePresetId, "custom">;
  label: string;
};

export type LineCapPresetOption = {
  value: Exclude<LineCapPresetId, "custom">;
  label: string;
};

export type LineJoinPresetOption = {
  value: Exclude<LineJoinPresetId, "custom">;
  label: string;
};

export type PathMorphingDecorationPresetOption = {
  value: Exclude<PathMorphingDecorationPresetId, "custom">;
  label: string;
};

export type ArrowTipWriteContext = {
  startRaw: string;
  endRaw: string;
  clearKeys: string[];
};

export type ArrowTipWriteTarget = SetPropertyWriteTarget & {
  arrowContext: ArrowTipWriteContext;
};

export type ArrowTipSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type DashStyleSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type LineCapSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type LineJoinSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type PathMorphingDecorationSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type RoundedCornersSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type InspectorSnapshot = {
  source: string;
  editHandles?: EditHandle[];
};

export type SetPropertyWriteTarget = {
  mode: "setProperty";
  elementId: string;
  level: StyleLevel;
  key: string;
  writable: boolean;
  reason?: string;
};

export type MoveAxisWriteTarget = {
  mode: "moveAxis";
  elementId: string;
  axis: "x" | "y";
  baseX: number;
  baseY: number;
  writable: boolean;
  reason?: string;
};

export type InspectorProperty =
  | {
      kind: "number";
      id: string;
      label: string;
      value: number;
      step: number;
      unit?: string;
      write?: MoveAxisWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "color";
      id: string;
      label: string;
      value: string | null;
      syntaxValue: string | null;
      options: string[];
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "lineWidth";
      id: string;
      label: string;
      value: number;
      min: number;
      max: number;
      step: number;
      presetLabel: string | null;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "dashStyle";
      id: string;
      label: string;
      value: DashStylePresetId;
      options: DashStylePresetOption[];
      previewLineWidth: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "lineCap";
      id: string;
      label: string;
      value: LineCapPresetId;
      options: LineCapPresetOption[];
      previewLineWidth: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "lineJoin";
      id: string;
      label: string;
      value: LineJoinPresetId;
      options: LineJoinPresetOption[];
      previewLineWidth: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "pathMorphingDecoration";
      id: string;
      label: string;
      value: PathMorphingDecorationPresetId;
      options: PathMorphingDecorationPresetOption[];
      previewLineWidth: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "roundedCorners";
      id: string;
      label: string;
      enabled: boolean;
      radius: number;
      defaultRadius: number;
      min: number;
      max: number;
      step: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "arrowTip";
      id: string;
      label: string;
      side: ArrowTipSide;
      value: ArrowTipPresetId;
      options: ArrowTipPresetOption[];
      previewLineWidth: number;
      write: ArrowTipWriteTarget;
    };

export type InspectorSection = {
  id: string;
  title: string;
  sourceLevel: StyleLevel;
  properties: InspectorProperty[];
};

export type InspectorDescriptor = {
  elementKind: "path" | "circle" | "ellipse" | "text";
  elementId: string;
  writeTargetId: string | null;
  readOnlyReason?: string;
  sections: InspectorSection[];
};

const COLOR_OPTIONS = [
  "none",
  "black",
  "darkgray",
  "gray",
  "lightgray",
  "white",
  "red",
  "green",
  "blue",
  "cyan",
  "magenta",
  "yellow",
  "lime",
  "olive",
  "orange",
  "pink",
  "violet",
  "purple",
  "teal",
  "brown"
];

const HEX_TO_NAMED_COLOR: Record<string, string> = {
  "#000000": "black",
  "#404040": "darkgray",
  "#808080": "gray",
  "#bfbfbf": "lightgray",
  "#ffffff": "white",
  "#ff0000": "red",
  "#00ff00": "green",
  "#0000ff": "blue",
  "#00ffff": "cyan",
  "#ff00ff": "magenta",
  "#ffff00": "yellow",
  "#bfff00": "lime",
  "#808000": "olive",
  "#ff8000": "orange",
  "#ffbfbf": "pink",
  "#800080": "violet",
  "#bf0040": "purple",
  "#008080": "teal",
  "#bf8040": "brown"
};

export const LINE_WIDTH_PRESETS: Array<{ label: string; value: number }> = [
  { label: "ultra thin", value: 0.1 },
  { label: "very thin", value: 0.2 },
  { label: "thin", value: 0.4 },
  { label: "semithick", value: 0.6 },
  { label: "thick", value: 0.8 },
  { label: "very thick", value: 1.2 },
  { label: "ultra thick", value: 1.6 }
];

const ARROW_OPTION_KEY = "arrows";
const ARROW_SHORTHAND_KEYS = ["-", "->", "<-", "<->"] as const;
const ARROW_DEFAULT_CLEAR_KEYS = [ARROW_OPTION_KEY, ...ARROW_SHORTHAND_KEYS] as const;
const DASH_STYLE_PRESET_CLEAR_KEYS = [
  "solid",
  "dashed",
  "densely dashed",
  "loosely dashed",
  "dotted",
  "densely dotted",
  "loosely dotted",
  "dash pattern",
  "dash phase",
  "dash"
] as const;
const DASH_PATTERN_EPSILON = 1e-3;
const ARROW_TIP_OPTIONS: ArrowTipPresetOption[] = [
  { value: "none", label: "None" },
  { value: "arrow", label: "Arrow" },
  { value: "stealth", label: "Stealth" },
  { value: "latex", label: "Latex" },
  { value: "triangle", label: "Triangle" },
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "kite", label: "Diamond" },
  { value: "bar", label: "Bar" },
  { value: "hooks", label: "Hooks" }
];
const DASH_STYLE_OPTIONS: DashStylePresetOption[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "densely dashed", label: "Densely dashed" },
  { value: "loosely dashed", label: "Loosely dashed" },
  { value: "dotted", label: "Dotted" },
  { value: "densely dotted", label: "Densely dotted" },
  { value: "loosely dotted", label: "Loosely dotted" }
];
const LINE_CAP_OPTIONS: LineCapPresetOption[] = [
  { value: "butt", label: "Butt" },
  { value: "round", label: "Round" },
  { value: "square", label: "Square" }
];
const LINE_JOIN_OPTIONS: LineJoinPresetOption[] = [
  { value: "miter", label: "Miter" },
  { value: "round", label: "Round" },
  { value: "bevel", label: "Bevel" }
];
const PATH_MORPHING_DECORATION_OPTIONS: PathMorphingDecorationPresetOption[] = [
  { value: "none", label: "None" },
  { value: "zigzag", label: "Zigzag" },
  { value: "straight zigzag", label: "Straight zigzag" },
  { value: "random steps", label: "Random steps" },
  { value: "saw", label: "Saw" },
  { value: "bent", label: "Bent" },
  { value: "bumps", label: "Bumps" },
  { value: "coil", label: "Coil" },
  { value: "snake", label: "Snake" }
];
const PATH_MORPHING_DECORATION_CLEAR_KEYS = [
  "decorate",
  "/tikz/decorate",
  "decoration",
  "/pgf/decoration",
  "/pgf/decoration/name",
  "/pgf/decorations/name",
  "name",
  "mirror",
  "raise",
  "transform",
  "pre",
  "pre length",
  "post",
  "post length",
  "path has corners",
  "reverse path",
  "segment length",
  "amplitude",
  "start radius",
  "shape size",
  "shape width",
  "shape start width",
  "shape height",
  "shape start height",
  "shape sep",
  "text",
  "text color",
  "text align",
  "text align/align",
  "text align/left indent",
  "text align/right indent"
] as const;
const ROUNDED_CORNERS_CLEAR_KEYS = ["rounded corners", "sharp corners"] as const;
export const ROUNDED_CORNERS_DEFAULT_RADIUS = 4;
const ROUNDED_CORNERS_FALLBACK_MAX = 24;
const ROUNDED_CORNERS_MIN = 0.1;

export function buildArrowTipSetPropertyMutation(
  context: ArrowTipWriteContext,
  side: ArrowTipSide,
  value: Exclude<ArrowTipPresetId, "custom">
): ArrowTipSetPropertyMutation {
  const nextStartRaw = side === "start" ? arrowPresetSideRaw(value, "start") : context.startRaw;
  const nextEndRaw = side === "end" ? arrowPresetSideRaw(value, "end") : context.endRaw;
  const serialized = serializeArrowSides(nextStartRaw, nextEndRaw);

  return {
    key: serialized.key,
    value: serialized.value,
    clearKeys: uniqueStrings([...ARROW_DEFAULT_CLEAR_KEYS, ...context.clearKeys])
  };
}

export function buildDashStyleSetPropertyMutation(
  value: Exclude<DashStylePresetId, "custom">
): DashStyleSetPropertyMutation {
  return {
    key: value,
    value: "true",
    clearKeys: uniqueStrings(DASH_STYLE_PRESET_CLEAR_KEYS)
  };
}

export function buildLineCapSetPropertyMutation(
  value: Exclude<LineCapPresetId, "custom">
): LineCapSetPropertyMutation {
  return {
    key: "line cap",
    value: value === "square" ? "projecting" : value,
    clearKeys: []
  };
}

export function buildLineJoinSetPropertyMutation(
  value: Exclude<LineJoinPresetId, "custom">
): LineJoinSetPropertyMutation {
  return {
    key: "line join",
    value,
    clearKeys: []
  };
}

export function buildPathMorphingDecorationSetPropertyMutations(
  value: Exclude<PathMorphingDecorationPresetId, "custom">
): PathMorphingDecorationSetPropertyMutation[] {
  const clearKeys = uniqueStrings(PATH_MORPHING_DECORATION_CLEAR_KEYS);
  const clearKeysWithoutDecorate = clearKeys.filter((key) => key !== "decorate");

  if (value === "none") {
    return [
      {
        key: "decorate",
        value: "false",
        clearKeys: clearKeysWithoutDecorate
      }
    ];
  }

  return [
    {
      key: "decorate",
      value: "true",
      clearKeys: clearKeysWithoutDecorate
    },
    {
      key: "decoration",
      value,
      clearKeys: clearKeysWithoutDecorate
    }
  ];
}

export function buildRoundedCornersSetPropertyMutation(
  enabled: boolean,
  radius: number = ROUNDED_CORNERS_DEFAULT_RADIUS
): RoundedCornersSetPropertyMutation {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : ROUNDED_CORNERS_DEFAULT_RADIUS;
  const clearKeys = uniqueStrings(ROUNDED_CORNERS_CLEAR_KEYS);

  if (!enabled) {
    return {
      key: "sharp corners",
      value: "true",
      clearKeys: clearKeys.filter((key) => key !== "sharp corners")
    };
  }

  return {
    key: "rounded corners",
    value:
      Math.abs(safeRadius - ROUNDED_CORNERS_DEFAULT_RADIUS) <= 1e-6
        ? "true"
        : `${formatInspectorLength(safeRadius)}pt`,
    clearKeys: clearKeys.filter((key) => key !== "rounded corners")
  };
}

export function getInspectorDescriptor(element: SceneElement, snapshot: InspectorSnapshot): InspectorDescriptor {
  const inlineTarget = resolveInlineWriteTarget(element, snapshot.source);
  const colorAliases = collectInspectorColorAliases(snapshot.source);
  const metrics = computeElementMetrics(element);
  const moveWrite = resolveMoveWriteTarget(element, snapshot.editHandles, metrics);
  const strokeColor = normalizeInspectorColorValue(element.style.stroke);
  const strokeColorSyntax = resolveColorSyntaxValue(
    snapshot.source,
    inlineTarget.targetId,
    ["draw", "color"],
    strokeColor,
    colorAliases
  );
  const fillColor = normalizeInspectorColorValue(element.style.fill);
  const fillColorSyntax = resolveColorSyntaxValue(
    snapshot.source,
    inlineTarget.targetId,
    ["fill", "color"],
    fillColor,
    colorAliases
  );
  const textColor = normalizeInspectorColorValue(element.style.textColor);
  const textColorSyntax = resolveColorSyntaxValue(
    snapshot.source,
    inlineTarget.targetId,
    ["text", "color"],
    textColor,
    colorAliases
  );
  const pathStrokeVisibility =
    element.kind === "Path"
      ? computePathStrokeControlVisibility(element.commands, element.style.dashArray)
      : null;
  const pathFillVisibility = element.kind === "Path" ? pathSupportsFillEditing(element.commands) : true;

  const sections: InspectorSection[] = [
    {
      id: "transform",
      title: "Transform",
      sourceLevel: "command",
      properties: [
        {
          kind: "number",
          id: "x",
          label: "X",
          value: metrics.centerX,
          step: 0.1,
          unit: "pt",
          write: moveWrite.x
        },
        {
          kind: "number",
          id: "y",
          label: "Y",
          value: metrics.centerY,
          step: 0.1,
          unit: "pt",
          write: moveWrite.y
        },
        {
          kind: "number",
          id: "width",
          label: "Width",
          value: metrics.width,
          step: 0.1,
          unit: "pt",
          readOnlyReason: "Resize from canvas corner handles."
        },
        {
          kind: "number",
          id: "height",
          label: "Height",
          value: metrics.height,
          step: 0.1,
          unit: "pt",
          readOnlyReason: "Resize from canvas corner handles."
        }
      ]
    },
    {
      id: "stroke",
      title: "Stroke",
      sourceLevel: "command",
      properties: [
        {
          kind: "color",
          id: "stroke-color",
          label: "Color",
          value: strokeColor,
          syntaxValue: strokeColorSyntax,
          options: colorOptionsForValue(strokeColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "draw")
        },
        {
          kind: "lineWidth",
          id: "line-width",
          label: "Line width",
          value: element.style.lineWidth,
          min: 0.1,
          max: 6,
          step: 0.1,
          presetLabel: lineWidthPresetLabel(element.style.lineWidth),
          write: makeSetPropertyWriteTarget(inlineTarget, "line width")
        },
        {
          kind: "dashStyle",
          id: "dash-style",
          label: "Dash style",
          value: dashStylePresetFromStyle(element.style.dashArray, element.style.lineWidth),
          options: DASH_STYLE_OPTIONS,
          previewLineWidth: element.style.lineWidth,
          write: makeSetPropertyWriteTarget(inlineTarget, "solid")
        }
      ]
    }
  ];
  if (pathFillVisibility) {
    sections.push({
      id: "fill",
      title: "Fill",
      sourceLevel: "command",
      properties: [
        {
          kind: "color",
          id: "fill-color",
          label: "Color",
          value: fillColor,
          syntaxValue: fillColorSyntax,
          options: colorOptionsForValue(fillColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "fill")
        }
      ]
    });
  }

  const strokeSection = sections.find((section) => section.id === "stroke");
  if (strokeSection && pathStrokeVisibility) {
    if (pathStrokeVisibility.showLineCap) {
      strokeSection.properties.push({
        kind: "lineCap",
        id: "line-cap",
        label: "Line cap",
        value: lineCapPresetFromStyle(element.style.lineCap),
        options: LINE_CAP_OPTIONS,
        previewLineWidth: element.style.lineWidth,
        write: makeSetPropertyWriteTarget(inlineTarget, "line cap")
      });
    }
    if (pathStrokeVisibility.showLineJoin) {
      strokeSection.properties.push({
        kind: "lineJoin",
        id: "line-join",
        label: "Line join",
        value: lineJoinPresetFromStyle(element.style.lineJoin),
        options: LINE_JOIN_OPTIONS,
        previewLineWidth: element.style.lineWidth,
        write: makeSetPropertyWriteTarget(inlineTarget, "line join")
      });
    }
  }

  if (element.kind === "Path") {
    const roundedCornersEnabled = element.style.roundedCorners != null && element.style.roundedCorners > 0;
    const roundedCornersMax = normalizeRoundedCornersMax(computePathRoundedCornersMax(element.commands));
    const roundedCornersDefaultRadius = clampRoundedCornersRadius(ROUNDED_CORNERS_DEFAULT_RADIUS, roundedCornersMax);
    const roundedCornersRadius = roundedCornersEnabled
      ? clampRoundedCornersRadius(element.style.roundedCorners ?? ROUNDED_CORNERS_DEFAULT_RADIUS, roundedCornersMax)
      : roundedCornersDefaultRadius;
    const pathSection: InspectorSection = {
      id: "path",
      title: "Path",
      sourceLevel: "command",
      properties: [
        {
          kind: "pathMorphingDecoration",
          id: "path-morphing-decoration",
          label: "Path morphing",
          value: resolvePathMorphingDecorationPreset(snapshot.source, inlineTarget.targetId, element.style.decoration),
          options: PATH_MORPHING_DECORATION_OPTIONS,
          previewLineWidth: element.style.lineWidth,
          write: makeSetPropertyWriteTarget(inlineTarget, "decorate")
        }
      ]
    };

    if (pathStrokeVisibility?.showLineJoin) {
      pathSection.properties.push({
        kind: "roundedCorners",
        id: "rounded-corners",
        label: "Rounded corners",
        enabled: roundedCornersEnabled,
        radius: roundedCornersRadius,
        defaultRadius: roundedCornersDefaultRadius,
        min: ROUNDED_CORNERS_MIN,
        max: roundedCornersMax,
        step: 0.1,
        write: makeSetPropertyWriteTarget(inlineTarget, "rounded corners")
      });
    }

    if (pathSupportsArrowTipEditing(element.commands)) {
      const arrowWrite = makeArrowTipWriteTarget(inlineTarget, element, snapshot.source);
      pathSection.properties.push({
        kind: "arrowTip",
        id: "arrow-tip-start",
        label: "Begin arrow type",
        side: "start",
        value: arrowPresetFromMarker(element.style.markerStart),
        options: ARROW_TIP_OPTIONS,
        previewLineWidth: element.style.lineWidth,
        write: arrowWrite
      });
      pathSection.properties.push({
        kind: "arrowTip",
        id: "arrow-tip-end",
        label: "End arrow type",
        side: "end",
        value: arrowPresetFromMarker(element.style.markerEnd),
        options: ARROW_TIP_OPTIONS,
        previewLineWidth: element.style.lineWidth,
        write: arrowWrite
      });
    }

    sections.splice(2, 0, pathSection);
  }

  if (element.kind === "Text") {
    sections.push({
      id: "text",
      title: "Text",
      sourceLevel: "command",
      properties: [
        {
          kind: "color",
          id: "text-color",
          label: "Color",
          value: textColor,
          syntaxValue: textColorSyntax,
          options: colorOptionsForValue(textColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "text")
        }
      ]
    });
  }

  return {
    elementKind: normalizeElementKind(element.kind),
    elementId: element.sourceId,
    writeTargetId: inlineTarget.targetId,
    readOnlyReason: inlineTarget.reason,
    sections
  };
}

function makeSetPropertyWriteTarget(
  inlineTarget: { targetId: string | null; writable: boolean; reason?: string },
  key: string
): SetPropertyWriteTarget {
  return {
    mode: "setProperty",
    elementId: inlineTarget.targetId ?? "",
    level: "command",
    key,
    writable: inlineTarget.writable && inlineTarget.targetId != null,
    reason: inlineTarget.reason
  };
}

function makeArrowTipWriteTarget(
  inlineTarget: { targetId: string | null; writable: boolean; reason?: string },
  element: Extract<SceneElement, { kind: "Path" }>,
  source: string
): ArrowTipWriteTarget {
  return {
    ...makeSetPropertyWriteTarget(inlineTarget, ARROW_OPTION_KEY),
    arrowContext: resolveArrowWriteContext(source, inlineTarget.targetId, element)
  };
}

function resolveArrowWriteContext(
  source: string,
  targetId: string | null,
  element: Extract<SceneElement, { kind: "Path" }>
): ArrowTipWriteContext {
  const clearKeySet = new Set<string>(ARROW_DEFAULT_CLEAR_KEYS);
  let startRaw = arrowMarkerFallbackRaw(element.style.markerStart, "start");
  let endRaw = arrowMarkerFallbackRaw(element.style.markerEnd, "end");

  if (!targetId) {
    return {
      startRaw,
      endRaw,
      clearKeys: [...clearKeySet]
    };
  }

  const resolved = resolvePropertyTarget(source, targetId);
  if (resolved.kind === "not-found" || !resolved.target.options) {
    return {
      startRaw,
      endRaw,
      clearKeys: [...clearKeySet]
    };
  }

  let lastParsed: { startRaw: string; endRaw: string } | null = null;
  for (const entry of resolved.target.options.entries) {
    if (entry.kind === "kv") {
      const entryKey = normalizeOptionKey(entry.key);
      if (entryKey !== ARROW_OPTION_KEY) {
        continue;
      }
      clearKeySet.add(entryKey);
      const parsed = splitArrowSpecificationRaw(entry.valueRaw);
      if (parsed) {
        lastParsed = parsed;
      }
      continue;
    }

    if (entry.kind !== "flag") {
      continue;
    }

    const parsed = splitArrowSpecificationRaw(entry.raw);
    if (!parsed) {
      continue;
    }
    clearKeySet.add(normalizeOptionKey(entry.key));
    lastParsed = parsed;
  }

  if (lastParsed) {
    startRaw = lastParsed.startRaw;
    endRaw = lastParsed.endRaw;
  }

  return {
    startRaw,
    endRaw,
    clearKeys: [...clearKeySet]
  };
}

function splitArrowSpecificationRaw(raw: string): { startRaw: string; endRaw: string } | null {
  const normalized = stripEnclosingBraces(raw.trim());
  const splitIndex = findTopLevelCharacter(normalized, "-");
  if (splitIndex < 0) {
    return null;
  }

  return {
    startRaw: normalized.slice(0, splitIndex).trim(),
    endRaw: normalized.slice(splitIndex + 1).trim()
  };
}

function resolvePathMorphingDecorationPreset(
  source: string,
  targetId: string | null,
  styleDecoration: { enabled: boolean; name: string | null }
): PathMorphingDecorationPresetId {
  const fallback = pathMorphingDecorationPresetFromStyle(styleDecoration);
  if (!targetId) {
    return fallback;
  }

  const resolved = resolvePropertyTarget(source, targetId);
  if (resolved.kind === "not-found" || !resolved.target.options) {
    return fallback;
  }

  let decorateEnabled = styleDecoration.enabled;
  let decorationName = canonicalDecorationName(styleDecoration.name);

  for (const entry of resolved.target.options.entries) {
    if (entry.kind === "flag") {
      const key = normalizeOptionKey(entry.key);
      if (key === "decorate" || key === "/tikz/decorate") {
        decorateEnabled = true;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    const key = normalizeOptionKey(entry.key);
    if (key === "decorate" || key === "/tikz/decorate") {
      const parsed = parseDecorationBoolean(entry.valueRaw);
      if (parsed != null) {
        decorateEnabled = parsed;
      }
      continue;
    }

    if (key === "decoration" || key === "/pgf/decoration") {
      const parsedName = parseDecorationNameFromOptionValue(entry.valueRaw);
      if (parsedName) {
        decorationName = parsedName;
      }
      continue;
    }

    if (key === "/pgf/decoration/name" || key === "/pgf/decorations/name" || key === "name") {
      const parsedName = canonicalDecorationName(stripEnclosingBraces(entry.valueRaw));
      if (parsedName) {
        decorationName = parsedName;
      }
    }
  }

  if (!decorateEnabled) {
    return "none";
  }
  if (!decorationName || decorationName === "none") {
    return "none";
  }

  const matching = PATH_MORPHING_DECORATION_OPTIONS.find((option) => option.value === decorationName);
  return matching ? matching.value : "custom";
}

function parseDecorationBoolean(raw: string): boolean | null {
  const normalized = stripEnclosingBraces(raw).trim().toLowerCase();
  if (normalized === "" || normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
    return false;
  }
  return null;
}

function parseDecorationNameFromOptionValue(valueRaw: string): string | null {
  const nested = parseStyleValueAsOptionList(valueRaw);
  if (nested) {
    for (const entry of nested.entries) {
      if (entry.kind === "kv") {
        const key = normalizeOptionKey(entry.key);
        if (key === "name" || key === "/pgf/decoration/name" || key === "/pgf/decorations/name") {
          return canonicalDecorationName(stripEnclosingBraces(entry.valueRaw));
        }
        continue;
      }
      if (entry.kind === "flag") {
        const key = normalizeOptionKey(entry.key);
        if (key === "decorate" || key === "mirror" || key === "path has corners" || key === "reverse path") {
          continue;
        }
        return canonicalDecorationName(entry.key);
      }
    }
  }

  const normalized = stripEnclosingBraces(valueRaw).trim();
  if (normalized.length === 0) {
    return null;
  }

  const firstComma = findTopLevelCharacter(normalized, ",");
  const firstPart = firstComma >= 0 ? normalized.slice(0, firstComma).trim() : normalized;
  const equalsIndex = findTopLevelCharacter(firstPart, "=");
  if (equalsIndex >= 0) {
    const key = normalizeOptionKey(firstPart.slice(0, equalsIndex));
    const valuePart = firstPart.slice(equalsIndex + 1);
    if (key === "name" || key === "/pgf/decoration/name" || key === "/pgf/decorations/name") {
      return canonicalDecorationName(stripEnclosingBraces(valuePart));
    }
    return null;
  }
  return canonicalDecorationName(firstPart);
}

function serializeArrowSides(startRaw: string, endRaw: string): { key: string; value: string } {
  const normalizedStart = startRaw.trim();
  const normalizedEnd = endRaw.trim();

  if (normalizedStart.length === 0 && normalizedEnd.length === 0) {
    return { key: "-", value: "true" };
  }
  if (normalizedStart.length === 0 && normalizedEnd === ">") {
    return { key: "->", value: "true" };
  }
  if (normalizedStart === "<" && normalizedEnd.length === 0) {
    return { key: "<-", value: "true" };
  }
  if (normalizedStart === "<" && normalizedEnd === ">") {
    return { key: "<->", value: "true" };
  }

  return {
    key: ARROW_OPTION_KEY,
    value: `${startRaw}-${endRaw}`
  };
}

function arrowPresetFromMarker(marker: ArrowMarker | null): ArrowTipPresetId {
  if (!marker || marker.tips.length === 0) {
    return "none";
  }
  if (marker.tips.length !== 1) {
    return "custom";
  }

  const tip = marker.tips[0];
  if (!tip) {
    return "none";
  }
  return arrowPresetFromKind(tip.kind);
}

function arrowPresetFromKind(kind: ArrowTipKind): ArrowTipPresetId {
  if (kind === "to" || kind === "cm-rightarrow") {
    return "arrow";
  }
  if (kind === "stealth") {
    return "stealth";
  }
  if (kind === "latex") {
    return "latex";
  }
  if (kind === "triangle") {
    return "triangle";
  }
  if (kind === "circle") {
    return "circle";
  }
  if (kind === "square") {
    return "square";
  }
  if (kind === "kite") {
    return "kite";
  }
  if (kind === "bar") {
    return "bar";
  }
  if (kind === "hooks") {
    return "hooks";
  }
  return "custom";
}

function arrowMarkerFallbackRaw(marker: ArrowMarker | null, side: ArrowTipSide): string {
  const preset = arrowPresetFromMarker(marker);
  if (preset !== "custom") {
    return arrowPresetSideRaw(preset, side);
  }
  if (!marker || marker.tips.length === 0) {
    return "";
  }

  return marker.tips.map((tip) => arrowKindCanonicalRaw(tip.kind, side)).join(" ");
}

function arrowKindCanonicalRaw(kind: ArrowTipKind, side: ArrowTipSide): string {
  if (kind === "to" || kind === "cm-rightarrow") {
    return side === "start" ? "<" : ">";
  }
  if (kind === "stealth") {
    return "Stealth";
  }
  if (kind === "latex") {
    return "Latex";
  }
  if (kind === "triangle") {
    return "Triangle";
  }
  if (kind === "circle") {
    return "Circle";
  }
  if (kind === "square") {
    return "Square";
  }
  if (kind === "kite") {
    return "Kite";
  }
  if (kind === "bar") {
    return "Bar";
  }
  if (kind === "hooks") {
    return "Hooks";
  }
  if (kind === "implies") {
    return "Implies";
  }
  if (kind === "straight-barb") {
    return "Straight Barb";
  }
  if (kind === "arc-barb") {
    return "Arc Barb";
  }
  if (kind === "tee-barb") {
    return "Tee Barb";
  }
  if (kind === "rays") {
    return "Rays";
  }
  if (kind === "round-cap") {
    return "Round Cap";
  }
  if (kind === "butt-cap") {
    return "Butt Cap";
  }
  if (kind === "triangle-cap") {
    return "Triangle Cap";
  }
  return "To";
}

function arrowPresetSideRaw(preset: Exclude<ArrowTipPresetId, "custom">, side: ArrowTipSide): string {
  if (preset === "none") {
    return "";
  }
  if (preset === "arrow") {
    return side === "start" ? "<" : ">";
  }
  if (preset === "stealth") {
    return "Stealth";
  }
  if (preset === "latex") {
    return "Latex";
  }
  if (preset === "triangle") {
    return "Triangle";
  }
  if (preset === "circle") {
    return "Circle";
  }
  if (preset === "square") {
    return "Square";
  }
  if (preset === "kite") {
    return "Kite";
  }
  if (preset === "bar") {
    return "Bar";
  }
  return "Hooks";
}

function resolveInlineWriteTarget(
  element: SceneElement,
  source: string
): { targetId: string | null; writable: boolean; reason?: string } {
  if (element.origin?.foreachStack && element.origin.foreachStack.length > 0) {
    return {
      targetId: null,
      writable: false,
      reason: "This element comes from a \\foreach expansion and is read-only in the Phase 2 inspector."
    };
  }

  if (element.origin?.macroStack && element.origin.macroStack.length > 0) {
    return {
      targetId: null,
      writable: false,
      reason: "This element comes from a macro expansion and is read-only in the Phase 2 inspector."
    };
  }

  const commandEntry = [...element.styleChain].reverse().find((entry) => entry.kind === "command");
  const targetId = commandEntry?.sourceRef?.sourceId ?? element.sourceId;
  const resolved = resolvePropertyTarget(source, targetId);

  if (resolved.kind === "not-found") {
    return {
      targetId,
      writable: false,
      reason: "Inline command options could not be resolved for this element."
    };
  }

  return { targetId, writable: true };
}

function resolveMoveWriteTarget(
  element: SceneElement,
  editHandles: EditHandle[] | undefined,
  metrics: { centerX: number; centerY: number }
): { x: MoveAxisWriteTarget; y: MoveAxisWriteTarget } {
  const hasHandle = (editHandles ?? []).some((handle) => handle.sourceId === element.sourceId);
  const foreachReadonly = element.origin?.foreachStack && element.origin.foreachStack.length > 0;
  const macroReadonly = element.origin?.macroStack && element.origin.macroStack.length > 0;

  let reason: string | undefined;
  if (foreachReadonly) {
    reason = "Position editing is disabled for foreach-expanded elements.";
  } else if (macroReadonly) {
    reason = "Position editing is disabled for macro-expanded elements.";
  } else if (!hasHandle) {
    reason = "No editable handles were found for this element.";
  }

  const writable = reason == null;
  return {
    x: {
      mode: "moveAxis",
      elementId: element.sourceId,
      axis: "x",
      baseX: metrics.centerX,
      baseY: metrics.centerY,
      writable,
      reason
    },
    y: {
      mode: "moveAxis",
      elementId: element.sourceId,
      axis: "y",
      baseX: metrics.centerX,
      baseY: metrics.centerY,
      writable,
      reason
    }
  };
}

function normalizeElementKind(kind: SceneElement["kind"]): InspectorDescriptor["elementKind"] {
  if (kind === "Path") return "path";
  if (kind === "Circle") return "circle";
  if (kind === "Ellipse") return "ellipse";
  return "text";
}

function pathSupportsArrowTipEditing(commands: ScenePathCommand[]): boolean {
  // PGF only applies path arrow tips to open paths with endpoints.
  if (commands.some((command) => command.kind === "Z")) {
    return false;
  }
  return commands.some((command) => command.kind === "L" || command.kind === "C" || command.kind === "A");
}

function pathSupportsFillEditing(commands: ScenePathCommand[]): boolean {
  type OpenSubpathState = {
    hasCurveOrArc: boolean;
    segmentCount: number;
    points: Array<{ x: number; y: number }>;
  };

  const POLYGON_AREA_EPSILON = 1e-9;
  let subpath: OpenSubpathState | null = null;

  const flushOpenSubpath = (): boolean => {
    if (!subpath) {
      return false;
    }
    if (subpath.hasCurveOrArc && subpath.segmentCount >= 1) {
      return true;
    }
    if (subpath.segmentCount < 2) {
      return false;
    }
    return Math.abs(polygonSignedArea(subpath.points)) > POLYGON_AREA_EPSILON;
  };

  for (const command of commands) {
    if (command.kind === "M") {
      if (flushOpenSubpath()) {
        return true;
      }
      subpath = {
        hasCurveOrArc: false,
        segmentCount: 0,
        points: [command.to]
      };
      continue;
    }

    if (command.kind === "Z") {
      return true;
    }

    if (!subpath) {
      continue;
    }

    if (command.kind === "L") {
      subpath.segmentCount += 1;
      subpath.points.push(command.to);
      continue;
    }

    if (command.kind === "C" || command.kind === "A") {
      subpath.hasCurveOrArc = true;
      subpath.segmentCount += 1;
      subpath.points.push(command.to);
    }
  }

  return flushOpenSubpath();
}

function polygonSignedArea(points: readonly Array<{ x: number; y: number }>): number {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) {
      continue;
    }
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function computeElementMetrics(element: SceneElement): {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
} {
  if (element.kind === "Circle") {
    return {
      centerX: element.center.x,
      centerY: element.center.y,
      width: element.radius * 2,
      height: element.radius * 2
    };
  }

  if (element.kind === "Ellipse") {
    return {
      centerX: element.center.x,
      centerY: element.center.y,
      width: element.rx * 2,
      height: element.ry * 2
    };
  }

  if (element.kind === "Text") {
    return {
      centerX: element.position.x,
      centerY: element.position.y,
      width: element.textBlockWidth ?? 0,
      height: element.textBlockHeight ?? 0
    };
  }

  const bounds = pathBounds(element.commands);
  return {
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY
  };
}

function pathBounds(commands: ScenePathCommand[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const points: Array<{ x: number; y: number }> = [];
  for (const command of commands) {
    if (command.kind === "M" || command.kind === "L" || command.kind === "A") {
      points.push(command.to);
      continue;
    }
    if (command.kind === "C") {
      points.push(command.c1, command.c2, command.to);
    }
  }

  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

function lineWidthPresetLabel(value: number): string | null {
  for (const preset of LINE_WIDTH_PRESETS) {
    if (Math.abs(preset.value - value) <= 0.02) {
      return preset.label;
    }
  }
  return null;
}

function dashStylePresetFromStyle(dashArray: number[] | null, lineWidth: number): DashStylePresetId {
  if (!dashArray || dashArray.length === 0) {
    return "solid";
  }
  if (dashArray.length !== 2) {
    return "custom";
  }
  const [first, second] = dashArray;
  if (first == null || second == null) {
    return "custom";
  }
  if (closeEnough(first, 3) && closeEnough(second, 3)) {
    return "dashed";
  }
  if (closeEnough(first, 4) && closeEnough(second, 2)) {
    return "densely dashed";
  }
  if (closeEnough(first, 6) && closeEnough(second, 4)) {
    return "loosely dashed";
  }
  if (closeEnough(first, lineWidth) && closeEnough(second, 2)) {
    return "dotted";
  }
  if (closeEnough(first, lineWidth) && closeEnough(second, 1)) {
    return "densely dotted";
  }
  if (closeEnough(first, lineWidth) && closeEnough(second, 4)) {
    return "loosely dotted";
  }
  return "custom";
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= DASH_PATTERN_EPSILON;
}

function lineCapPresetFromStyle(value: "butt" | "round" | "square"): LineCapPresetId {
  if (value === "butt" || value === "round" || value === "square") {
    return value;
  }
  return "custom";
}

function lineJoinPresetFromStyle(value: "miter" | "round" | "bevel"): LineJoinPresetId {
  if (value === "miter" || value === "round" || value === "bevel") {
    return value;
  }
  return "custom";
}

function pathMorphingDecorationPresetFromStyle(style: {
  enabled: boolean;
  name: string | null;
}): PathMorphingDecorationPresetId {
  if (!style.enabled) {
    return "none";
  }
  const canonicalName = canonicalDecorationName(style.name);
  if (!canonicalName || canonicalName === "none") {
    return "none";
  }

  const matching = PATH_MORPHING_DECORATION_OPTIONS.find((option) => option.value === canonicalName);
  return matching ? matching.value : "custom";
}

function computePathStrokeControlVisibility(
  commands: ScenePathCommand[],
  dashArray: number[] | null
): { showLineCap: boolean; showLineJoin: boolean } {
  const hasDash = !!dashArray && dashArray.length > 0;
  let openSubpathHasSegments = false;
  let hasJoin = false;
  let segmentCountInSubpath = 0;

  for (const command of commands) {
    if (command.kind === "M") {
      if (segmentCountInSubpath >= 1) {
        openSubpathHasSegments = true;
      }
      if (segmentCountInSubpath >= 2) {
        hasJoin = true;
      }
      segmentCountInSubpath = 0;
      continue;
    }

    if (command.kind === "L" || command.kind === "C" || command.kind === "A") {
      segmentCountInSubpath += 1;
      if (segmentCountInSubpath >= 2) {
        hasJoin = true;
      }
      continue;
    }

    if (command.kind === "Z") {
      if (segmentCountInSubpath >= 1) {
        hasJoin = true;
      }
      segmentCountInSubpath = 0;
    }
  }

  if (segmentCountInSubpath >= 1) {
    openSubpathHasSegments = true;
  }
  if (segmentCountInSubpath >= 2) {
    hasJoin = true;
  }

  return {
    showLineCap: hasDash || openSubpathHasSegments,
    showLineJoin: hasJoin
  };
}

function normalizeInspectorColorValue(value: string | null): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized in HEX_TO_NAMED_COLOR) {
    return HEX_TO_NAMED_COLOR[normalized];
  }
  return normalized;
}

function resolveColorSyntaxValue(
  source: string,
  targetId: string | null,
  keys: readonly string[],
  currentValue: string | null,
  colorAliases: ReadonlyMap<string, string>
): string | null {
  if (!targetId) {
    return null;
  }

  const normalizedKeys = new Set(keys.map((key) => normalizeOptionKey(key)));
  if (normalizedKeys.size === 0) {
    return null;
  }

  const resolved = resolvePropertyTarget(source, targetId);
  if (resolved.kind === "not-found" || !resolved.target.options) {
    return null;
  }

  let colorValue: string | null = null;
  for (const entry of resolved.target.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    const entryKey = normalizeOptionKey(entry.key);
    if (!normalizedKeys.has(entryKey)) {
      continue;
    }
    const rawValue = stripEnclosingBraces(entry.valueRaw.trim());
    if (rawValue.length === 0) {
      continue;
    }
    colorValue = rawValue;
  }
  if (colorValue != null) {
    return colorValue;
  }

  const normalizedCurrentValue = normalizeInspectorColorValue(currentValue);
  if (!normalizedCurrentValue) {
    return null;
  }

  const resolveAlias = (rawColorName: string): string | null => {
    const normalized = rawColorName.trim().toLowerCase();
    if (normalized.length === 0) {
      return null;
    }
    return colorAliases.get(normalized) ?? null;
  };

  for (const entry of resolved.target.options.entries) {
    if (entry.kind !== "flag") {
      continue;
    }

    const rawToken = stripEnclosingBraces(entry.raw.trim());
    if (rawToken.length === 0) {
      continue;
    }

    const normalizedRawToken = rawToken.toLowerCase();
    const resolvedToken = normalizeColor(normalizedRawToken, {
      resolveAlias
    });
    const normalizedResolved = normalizeInspectorColorValue(resolvedToken);
    if (normalizedResolved === normalizedCurrentValue) {
      colorValue = rawToken;
    }
  }

  return colorValue;
}

function collectInspectorColorAliases(source: string): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  let cursor = 0;

  while (cursor < source.length) {
    const colorletIndex = source.indexOf("\\colorlet", cursor);
    const defineColorIndex = source.indexOf("\\definecolor", cursor);
    const nextColorlet = colorletIndex >= 0 ? colorletIndex : Number.POSITIVE_INFINITY;
    const nextDefineColor = defineColorIndex >= 0 ? defineColorIndex : Number.POSITIVE_INFINITY;
    const nextIndex = Math.min(nextColorlet, nextDefineColor);

    if (!Number.isFinite(nextIndex)) {
      break;
    }

    if (nextIndex === nextColorlet) {
      const parsed = parseInspectorColorletStatement(source, nextIndex);
      if (parsed) {
        aliases.set(parsed.name, parsed.value);
        cursor = parsed.nextIndex;
        continue;
      }
      cursor = nextIndex + 1;
      continue;
    }

    const parsed = parseInspectorDefineColorStatement(source, nextIndex);
    if (parsed) {
      aliases.set(parsed.name, parsed.value);
      cursor = parsed.nextIndex;
      continue;
    }
    cursor = nextIndex + 1;
  }

  return aliases;
}

function parseInspectorColorletStatement(
  source: string,
  startIndex: number
): { name: string; value: string; nextIndex: number } | null {
  let cursor = startIndex + "\\colorlet".length;
  const nameGroup = readInspectorBraceGroup(source, cursor);
  if (!nameGroup) {
    return null;
  }
  cursor = nameGroup.nextIndex;

  const valueGroup = readInspectorBraceGroup(source, cursor);
  if (!valueGroup) {
    return null;
  }
  cursor = valueGroup.nextIndex;

  const normalizedName = normalizeInspectorDeclaredColorName(nameGroup.value);
  if (!normalizedName) {
    return null;
  }
  if (valueGroup.value.length === 0) {
    return null;
  }

  return {
    name: normalizedName,
    value: valueGroup.value,
    nextIndex: cursor
  };
}

function parseInspectorDefineColorStatement(
  source: string,
  startIndex: number
): { name: string; value: string; nextIndex: number } | null {
  let cursor = startIndex + "\\definecolor".length;
  const nameGroup = readInspectorBraceGroup(source, cursor);
  if (!nameGroup) {
    return null;
  }
  cursor = nameGroup.nextIndex;

  const modelGroup = readInspectorBraceGroup(source, cursor);
  if (!modelGroup) {
    return null;
  }
  cursor = modelGroup.nextIndex;

  const specificationGroup = readInspectorBraceGroup(source, cursor);
  if (!specificationGroup) {
    return null;
  }
  cursor = specificationGroup.nextIndex;

  const normalizedName = normalizeInspectorDeclaredColorName(nameGroup.value);
  if (!normalizedName) {
    return null;
  }

  const resolved = resolveDefineColorModel(modelGroup.value, specificationGroup.value);
  if (!resolved) {
    return null;
  }

  return {
    name: normalizedName,
    value: resolved.toLowerCase(),
    nextIndex: cursor
  };
}

function readInspectorBraceGroup(
  source: string,
  startIndex: number
): { value: string; nextIndex: number } | null {
  const cursor = skipInspectorWhitespace(source, startIndex);
  if (cursor >= source.length || source[cursor] !== "{") {
    return null;
  }

  const block = readBalancedBlock(source, cursor, "{", "}");
  if (!block) {
    return null;
  }

  return {
    value: block.content.trim(),
    nextIndex: block.nextIndex
  };
}

function normalizeInspectorDeclaredColorName(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._:@-]*$/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function skipInspectorWhitespace(source: string, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < source.length && /\s/u.test(source[cursor]!)) {
    cursor += 1;
  }
  return cursor;
}

function colorOptionsForValue(value: string | null): string[] {
  if (!value) {
    return COLOR_OPTIONS;
  }
  if (COLOR_OPTIONS.includes(value)) {
    return COLOR_OPTIONS;
  }
  return [value, ...COLOR_OPTIONS];
}

function normalizeOptionKey(key: string): string {
  return key.trim().toLowerCase();
}

function canonicalDecorationName(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function formatInspectorLength(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const normalized = Math.abs(rounded) < 1e-9 ? 0 : rounded;
  return Number(normalized.toFixed(2)).toString();
}

function computePathRoundedCornersMax(commands: ScenePathCommand[]): number | null {
  const lineBased = computeLineBasedPathRoundedCornersMax(commands);
  if (lineBased != null) {
    return lineBased;
  }
  return computeGenericPathRoundedCornersMax(commands);
}

function computeLineBasedPathRoundedCornersMax(commands: ScenePathCommand[]): number | null {
  type LineSegment = {
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
    startOffset: number;
    endOffset: number;
  };

  const EPSILON = 1e-9;
  const subpaths: Array<{ lengths: number[]; closed: boolean }> = [];
  let current: { x: number; y: number } | null = null;
  let segments: LineSegment[] = [];

  const flushSubpath = (closed: boolean, closingIndex?: number): void => {
    if (segments.length === 0) {
      segments = [];
      current = null;
      return;
    }

    if (closed && closingIndex != null) {
      const first = segments[0];
      if (first) {
        const startOffset = estimateClosingCornerStartOffset(commands, closingIndex, first.start, first.end);
        if (startOffset > EPSILON && first.startOffset <= EPSILON) {
          first.startOffset = startOffset;
          first.length = pointDistance(first.start, first.end) + first.startOffset + first.endOffset;
        }
      }
    }

    const lengths = segments
      .map((segment) => segment.length)
      .filter((length) => Number.isFinite(length) && length > EPSILON);
    if (lengths.length > 0) {
      subpaths.push({ lengths, closed });
    }

    segments = [];
    current = null;
  };

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    if (command.kind === "M") {
      flushSubpath(false);
      current = command.to;
      continue;
    }

    if (command.kind === "L") {
      if (!current) {
        current = command.to;
        continue;
      }
      const measured = pointDistance(current, command.to);
      const previous = index > 0 ? commands[index - 1] : undefined;
      const next = index + 1 < commands.length ? commands[index + 1] : undefined;
      const startOffset = estimateSegmentStartRoundedOffset(previous, current, command.to);
      const endOffset = estimateSegmentEndRoundedOffset(next, current, command.to);
      const length = measured + startOffset + endOffset;

      if (Number.isFinite(length) && length > EPSILON) {
        segments.push({
          start: current,
          end: command.to,
          length,
          startOffset,
          endOffset
        });
      }
      current = command.to;
      continue;
    }

    if (command.kind === "C" || command.kind === "A") {
      current = command.to;
      continue;
    }

    if (command.kind === "Z") {
      flushSubpath(true, index);
    }
  }
  flushSubpath(false);

  let globalMax: number | null = null;
  for (const subpath of subpaths) {
    const candidate = maxRoundedCornersForSubpath(subpath.lengths, subpath.closed);
    if (candidate == null) {
      continue;
    }
    globalMax = globalMax == null ? candidate : Math.min(globalMax, candidate);
  }

  return globalMax;
}

function computeGenericPathRoundedCornersMax(commands: ScenePathCommand[]): number | null {
  const subpaths: Array<{ lengths: number[]; closed: boolean }> = [];
  const EPSILON = 1e-9;
  let start: { x: number; y: number } | null = null;
  let current: { x: number; y: number } | null = null;
  let lengths: number[] = [];

  const flushOpenSubpath = (): void => {
    if (lengths.length > 0) {
      subpaths.push({ lengths, closed: false });
    }
    lengths = [];
    start = null;
    current = null;
  };

  for (const command of commands) {
    if (command.kind === "M") {
      flushOpenSubpath();
      start = command.to;
      current = command.to;
      continue;
    }

    if (command.kind === "L" || command.kind === "C" || command.kind === "A") {
      if (current) {
        const length = pointDistance(current, command.to);
        if (Number.isFinite(length) && length > EPSILON) {
          lengths.push(length);
        }
      }
      current = command.to;
      continue;
    }

    if (command.kind === "Z") {
      if (current && start) {
        const closingLength = pointDistance(current, start);
        if (Number.isFinite(closingLength) && closingLength > EPSILON) {
          lengths.push(closingLength);
        }
      }
      if (lengths.length > 0) {
        subpaths.push({ lengths, closed: true });
      }
      lengths = [];
      start = null;
      current = null;
    }
  }
  flushOpenSubpath();

  let globalMax: number | null = null;
  for (const subpath of subpaths) {
    const candidate = maxRoundedCornersForSubpath(subpath.lengths, subpath.closed);
    if (candidate == null) {
      continue;
    }
    globalMax = globalMax == null ? candidate : Math.min(globalMax, candidate);
  }

  return globalMax;
}

function estimateSegmentStartRoundedOffset(
  previous: ScenePathCommand | undefined,
  start: { x: number; y: number },
  end: { x: number; y: number }
): number {
  if (!previous || previous.kind !== "C") {
    return 0;
  }
  const direction = normalizeVector({ x: end.x - start.x, y: end.y - start.y });
  if (!direction) {
    return 0;
  }
  return estimateRoundedOffsetAlongDirection(
    {
      x: start.x - previous.c2.x,
      y: start.y - previous.c2.y
    },
    direction
  );
}

function estimateSegmentEndRoundedOffset(
  next: ScenePathCommand | undefined,
  start: { x: number; y: number },
  end: { x: number; y: number }
): number {
  if (!next || next.kind !== "C") {
    return 0;
  }
  const direction = normalizeVector({ x: end.x - start.x, y: end.y - start.y });
  if (!direction) {
    return 0;
  }
  return estimateRoundedOffsetAlongDirection(
    {
      x: next.c1.x - end.x,
      y: next.c1.y - end.y
    },
    direction
  );
}

function estimateClosingCornerStartOffset(
  commands: readonly ScenePathCommand[],
  closingIndex: number,
  start: { x: number; y: number },
  end: { x: number; y: number }
): number {
  const previous = closingIndex > 0 ? commands[closingIndex - 1] : undefined;
  if (!previous || previous.kind !== "C") {
    return 0;
  }
  if (pointDistance(previous.to, start) > 1e-6) {
    return 0;
  }
  return estimateSegmentStartRoundedOffset(previous, start, end);
}

function estimateRoundedOffsetAlongDirection(
  vector: { x: number; y: number },
  direction: { x: number; y: number }
): number {
  const KAPPA = 0.5522847;
  const EPSILON = 1e-9;
  const vectorLength = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(vectorLength) || vectorLength <= EPSILON) {
    return 0;
  }

  const parallel = vector.x * direction.x + vector.y * direction.y;
  if (!Number.isFinite(parallel) || parallel <= EPSILON) {
    return 0;
  }

  const alignment = parallel / vectorLength;
  if (!Number.isFinite(alignment) || alignment < 0.9) {
    return 0;
  }

  const offset = parallel / KAPPA;
  if (!Number.isFinite(offset) || offset <= EPSILON) {
    return 0;
  }
  return offset;
}

function normalizeVector(vector: { x: number; y: number }): { x: number; y: number } | null {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length <= 1e-9) {
    return null;
  }
  return { x: vector.x / length, y: vector.y / length };
}

function maxRoundedCornersForSubpath(lengths: readonly number[], closed: boolean): number | null {
  if (lengths.length < 2) {
    return null;
  }

  let max = Number.POSITIVE_INFINITY;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (!Number.isFinite(length) || length <= 1e-9) {
      continue;
    }

    const hasCornersOnBothEnds = closed || (index > 0 && index < lengths.length - 1);
    const limit = hasCornersOnBothEnds ? length / 2 : length;
    max = Math.min(max, limit);
  }

  if (!Number.isFinite(max) || max <= 1e-9) {
    return null;
  }

  return max;
}

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeRoundedCornersMax(value: number | null): number {
  if (!Number.isFinite(value) || value == null) {
    return ROUNDED_CORNERS_FALLBACK_MAX;
  }
  return Math.max(ROUNDED_CORNERS_MIN, Math.round(value * 100) / 100);
}

function clampRoundedCornersRadius(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return Math.min(ROUNDED_CORNERS_DEFAULT_RADIUS, max);
  }
  return Math.max(ROUNDED_CORNERS_MIN, Math.min(max, value));
}
