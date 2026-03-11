import type { StyleLevel } from "./actions.js";
import { resolvePropertyTarget } from "./property-target.js";
import type { EditParseOptions } from "./parse-options.js";
import {
  collectInspectorColorAliases,
  colorOptionsForValue,
  normalizeInspectorColorValue,
  resolveColorSyntaxValue
} from "./inspector/color-syntax.js";
import { normalizeOptionKey } from "./option-key.js";
import {
  clampRoundedCornersRadius,
  computePathRoundedCornersMax,
  normalizeRoundedCornersMax,
  pathHasRoundableCorner
} from "./inspector/rounded-corners.js";
import { parseTikz } from "../parser/index.js";
import type { PathItem, PathStatement, Statement } from "../ast/types.js";
import {
  findTopLevelCharacter,
  parseFontStyle,
  parseStyleValueAsOptionList,
  stripEnclosingBraces
} from "../semantic/style/option-utils.js";
import { parseCoordinateLike, parseLength } from "../semantic/coords/parse-length.js";
import { DEFAULT_TEXT_FONT_SIZE } from "../semantic/style/constants.js";
import { CM_PER_PT } from "./format.js";
import {
  ARROW_DEFAULT_CLEAR_KEYS,
  ARROW_OPTION_KEY,
  ARROW_TIP_OPTIONS,
  AXIS_SHADING_CONFLICT_CLEAR_KEYS,
  BALL_SHADING_CONFLICT_CLEAR_KEYS,
  CURATED_NODE_SHAPE_SET,
  DASH_PATTERN_EPSILON,
  DASH_STYLE_OPTIONS,
  DASH_STYLE_PRESET_CLEAR_KEYS,
  DEFAULT_META_PATTERN_DISTANCE,
  DEFAULT_META_PATTERN_RADIUS,
  DEFAULT_META_PATTERN_STARS_DISTANCE,
  DEFAULT_META_PATTERN_STARS_RADIUS,
  FILL_MODE_OPTIONS,
  FILL_PATTERN_CLEAR_KEYS,
  FILL_PATTERN_OPTIONS,
  FILL_PATTERN_PRESET_BY_LOWER,
  FILL_SHADING_CLEAR_KEYS,
  FILL_SHADING_OPTIONS,
  FILL_STYLE_CUSTOM_NOTE,
  LINE_CAP_OPTIONS,
  LINE_JOIN_OPTIONS,
  LINE_WIDTH_PRESETS,
  META_FILL_PATTERN_PRESET_BY_KIND,
  META_FILL_PATTERN_PRESET_BY_LOWER,
  META_FILL_PATTERN_PRESETS,
  NODE_FONT_CUSTOM_NOTE,
  NODE_FONT_FAMILY_COMMAND,
  NODE_FONT_KEYS,
  NODE_FONT_PRESET_BY_ID,
  NODE_FONT_SIZE_EPSILON,
  NODE_FONT_SIZE_PRESETS,
  NODE_FONT_STYLE_COMMAND,
  NODE_FONT_WEIGHT_COMMAND,
  NODE_INNER_SEP_CLEAR_KEYS,
  NODE_INNER_SEP_CONFLICT_NOTE,
  NODE_INNER_SEP_DEFAULT,
  NODE_SHAPE_CUSTOM_NOTE,
  NODE_SHAPE_KEY,
  NODE_SHAPE_KNOWN_KEYS,
  NODE_SHAPE_KNOWN_SET,
  NODE_SHAPE_OPTIONS,
  PATH_MORPHING_DECORATION_CLEAR_KEYS,
  PATH_MORPHING_DECORATION_OPTIONS,
  PATH_MORPHING_DECORATION_SUBOPTIONS_BY_PRESET,
  PATH_MORPHING_DECORATION_SUBOPTION_SPECS,
  RADIAL_SHADING_CONFLICT_CLEAR_KEYS,
  ROUNDED_CORNERS_CLEAR_KEYS,
  ROUNDED_CORNERS_DEFAULT_RADIUS,
  SHADING_ACTIVATION_KEYS
} from "./inspector/presets.js";
import {
  ADORNMENT_ANGLE_PROPERTY_KEY,
  ADORNMENT_DISTANCE_PROPERTY_KEY,
  ADORNMENT_TEXT_PROPERTY_KEY,
  PIN_EDGE_DRAW_PROPERTY_KEY,
  PIN_EDGE_LINE_WIDTH_PROPERTY_KEY
} from "./adornment-keys.js";
import type {
  ArrowTipPresetId,
  ArrowTipPresetOption,
  ArrowTipSide,
  DashStylePresetId,
  DashStylePresetOption,
  FillModePresetId,
  FillModePresetOption,
  FillPatternMetaFamilyId,
  FillPatternMetaOptionKey,
  FillPatternMetaValues,
  FillPatternPresetId,
  FillPatternPresetOption,
  FillShadingPresetId,
  FillShadingPresetOption,
  LineCapPresetId,
  LineCapPresetOption,
  LineJoinPresetId,
  LineJoinPresetOption,
  NodeFontFamilyId,
  NodeFontSizePresetId,
  NodeFontSizePresetOption,
  NodeShapePresetId,
  NodeShapePresetOption,
  PathMorphingDecorationPresetId,
  PathMorphingDecorationPresetOption,
  PathMorphingDecorationSuboptionKey,
  PathMorphingDecorationSuboptionSpec
} from "./inspector/presets.js";
import type {
  ArrowMarker,
  ArrowTipKind,
  EditHandle,
  ResolvedStyle,
  ResolvedPattern,
  SceneElement,
  ScenePathCommand
} from "../semantic/types.js";
import { parseBooleanishNormalized } from "../utils/booleanish.js";
export { TIKZPICTURE_GLOBAL_TARGET_ID } from "./property-target.js";
export type {
  ArrowTipPresetId,
  ArrowTipPresetOption,
  ArrowTipSide,
  DashStylePresetId,
  DashStylePresetOption,
  FillModePresetId,
  FillModePresetOption,
  FillPatternMetaFamilyId,
  FillPatternMetaOptionKey,
  FillPatternMetaValues,
  FillPatternPresetId,
  FillPatternPresetOption,
  FillShadingPresetId,
  FillShadingPresetOption,
  LineCapPresetId,
  LineCapPresetOption,
  LineJoinPresetId,
  LineJoinPresetOption,
  NodeFontFamilyId,
  NodeFontSizePresetId,
  NodeFontSizePresetOption,
  NodeShapePresetId,
  NodeShapePresetOption,
  PathMorphingDecorationPresetId,
  PathMorphingDecorationPresetOption
} from "./inspector/presets.js";
export {
  DASH_STYLE_OPTIONS,
  FILL_MODE_OPTIONS,
  FILL_PATTERN_OPTIONS,
  FILL_SHADING_OPTIONS,
  LINE_CAP_OPTIONS,
  LINE_JOIN_OPTIONS,
  LINE_WIDTH_PRESETS,
  NODE_INNER_SEP_DEFAULT,
  NODE_SHAPE_OPTIONS,
  ROUNDED_CORNERS_DEFAULT_RADIUS
} from "./inspector/presets.js";

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

export type FillModeMutationContext = {
  fillColor: string | null;
  patternColor: string | null;
  shading: FillShadingPresetId;
  pattern: FillPatternPresetId;
};

export type FillModeSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type FillShadingSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type FillPatternSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type FillPatternOptionMutationContext = {
  family: FillPatternMetaFamilyId;
  values: FillPatternMetaValues;
};

export type FillPatternOptionSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type NodeShapeSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type NodeInnerSepSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type NodeFontMutationContext = {
  key: "font" | "node font";
  clearKeys: string[];
  fallbackCustomSizePt: number;
};

export type NodeFontSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type TransformInspectorKey = "xshift" | "yshift" | "xscale" | "yscale" | "rotate";

export type TransformInspectorValues = {
  xshift: number;
  yshift: number;
  xscale: number;
  yscale: number;
  rotate: number;
};

export type TransformSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type InspectorSnapshot = {
  source: string;
  editHandles?: EditHandle[];
  parseOptions?: EditParseOptions;
};

export type SetPropertyWriteTarget = {
  mode: "setProperty";
  elementId: string;
  level: StyleLevel;
  key: string;
  transformContext?: {
    key: TransformInspectorKey;
    values: TransformInspectorValues;
  };
  writable: boolean;
  reason?: string;
};

export type InspectorProperty =
  | {
      kind: "text";
      id: string;
      label: string;
      value: string;
      write: SetPropertyWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "number";
      id: string;
      label: string;
      value: number;
      step: number;
      unit?: string;
      clearKeys?: string[];
      write?: SetPropertyWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "length";
      id: string;
      label: string;
      value: number;
      step: number;
      unit: "pt";
      write: SetPropertyWriteTarget;
      note?: string;
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
      kind: "fillMode";
      id: string;
      label: string;
      value: FillModePresetId;
      options: FillModePresetOption[];
      context: FillModeMutationContext;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "fillShading";
      id: string;
      label: string;
      value: FillShadingPresetId;
      options: FillShadingPresetOption[];
      write: SetPropertyWriteTarget;
      note?: string;
    }
  | {
      kind: "fillPattern";
      id: string;
      label: string;
      value: FillPatternPresetId;
      options: FillPatternPresetOption[];
      write: SetPropertyWriteTarget;
      note?: string;
    }
  | {
      kind: "nodeShape";
      id: string;
      label: string;
      value: NodeShapePresetId;
      options: NodeShapePresetOption[];
      write: SetPropertyWriteTarget;
      note?: string;
    }
  | {
      kind: "nodeFont";
      id: string;
      label: string;
      family: NodeFontFamilyId;
      weight: "normal" | "bold";
      style: "normal" | "italic";
      sizePreset: NodeFontSizePresetId;
      customSizePt: number | null;
      sizeOptions: NodeFontSizePresetOption[];
      context: NodeFontMutationContext;
      write: SetPropertyWriteTarget;
      note?: string;
    }
  | {
      kind: "fillPatternOption";
      id: string;
      label: string;
      option: FillPatternMetaOptionKey;
      value: number;
      step: number;
      unit?: string;
      context: FillPatternOptionMutationContext;
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

const ROUNDED_CORNERS_MIN = 0.1;
const DEFAULT_TRANSFORM_INSPECTOR_VALUES: TransformInspectorValues = {
  xshift: 0,
  yshift: 0,
  xscale: 1,
  yscale: 1,
  rotate: 0
};
const SHIFT_CLEAR_KEYS = ["shift", "/tikz/shift"] as const;
const SCALE_CLEAR_KEYS = ["scale", "/tikz/scale"] as const;
const ROTATE_CLEAR_KEYS = ["/tikz/rotate"] as const;
const GRID_DEFAULT_STEP_CM = 1;
const GRID_STEP_CLEAR_KEYS = ["xstep", "x step", "ystep", "y step"] as const;
const GRID_XSTEP_CLEAR_KEYS = ["x step"] as const;
const GRID_YSTEP_CLEAR_KEYS = ["y step"] as const;
const TRANSFORM_KEY_ALIAS_CLEAR_KEYS: Record<TransformInspectorKey, readonly string[]> = {
  xshift: ["/tikz/xshift"],
  yshift: ["/tikz/yshift"],
  xscale: ["/tikz/xscale"],
  yscale: ["/tikz/yscale"],
  rotate: ["/tikz/rotate"]
};

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

export function buildFillModeSetPropertyMutations(
  value: Exclude<FillModePresetId, "custom">,
  context: Partial<FillModeMutationContext> = {}
): FillModeSetPropertyMutation[] {
  const fillColor = normalizeFillMutationColor(context.fillColor, "black");
  const patternColor = normalizeFillMutationColor(context.patternColor, "black");
  const nextShading = selectCuratedShadingPreset(context.shading);
  const nextPattern = selectCuratedPatternPreset(context.pattern);

  if (value === "solid") {
    return [
      {
        key: "fill",
        value: fillColor,
        clearKeys: uniqueStrings([...FILL_PATTERN_CLEAR_KEYS, ...FILL_SHADING_CLEAR_KEYS])
      }
    ];
  }

  if (value === "gradient") {
    const clearKeys = uniqueStrings(FILL_PATTERN_CLEAR_KEYS);
    return [
      {
        key: "shade",
        value: "true",
        clearKeys
      },
      {
        key: "shading",
        value: nextShading,
        clearKeys
      }
    ];
  }

  const clearKeys = uniqueStrings(FILL_SHADING_CLEAR_KEYS);
  return [
    {
      key: "pattern",
      value: nextPattern,
      clearKeys
    },
    {
      key: "pattern color",
      value: patternColor,
      clearKeys
    }
  ];
}

export function buildFillShadingSetPropertyMutations(
  value: Exclude<FillShadingPresetId, "custom">
): FillShadingSetPropertyMutation[] {
  const conflictClearKeys = uniqueStrings(
    value === "axis"
      ? AXIS_SHADING_CONFLICT_CLEAR_KEYS
      : value === "radial"
        ? RADIAL_SHADING_CONFLICT_CLEAR_KEYS
        : BALL_SHADING_CONFLICT_CLEAR_KEYS
  );

  return [
    {
      key: "shade",
      value: "true",
      clearKeys: []
    },
    {
      key: "shading",
      value,
      clearKeys: conflictClearKeys
    }
  ];
}

export function buildFillPatternSetPropertyMutation(
  value: Exclude<FillPatternPresetId, "custom">
): FillPatternSetPropertyMutation {
  return {
    key: "pattern",
    value,
    clearKeys: []
  };
}

export function buildFillPatternOptionSetPropertyMutation(
  context: FillPatternOptionMutationContext,
  option: FillPatternMetaOptionKey,
  value: number
): FillPatternOptionSetPropertyMutation {
  const nextValues = {
    ...context.values,
    [fillPatternMetaValueKey(option)]: sanitizeFillPatternMetaOptionValue(option, value, context.values)
  };

  return {
    key: "pattern",
    value: serializeFillPatternMetaPattern(context.family, nextValues),
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

export function buildNodeShapeSetPropertyMutation(
  value: Exclude<NodeShapePresetId, "custom">
): NodeShapeSetPropertyMutation {
  return {
    key: NODE_SHAPE_KEY,
    value,
    clearKeys: uniqueStrings([...NODE_SHAPE_KNOWN_KEYS])
  };
}

export function buildNodeInnerSepSetPropertyMutation(value: number): NodeInnerSepSetPropertyMutation {
  const safe = Number.isFinite(value) && value >= 0 ? value : NODE_INNER_SEP_DEFAULT;
  return {
    key: "inner sep",
    value: `${formatInspectorLength(safe)}pt`,
    clearKeys: uniqueStrings([...NODE_INNER_SEP_CLEAR_KEYS])
  };
}

export function buildNodeFontSetPropertyMutation(
  context: NodeFontMutationContext,
  values: {
    family: NodeFontFamilyId;
    weight: "normal" | "bold";
    style: "normal" | "italic";
    sizePreset: NodeFontSizePresetId;
    customSizePt: number | null;
  }
): NodeFontSetPropertyMutation {
  const preset = values.sizePreset === "custom" ? null : NODE_FONT_PRESET_BY_ID.get(values.sizePreset);
  const safeCustomSize =
    Number.isFinite(values.customSizePt) && (values.customSizePt ?? 0) > 0
      ? (values.customSizePt as number)
      : context.fallbackCustomSizePt;
  const commandParts: string[] = [];

  if (preset != null) {
    if (preset.value !== "normalsize") {
      commandParts.push(preset.command);
    }
  } else {
    commandParts.push(
      `\\fontsize{${formatInspectorLength(safeCustomSize)}pt}{${formatInspectorLength(safeCustomSize * 1.2)}pt}\\selectfont`
    );
  }

  if (values.family !== "serif") {
    commandParts.push(NODE_FONT_FAMILY_COMMAND[values.family]);
  }
  if (values.weight !== "normal") {
    commandParts.push(NODE_FONT_WEIGHT_COMMAND[values.weight]);
  }
  if (values.style !== "normal") {
    commandParts.push(NODE_FONT_STYLE_COMMAND[values.style]);
  }

  return {
    key: context.key,
    value: commandParts.join(""),
    clearKeys: uniqueStrings(context.clearKeys)
  };
}

export function resolveTransformInspectorValues(
  source: string,
  targetId: string | null,
  parseOptions: EditParseOptions = {}
): TransformInspectorValues {
  const values = cloneTransformInspectorValues(DEFAULT_TRANSFORM_INSPECTOR_VALUES);
  if (!targetId) {
    return values;
  }

  const resolved = resolvePropertyTarget(source, targetId, parseOptions);
  if (resolved.kind === "not-found" || !resolved.target.options) {
    return values;
  }

  for (const entry of resolved.target.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }

    const key = normalizeOptionKey(entry.key);
    if (key === "scale" || key === "/tikz/scale") {
      const parsed = parseTransformScalar(entry.valueRaw);
      if (parsed != null) {
        values.xscale = parsed;
        values.yscale = parsed;
      }
      continue;
    }

    if (key === "xscale" || key === "/tikz/xscale") {
      const parsed = parseTransformScalar(entry.valueRaw);
      if (parsed != null) {
        values.xscale = parsed;
      }
      continue;
    }

    if (key === "yscale" || key === "/tikz/yscale") {
      const parsed = parseTransformScalar(entry.valueRaw);
      if (parsed != null) {
        values.yscale = parsed;
      }
      continue;
    }

    if (key === "shift" || key === "/tikz/shift") {
      const parsed = parseShiftTransformValue(entry.valueRaw);
      if (parsed) {
        values.xshift = parsed.x;
        values.yshift = parsed.y;
      }
      continue;
    }

    if (key === "xshift" || key === "/tikz/xshift") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        values.xshift = parsed;
      }
      continue;
    }

    if (key === "yshift" || key === "/tikz/yshift") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        values.yshift = parsed;
      }
      continue;
    }

    if (key === "rotate" || key === "/tikz/rotate") {
      const parsed = parseTransformScalar(entry.valueRaw);
      if (parsed != null) {
        values.rotate = parsed;
      }
    }
  }

  return values;
}

export function buildTransformSetPropertyMutations(
  currentValues: TransformInspectorValues,
  editedKey: TransformInspectorKey,
  nextValue: number
): TransformSetPropertyMutation[] {
  if (!Number.isFinite(nextValue)) {
    return [];
  }

  const sanitizedCurrent = sanitizeTransformInspectorValues(currentValues);
  const safeNextValue = normalizeTinyNumber(nextValue);

  if (editedKey === "xshift" || editedKey === "yshift") {
    const nextValues = {
      ...sanitizedCurrent,
      [editedKey]: safeNextValue
    };
    return [
      {
        key: "xshift",
        value: `${formatInspectorLength(nextValues.xshift)}pt`,
        clearKeys: uniqueStrings([...SHIFT_CLEAR_KEYS, ...TRANSFORM_KEY_ALIAS_CLEAR_KEYS.xshift])
      },
      {
        key: "yshift",
        value: `${formatInspectorLength(nextValues.yshift)}pt`,
        clearKeys: uniqueStrings([...SHIFT_CLEAR_KEYS, ...TRANSFORM_KEY_ALIAS_CLEAR_KEYS.yshift])
      }
    ];
  }

  if (editedKey === "xscale" || editedKey === "yscale") {
    const nextValues = {
      ...sanitizedCurrent,
      [editedKey]: safeNextValue
    };
    const companionKey: "xscale" | "yscale" = editedKey === "xscale" ? "yscale" : "xscale";
    const mutations: TransformSetPropertyMutation[] = [
      {
        key: editedKey,
        value: formatInspectorLength(nextValues[editedKey]),
        clearKeys: uniqueStrings([...SCALE_CLEAR_KEYS, ...TRANSFORM_KEY_ALIAS_CLEAR_KEYS[editedKey]])
      }
    ];

    const companionValue = nextValues[companionKey];
    const companionDefault = DEFAULT_TRANSFORM_INSPECTOR_VALUES[companionKey];
    if (Math.abs(companionValue - companionDefault) > 1e-6) {
      mutations.push({
        key: companionKey,
        value: formatInspectorLength(companionValue),
        clearKeys: uniqueStrings([...SCALE_CLEAR_KEYS, ...TRANSFORM_KEY_ALIAS_CLEAR_KEYS[companionKey]])
      });
    }

    return mutations;
  }

  return [
    {
      key: "rotate",
      value: formatInspectorLength(safeNextValue),
      clearKeys: uniqueStrings(ROTATE_CLEAR_KEYS)
    }
  ];
}

export function getInspectorDescriptor(element: SceneElement, snapshot: InspectorSnapshot): InspectorDescriptor {
  const inlineTarget = resolveInlineWriteTarget(element, snapshot.source, snapshot.parseOptions);
  const colorAliases = collectInspectorColorAliases(snapshot.source);
  const transformValues = resolveTransformInspectorValues(snapshot.source, inlineTarget.targetId, snapshot.parseOptions);
  const strokeColor = normalizeInspectorColorValue(element.style.stroke);
  const strokeColorSyntax = resolveColorSyntaxValue(
    snapshot.source,
    inlineTarget.targetId,
    ["draw", "color"],
    strokeColor,
    colorAliases,
    element.styleChain,
    snapshot.parseOptions
  );
  const fillColor = normalizeInspectorColorValue(element.style.fill);
  const fillColorSyntax = resolveColorSyntaxValue(
    snapshot.source,
    inlineTarget.targetId,
    ["fill", "color"],
    fillColor,
    colorAliases,
    element.styleChain,
    snapshot.parseOptions
  );
  const patternColor = normalizeInspectorColorValue(element.style.patternColor);
  const patternColorSyntax = resolveColorSyntaxValue(
    snapshot.source,
    inlineTarget.targetId,
    ["pattern color"],
    patternColor,
    colorAliases,
    element.styleChain,
    snapshot.parseOptions
  );
  const fillPaintState = resolveFillPaintState(snapshot.source, inlineTarget.targetId, element.style, snapshot.parseOptions);
  const textColor = normalizeInspectorColorValue(element.style.textColor);
  const textColorSyntax = resolveColorSyntaxValue(
    snapshot.source,
    inlineTarget.targetId,
    ["text", "color"],
    textColor,
    colorAliases,
    element.styleChain,
    snapshot.parseOptions
  );
  const pathStrokeVisibility =
    element.kind === "Path"
      ? computePathStrokeControlVisibility(element.commands, element.style.dashArray)
      : null;
  const pathFillVisibility = element.kind === "Path" ? pathSupportsFillEditing(element.commands) : true;
  const nodeInspectorState =
    inlineTarget.targetKind === "node-item"
      ? resolveNodeInspectorState(snapshot.source, inlineTarget.targetId, element.style, element.kind, snapshot.parseOptions)
      : null;

  if (inlineTarget.targetKind === "node-adornment" && inlineTarget.targetId) {
    const adornmentState = resolveAdornmentInspectorState(snapshot.source, inlineTarget.targetId, element.style, snapshot.parseOptions);
    if (adornmentState) {
      const sections: InspectorSection[] = [
        {
          id: "adornment",
          title: adornmentState.kind === "pin" ? "Pin" : "Label",
          sourceLevel: "command",
          properties: [
            {
              kind: "text",
              id: "adornment-text",
              label: "Text",
              value: adornmentState.text,
              write: makeSetPropertyWriteTarget(inlineTarget, ADORNMENT_TEXT_PROPERTY_KEY)
            },
            {
              kind: "number",
              id: "adornment-angle",
              label: "Angle",
              value: adornmentState.angleDeg,
              step: 1,
              unit: "deg",
              write: makeSetPropertyWriteTarget(inlineTarget, ADORNMENT_ANGLE_PROPERTY_KEY)
            },
            {
              kind: "length",
              id: "adornment-distance",
              label: adornmentState.kind === "pin" ? "Pin distance" : "Label distance",
              value: adornmentState.distancePt,
              step: 0.1,
              unit: "pt",
              write: makeSetPropertyWriteTarget(inlineTarget, ADORNMENT_DISTANCE_PROPERTY_KEY)
            },
            {
              kind: "color",
              id: "adornment-text-color",
              label: "Text color",
              value: textColor,
              syntaxValue: textColorSyntax,
              options: colorOptionsForValue(textColor),
              write: makeSetPropertyWriteTarget(inlineTarget, "text")
            },
            {
              kind: "color",
              id: "adornment-draw-color",
              label: "Draw",
              value: strokeColor,
              syntaxValue: strokeColorSyntax,
              options: colorOptionsForValue(strokeColor),
              write: makeSetPropertyWriteTarget(inlineTarget, "draw")
            },
            {
              kind: "color",
              id: "adornment-fill-color",
              label: "Fill",
              value: fillColor,
              syntaxValue: fillColorSyntax,
              options: colorOptionsForValue(fillColor),
              write: makeSetPropertyWriteTarget(inlineTarget, "fill")
            }
          ]
        }
      ];

      if (adornmentState.kind === "pin") {
        sections.push({
          id: "pin-edge",
          title: "Pin Edge",
          sourceLevel: "command",
          properties: [
            {
              kind: "color",
              id: "pin-edge-color",
              label: "Color",
              value: adornmentState.pinEdge.draw,
              syntaxValue: adornmentState.pinEdge.draw,
              options: colorOptionsForValue(adornmentState.pinEdge.draw),
              write: makeSetPropertyWriteTarget(inlineTarget, PIN_EDGE_DRAW_PROPERTY_KEY)
            },
            {
              kind: "length",
              id: "pin-edge-line-width",
              label: "Line width",
              value: adornmentState.pinEdge.lineWidthPt,
              step: 0.1,
              unit: "pt",
              write: makeSetPropertyWriteTarget(inlineTarget, PIN_EDGE_LINE_WIDTH_PROPERTY_KEY)
            }
          ]
        });
      }

      return {
        elementKind: normalizeElementKind(element.kind),
        elementId: element.sourceRef.sourceId,
        writeTargetId: inlineTarget.targetId,
        readOnlyReason: inlineTarget.reason,
        sections
      };
    }
  }

  const sections: InspectorSection[] = [
    {
      id: "transform",
      title: "Transform",
      sourceLevel: "command",
      properties: [
        {
          kind: "number",
          id: "xshift",
          label: "X shift",
          value: transformValues.xshift,
          step: 0.1,
          unit: "pt",
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "xshift", transformValues)
        },
        {
          kind: "number",
          id: "yshift",
          label: "Y shift",
          value: transformValues.yshift,
          step: 0.1,
          unit: "pt",
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "yshift", transformValues)
        },
        {
          kind: "number",
          id: "xscale",
          label: "X scale",
          value: transformValues.xscale,
          step: 0.1,
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "xscale", transformValues)
        },
        {
          kind: "number",
          id: "yscale",
          label: "Y scale",
          value: transformValues.yscale,
          step: 0.1,
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "yscale", transformValues)
        },
        {
          kind: "number",
          id: "rotate",
          label: "Rotate",
          value: transformValues.rotate,
          step: 1,
          unit: "deg",
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "rotate", transformValues)
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
  if (nodeInspectorState) {
    sections.splice(1, 0, {
      id: "node",
      title: "Node",
      sourceLevel: "command",
      properties: [
        {
          kind: "nodeShape",
          id: "node-shape",
          label: "Shape",
          value: nodeInspectorState.shape,
          options: NODE_SHAPE_OPTIONS,
          note: nodeInspectorState.shapeNote,
          write: makeSetPropertyWriteTarget(inlineTarget, NODE_SHAPE_KEY)
        },
        {
          kind: "length",
          id: "node-inner-sep",
          label: "Inner sep",
          value: nodeInspectorState.innerSep,
          step: 0.1,
          unit: "pt",
          note: nodeInspectorState.innerSepNote,
          write: makeSetPropertyWriteTarget(inlineTarget, "inner sep")
        },
        {
          kind: "nodeFont",
          id: "node-font",
          label: "Font",
          family: nodeInspectorState.font.family,
          weight: nodeInspectorState.font.weight,
          style: nodeInspectorState.font.style,
          sizePreset: nodeInspectorState.font.sizePreset,
          customSizePt: nodeInspectorState.font.customSizePt,
          sizeOptions: NODE_FONT_SIZE_PRESETS.map((preset) => ({
            value: preset.value,
            label: preset.label
          })),
          context: nodeInspectorState.font.context,
          note: nodeInspectorState.font.note,
          write: makeSetPropertyWriteTarget(inlineTarget, nodeInspectorState.font.context.key)
        },
        {
          kind: "color",
          id: "node-text-color",
          label: "Text color",
          value: textColor,
          syntaxValue: textColorSyntax,
          options: colorOptionsForValue(textColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "text")
        }
      ]
    });
  }
  if (pathFillVisibility) {
    const fillProperties: InspectorProperty[] = [
      {
        kind: "color",
        id: "fill-color",
        label: "Color",
        value: fillColor,
        syntaxValue: fillColorSyntax,
        options: colorOptionsForValue(fillColor),
        write: makeSetPropertyWriteTarget(inlineTarget, "fill")
      },
      {
        kind: "fillMode",
        id: "fill-mode",
        label: "Mode",
        value: fillPaintState.mode,
        options: FILL_MODE_OPTIONS,
        context: {
          fillColor: fillColorSyntax ?? fillColor,
          patternColor: patternColorSyntax ?? patternColor,
          shading: fillPaintState.shading,
          pattern: fillPaintState.pattern
        },
        write: makeSetPropertyWriteTarget(inlineTarget, "fill")
      }
    ];

    if (fillPaintState.mode === "gradient") {
      fillProperties.push({
        kind: "fillShading",
        id: "fill-shading",
        label: "Shading",
        value: fillPaintState.shading,
        options: FILL_SHADING_OPTIONS,
        note: fillPaintState.shading === "custom" ? FILL_STYLE_CUSTOM_NOTE : undefined,
        write: makeSetPropertyWriteTarget(inlineTarget, "shading")
      });

      if (fillPaintState.shading === "axis") {
        const topColor = normalizeInspectorColorValue(element.style.axisTopColor);
        const topColorSyntax = resolveColorSyntaxValue(
          snapshot.source,
          inlineTarget.targetId,
          ["top color", "left color"],
          topColor,
          colorAliases,
          element.styleChain
        );
        const bottomColor = normalizeInspectorColorValue(element.style.axisBottomColor);
        const bottomColorSyntax = resolveColorSyntaxValue(
          snapshot.source,
          inlineTarget.targetId,
          ["bottom color", "right color"],
          bottomColor,
          colorAliases,
          element.styleChain
        );
        fillProperties.push({
          kind: "color",
          id: "fill-axis-top-color",
          label: "Start color",
          value: topColor,
          syntaxValue: topColorSyntax,
          options: colorOptionsForValue(topColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "top color")
        });
        fillProperties.push({
          kind: "color",
          id: "fill-axis-bottom-color",
          label: "End color",
          value: bottomColor,
          syntaxValue: bottomColorSyntax,
          options: colorOptionsForValue(bottomColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "bottom color")
        });
        fillProperties.push({
          kind: "number",
          id: "fill-shading-angle",
          label: "Angle",
          value: element.style.shadingAngle,
          step: 1,
          unit: "deg",
          write: makeSetPropertyWriteTarget(inlineTarget, "shading angle")
        });
      } else if (fillPaintState.shading === "radial") {
        const innerColor = normalizeInspectorColorValue(element.style.radialInnerColor);
        const innerColorSyntax = resolveColorSyntaxValue(
          snapshot.source,
          inlineTarget.targetId,
          ["inner color"],
          innerColor,
          colorAliases,
          element.styleChain
        );
        const outerColor = normalizeInspectorColorValue(element.style.radialOuterColor);
        const outerColorSyntax = resolveColorSyntaxValue(
          snapshot.source,
          inlineTarget.targetId,
          ["outer color"],
          outerColor,
          colorAliases,
          element.styleChain
        );
        fillProperties.push({
          kind: "color",
          id: "fill-radial-inner-color",
          label: "Inner color",
          value: innerColor,
          syntaxValue: innerColorSyntax,
          options: colorOptionsForValue(innerColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "inner color")
        });
        fillProperties.push({
          kind: "color",
          id: "fill-radial-outer-color",
          label: "Outer color",
          value: outerColor,
          syntaxValue: outerColorSyntax,
          options: colorOptionsForValue(outerColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "outer color")
        });
      } else if (fillPaintState.shading === "ball") {
        const ballColor = normalizeInspectorColorValue(element.style.ballColor);
        const ballColorSyntax = resolveColorSyntaxValue(
          snapshot.source,
          inlineTarget.targetId,
          ["ball color"],
          ballColor,
          colorAliases,
          element.styleChain
        );
        fillProperties.push({
          kind: "color",
          id: "fill-ball-color",
          label: "Ball color",
          value: ballColor,
          syntaxValue: ballColorSyntax,
          options: colorOptionsForValue(ballColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "ball color")
        });
      }
    } else if (fillPaintState.mode === "pattern") {
      fillProperties.push({
        kind: "fillPattern",
        id: "fill-pattern",
        label: "Pattern",
        value: fillPaintState.pattern,
        options: FILL_PATTERN_OPTIONS,
        note: fillPaintState.pattern === "custom" ? FILL_STYLE_CUSTOM_NOTE : undefined,
        write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
      });
      fillProperties.push({
        kind: "color",
        id: "fill-pattern-color",
        label: "Pattern color",
        value: patternColor,
        syntaxValue: patternColorSyntax,
        options: colorOptionsForValue(patternColor),
        write: makeSetPropertyWriteTarget(inlineTarget, "pattern color")
      });

      const fillPatternOptionContext = resolveFillPatternOptionMutationContext(
        element.style.fillPattern,
        fillPaintState.pattern,
        element.style.lineWidth
      );
      if (fillPatternOptionContext) {
        fillProperties.push({
          kind: "fillPatternOption",
          id: "fill-pattern-angle",
          label: "Angle",
          option: "angle",
          value: fillPatternOptionContext.values.angle,
          step: 1,
          unit: "deg",
          context: fillPatternOptionContext,
          write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
        });
        fillProperties.push({
          kind: "fillPatternOption",
          id: "fill-pattern-distance",
          label: "Distance",
          option: "distance",
          value: fillPatternOptionContext.values.distance,
          step: 0.1,
          unit: "pt",
          context: fillPatternOptionContext,
          write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
        });
        fillProperties.push({
          kind: "fillPatternOption",
          id: "fill-pattern-xshift",
          label: "X shift",
          option: "xshift",
          value: fillPatternOptionContext.values.xshift,
          step: 0.1,
          unit: "pt",
          context: fillPatternOptionContext,
          write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
        });
        fillProperties.push({
          kind: "fillPatternOption",
          id: "fill-pattern-yshift",
          label: "Y shift",
          option: "yshift",
          value: fillPatternOptionContext.values.yshift,
          step: 0.1,
          unit: "pt",
          context: fillPatternOptionContext,
          write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
        });

        if (fillPatternOptionContext.family === "Lines" || fillPatternOptionContext.family === "Hatch") {
          fillProperties.push({
            kind: "fillPatternOption",
            id: "fill-pattern-line-width",
            label: "Line width",
            option: "line width",
            value: fillPatternOptionContext.values.lineWidth,
            step: 0.1,
            unit: "pt",
            context: fillPatternOptionContext,
            write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
          });
        }

        if (fillPatternOptionContext.family === "Dots" || fillPatternOptionContext.family === "Stars") {
          fillProperties.push({
            kind: "fillPatternOption",
            id: "fill-pattern-radius",
            label: "Radius",
            option: "radius",
            value: fillPatternOptionContext.values.radius,
            step: 0.1,
            unit: "pt",
            context: fillPatternOptionContext,
            write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
          });
        }

        if (fillPatternOptionContext.family === "Stars") {
          fillProperties.push({
            kind: "fillPatternOption",
            id: "fill-pattern-points",
            label: "Points",
            option: "points",
            value: fillPatternOptionContext.values.points,
            step: 1,
            context: fillPatternOptionContext,
            write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
          });
        }
      }
    }

    sections.push({
      id: "fill",
      title: "Fill",
      sourceLevel: "command",
      properties: fillProperties
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
    const roundedCornersSourceCommands = element.undecoratedCommands ?? element.commands;
    const roundedCornersEnabled = element.style.roundedCorners != null && element.style.roundedCorners > 0;
    const pathHasCornerThatCanBeRounded = pathHasRoundableCorner(roundedCornersSourceCommands);
    const roundedCornersMax = normalizeRoundedCornersMax(computePathRoundedCornersMax(roundedCornersSourceCommands));
    const roundedCornersDefaultRadius = clampRoundedCornersRadius(ROUNDED_CORNERS_DEFAULT_RADIUS, roundedCornersMax);
    const roundedCornersRadius = roundedCornersEnabled
      ? clampRoundedCornersRadius(element.style.roundedCorners ?? ROUNDED_CORNERS_DEFAULT_RADIUS, roundedCornersMax)
      : roundedCornersDefaultRadius;
    const gridInspectorState = resolveGridInspectorState(snapshot.source, element.sourceRef.sourceId, snapshot.parseOptions);
    const pathMorphingPreset = resolvePathMorphingDecorationPreset(
      snapshot.source,
      inlineTarget.targetId,
      element.style.decoration,
      snapshot.parseOptions
    );
    const pathMorphingSuboptions = resolvePathMorphingDecorationSuboptionProperties(
      pathMorphingPreset,
      element.style.decoration,
      inlineTarget
    );
    const pathSection: InspectorSection = {
      id: "path",
      title: "Path",
      sourceLevel: "command",
      properties: [
        {
          kind: "pathMorphingDecoration",
          id: "path-morphing-decoration",
          label: "Path morphing",
          value: pathMorphingPreset,
          options: PATH_MORPHING_DECORATION_OPTIONS,
          previewLineWidth: element.style.lineWidth,
          write: makeSetPropertyWriteTarget(inlineTarget, "decorate")
        },
        ...pathMorphingSuboptions
      ]
    };

    if (pathStrokeVisibility?.showLineJoin && (pathHasCornerThatCanBeRounded || roundedCornersEnabled)) {
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
      const arrowWrite = makeArrowTipWriteTarget(inlineTarget, element, snapshot.source, snapshot.parseOptions);
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

    if (gridInspectorState) {
      const gridWriteTarget = makeSetPropertyWriteTargetForElementId(inlineTarget, gridInspectorState.keywordId, "step");
      const gridSection: InspectorSection = {
        id: "grid",
        title: "Grid",
        sourceLevel: "command",
        properties: [
          {
            kind: "number",
            id: "grid-step",
            label: "Step",
            value: gridInspectorState.step,
            step: 0.1,
            unit: "cm",
            clearKeys: uniqueStrings(GRID_STEP_CLEAR_KEYS),
            write: gridWriteTarget
          },
          {
            kind: "number",
            id: "grid-xstep",
            label: "X step",
            value: gridInspectorState.xstep,
            step: 0.1,
            unit: "cm",
            clearKeys: uniqueStrings(GRID_XSTEP_CLEAR_KEYS),
            write: makeSetPropertyWriteTargetForElementId(inlineTarget, gridInspectorState.keywordId, "xstep")
          },
          {
            kind: "number",
            id: "grid-ystep",
            label: "Y step",
            value: gridInspectorState.ystep,
            step: 0.1,
            unit: "cm",
            clearKeys: uniqueStrings(GRID_YSTEP_CLEAR_KEYS),
            write: makeSetPropertyWriteTargetForElementId(inlineTarget, gridInspectorState.keywordId, "ystep")
          }
        ]
      };

      const strokeSectionIndex = sections.findIndex((section) => section.id === "stroke");
      if (strokeSectionIndex >= 0) {
        sections.splice(strokeSectionIndex, 0, gridSection);
      } else {
        sections.push(gridSection);
      }
    }
  }

  if (element.kind === "Text" && !nodeInspectorState) {
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
    elementId: element.sourceRef.sourceId,
    writeTargetId: inlineTarget.targetId,
    readOnlyReason: inlineTarget.reason,
    sections
  };
}

function makeSetPropertyWriteTarget(
  inlineTarget: { targetId: string | null; writable: boolean; reason?: string },
  key: string
): SetPropertyWriteTarget {
  return makeSetPropertyWriteTargetForElementId(inlineTarget, inlineTarget.targetId, key);
}

function makeSetPropertyWriteTargetForElementId(
  inlineTarget: { targetId: string | null; writable: boolean; reason?: string },
  elementId: string | null,
  key: string
): SetPropertyWriteTarget {
  return {
    mode: "setProperty",
    elementId: elementId ?? "",
    level: "command",
    key,
    writable: inlineTarget.writable && elementId != null,
    reason: inlineTarget.reason
  };
}

function makeTransformSetPropertyWriteTarget(
  inlineTarget: { targetId: string | null; writable: boolean; reason?: string },
  key: TransformInspectorKey,
  values: TransformInspectorValues
): SetPropertyWriteTarget {
  return {
    ...makeSetPropertyWriteTarget(inlineTarget, key),
    transformContext: {
      key,
      values: cloneTransformInspectorValues(values)
    }
  };
}

function makeArrowTipWriteTarget(
  inlineTarget: { targetId: string | null; writable: boolean; reason?: string },
  element: Extract<SceneElement, { kind: "Path" }>,
  source: string,
  parseOptions: EditParseOptions = {}
): ArrowTipWriteTarget {
  return {
    ...makeSetPropertyWriteTarget(inlineTarget, ARROW_OPTION_KEY),
    arrowContext: resolveArrowWriteContext(source, inlineTarget.targetId, element, parseOptions)
  };
}

function resolveArrowWriteContext(
  source: string,
  targetId: string | null,
  element: Extract<SceneElement, { kind: "Path" }>,
  parseOptions: EditParseOptions = {}
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

  const resolved = resolvePropertyTarget(source, targetId, parseOptions);
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

function resolveFillPaintState(
  source: string,
  targetId: string | null,
  style: {
    shadeEnabled: boolean;
    shading: string;
    fillPattern: ResolvedPattern | null;
  },
  parseOptions: EditParseOptions = {}
): { mode: FillModePresetId; shading: FillShadingPresetId; pattern: FillPatternPresetId } {
  const fallbackShading = style.shadeEnabled ? fillShadingPresetFromStyleName(style.shading) : "axis";
  const fallbackPattern = fillPatternPresetFromResolvedPattern(style.fillPattern);

  let patternActive = style.fillPattern != null;
  let shadingActive = style.shadeEnabled;
  let shading: FillShadingPresetId = fallbackShading;
  let pattern: FillPatternPresetId = fallbackPattern;
  let sawPatternOption = false;
  let sawShadingOption = false;

  if (targetId) {
    const resolved = resolvePropertyTarget(source, targetId, parseOptions);
    if (resolved.kind !== "not-found" && resolved.target.options) {
      for (const entry of resolved.target.options.entries) {
        if (entry.kind === "flag") {
          const key = normalizeOptionKey(entry.key);
          if (key === "pattern" || key === "/tikz/pattern") {
            patternActive = true;
            sawPatternOption = true;
            if (pattern === "custom") {
              pattern = "dots";
            }
            continue;
          }
          if (key === "shade" || key === "/tikz/shade") {
            shadingActive = true;
            sawShadingOption = true;
            continue;
          }
          continue;
        }

        if (entry.kind !== "kv") {
          continue;
        }

        const key = normalizeOptionKey(entry.key);
        if (key === "pattern" || key === "/tikz/pattern") {
          sawPatternOption = true;
          const normalizedPatternValue = stripEnclosingBraces(entry.valueRaw).trim().toLowerCase();
          if (normalizedPatternValue === "none") {
            patternActive = false;
            continue;
          }
          patternActive = true;
          pattern = fillPatternPresetFromRaw(entry.valueRaw);
          continue;
        }

        if (key === "shade" || key === "/tikz/shade") {
          const parsedShade = parseInspectorBoolean(entry.valueRaw);
          if (parsedShade != null) {
            sawShadingOption = true;
            shadingActive = parsedShade;
          }
          continue;
        }

        if (key === "shading" || key === "/tikz/shading") {
          sawShadingOption = true;
          shadingActive = true;
          shading = fillShadingPresetFromStyleName(entry.valueRaw);
          continue;
        }

        if (!SHADING_ACTIVATION_KEYS.has(key)) {
          continue;
        }

        sawShadingOption = true;
        shadingActive = true;
        const inferred = fillShadingPresetFromActivationKey(key);
        if (inferred) {
          shading = inferred;
        }
      }
    }
  }

  if (sawPatternOption && patternActive && pattern === "custom") {
    return { mode: "pattern", shading, pattern };
  }
  if (sawPatternOption && patternActive) {
    return { mode: "pattern", shading, pattern: pattern === "custom" ? "dots" : pattern };
  }
  if (patternActive) {
    return { mode: "pattern", shading, pattern };
  }
  if (sawShadingOption && shadingActive) {
    return { mode: "gradient", shading, pattern };
  }
  if (shadingActive) {
    return { mode: "gradient", shading, pattern };
  }
  return { mode: "solid", shading, pattern };
}

export function fillShadingPresetFromStyleName(raw: string): FillShadingPresetId {
  const normalized = stripEnclosingBraces(raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "axis") {
    return "axis";
  }
  if (normalized === "radial") {
    return "radial";
  }
  if (normalized === "ball") {
    return "ball";
  }
  return "custom";
}

export function fillPatternPresetFromResolvedPattern(pattern: ResolvedPattern | null): FillPatternPresetId {
  if (!pattern) {
    return "dots";
  }
  if (pattern.kind === "legacy") {
    const resolved = FILL_PATTERN_PRESET_BY_LOWER.get(pattern.name.toLowerCase());
    return resolved ?? "custom";
  }
  return META_FILL_PATTERN_PRESET_BY_KIND[pattern.kind] ?? "custom";
}

export function fillPatternPresetFromRaw(raw: string): FillPatternPresetId {
  const name = extractPatternName(raw);
  if (!name) {
    return "dots";
  }
  const metaMatch = META_FILL_PATTERN_PRESET_BY_LOWER.get(name.toLowerCase()) ?? null;
  if (metaMatch) {
    return metaMatch;
  }
  const match = FILL_PATTERN_PRESET_BY_LOWER.get(name.toLowerCase());
  return match ?? "custom";
}

function resolveFillPatternOptionMutationContext(
  pattern: ResolvedPattern | null,
  fallbackPatternPreset: FillPatternPresetId,
  fallbackLineWidth: number
): FillPatternOptionMutationContext | null {
  if (pattern?.kind === "meta-lines") {
    return {
      family: "Lines",
      values: {
        angle: pattern.angle,
        distance: pattern.distance,
        xshift: pattern.xshift,
        yshift: pattern.yshift,
        lineWidth: pattern.lineWidth,
        radius: DEFAULT_META_PATTERN_RADIUS,
        points: 5
      }
    };
  }
  if (pattern?.kind === "meta-hatch") {
    return {
      family: "Hatch",
      values: {
        angle: pattern.angle,
        distance: pattern.distance,
        xshift: pattern.xshift,
        yshift: pattern.yshift,
        lineWidth: pattern.lineWidth,
        radius: DEFAULT_META_PATTERN_RADIUS,
        points: 5
      }
    };
  }
  if (pattern?.kind === "meta-dots") {
    return {
      family: "Dots",
      values: {
        angle: pattern.angle,
        distance: pattern.distance,
        xshift: pattern.xshift,
        yshift: pattern.yshift,
        lineWidth: normalizeFillPatternLineWidthFallback(fallbackLineWidth),
        radius: pattern.radius,
        points: 5
      }
    };
  }
  if (pattern?.kind === "meta-stars") {
    return {
      family: "Stars",
      values: {
        angle: pattern.angle,
        distance: pattern.distance,
        xshift: pattern.xshift,
        yshift: pattern.yshift,
        lineWidth: normalizeFillPatternLineWidthFallback(fallbackLineWidth),
        radius: pattern.radius,
        points: pattern.points
      }
    };
  }

  const fallbackFamily = fillPatternMetaFamilyFromPreset(fallbackPatternPreset);
  if (!fallbackFamily) {
    return null;
  }
  return {
    family: fallbackFamily,
    values: defaultFillPatternMetaValues(fallbackFamily, fallbackLineWidth)
  };
}

function extractPatternName(raw: string): string | null {
  const normalized = stripEnclosingBraces(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  const bracketIndex = findTopLevelOpenBracket(normalized);
  const name = bracketIndex >= 0 ? normalized.slice(0, bracketIndex).trim() : normalized;
  return name.length > 0 ? name : null;
}

function findTopLevelOpenBracket(input: string): number {
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
      if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        return index;
      }
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
  }

  return -1;
}

function parseInspectorBoolean(raw: string): boolean | null {
  return parseBooleanishNormalized(stripEnclosingBraces(raw), {
    allowOnOff: true,
    allowNoneAsFalse: true,
    empty: true
  });
}

function fillShadingPresetFromActivationKey(key: string): FillShadingPresetId | null {
  if (
    key === "inner color" ||
    key === "/tikz/inner color" ||
    key === "outer color" ||
    key === "/tikz/outer color"
  ) {
    return "radial";
  }
  if (key === "ball color" || key === "/tikz/ball color") {
    return "ball";
  }
  if (
    key === "lower left" ||
    key === "/tikz/lower left" ||
    key === "lower right" ||
    key === "/tikz/lower right" ||
    key === "upper left" ||
    key === "/tikz/upper left" ||
    key === "upper right" ||
    key === "/tikz/upper right"
  ) {
    return "custom";
  }
  if (
    key === "top color" ||
    key === "/tikz/top color" ||
    key === "middle color" ||
    key === "/tikz/middle color" ||
    key === "bottom color" ||
    key === "/tikz/bottom color" ||
    key === "left color" ||
    key === "/tikz/left color" ||
    key === "right color" ||
    key === "/tikz/right color" ||
    key === "shading angle" ||
    key === "/tikz/shading angle"
  ) {
    return "axis";
  }
  return null;
}

function normalizeFillMutationColor(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function selectCuratedShadingPreset(value: FillShadingPresetId | undefined): Exclude<FillShadingPresetId, "custom"> {
  return value === "axis" || value === "radial" || value === "ball" ? value : "axis";
}

function selectCuratedPatternPreset(value: FillPatternPresetId | undefined): Exclude<FillPatternPresetId, "custom"> {
  return value && value !== "custom" ? value : "dots";
}

function fillPatternMetaFamilyFromPreset(preset: FillPatternPresetId): FillPatternMetaFamilyId | null {
  if (preset === "Lines" || preset === "Hatch" || preset === "Dots" || preset === "Stars") {
    return preset;
  }
  return null;
}

function fillPatternMetaValueKey(option: FillPatternMetaOptionKey): keyof FillPatternMetaValues {
  if (option === "line width") {
    return "lineWidth";
  }
  return option;
}

function sanitizeFillPatternMetaOptionValue(
  option: FillPatternMetaOptionKey,
  value: number,
  fallbackValues: FillPatternMetaValues
): number {
  if (!Number.isFinite(value)) {
    return fallbackValues[fillPatternMetaValueKey(option)];
  }

  if (option === "points") {
    return Math.max(2, Math.round(value));
  }
  if (option === "distance" || option === "line width" || option === "radius") {
    return Math.max(0, normalizeTinyNumber(value));
  }
  return normalizeTinyNumber(value);
}

function defaultFillPatternMetaValues(
  family: FillPatternMetaFamilyId,
  fallbackLineWidth: number
): FillPatternMetaValues {
  const defaultDistance = family === "Stars" ? DEFAULT_META_PATTERN_STARS_DISTANCE : DEFAULT_META_PATTERN_DISTANCE;
  const defaultRadius = family === "Stars" ? DEFAULT_META_PATTERN_STARS_RADIUS : DEFAULT_META_PATTERN_RADIUS;
  return {
    angle: 0,
    distance: defaultDistance,
    xshift: 0,
    yshift: 0,
    lineWidth: normalizeFillPatternLineWidthFallback(fallbackLineWidth),
    radius: defaultRadius,
    points: 5
  };
}

function normalizeFillPatternLineWidthFallback(value: number): number {
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  return 0.4;
}

function serializeFillPatternMetaPattern(family: FillPatternMetaFamilyId, values: FillPatternMetaValues): string {
  const options = [
    `angle=${formatInspectorLength(values.angle)}`,
    `distance=${formatInspectorLength(values.distance)}pt`,
    `xshift=${formatInspectorLength(values.xshift)}pt`,
    `yshift=${formatInspectorLength(values.yshift)}pt`
  ];

  if (family === "Lines" || family === "Hatch") {
    options.push(`line width=${formatInspectorLength(values.lineWidth)}pt`);
  } else {
    options.push(`radius=${formatInspectorLength(values.radius)}pt`);
    if (family === "Stars") {
      options.push(`points=${Math.max(2, Math.round(values.points))}`);
    }
  }

  return `{${family}[${options.join(",")}]}`
}

function resolvePathMorphingDecorationSuboptionProperties(
  preset: PathMorphingDecorationPresetId,
  decoration: { params: Record<string, string> },
  inlineTarget: { targetId: string | null; writable: boolean; reason?: string }
): Array<Extract<InspectorProperty, { kind: "number" }>> {
  if (preset === "none" || preset === "custom") {
    return [];
  }

  const suboptionKeys = PATH_MORPHING_DECORATION_SUBOPTIONS_BY_PRESET[preset];
  if (!suboptionKeys || suboptionKeys.length === 0) {
    return [];
  }

  return suboptionKeys.map((suboptionKey) => {
    const spec = PATH_MORPHING_DECORATION_SUBOPTION_SPECS[suboptionKey];
    const value = resolvePathMorphingDecorationSuboptionValue(spec, decoration.params);
    return {
      kind: "number",
      id: spec.id,
      label: spec.label,
      value,
      step: spec.step,
      unit: spec.unit,
      clearKeys: uniqueStrings(spec.clearKeys),
      write: makeSetPropertyWriteTarget(inlineTarget, spec.writeKey)
    };
  });
}

function resolvePathMorphingDecorationSuboptionValue(
  spec: PathMorphingDecorationSuboptionSpec,
  params: Record<string, string>
): number {
  const rawValue = params[spec.decorationKey];
  if (!rawValue) {
    return spec.defaultValue;
  }

  if (spec.unit === "pt") {
    const parsedLength = parseLength(rawValue, "pt");
    return parsedLength ?? spec.defaultValue;
  }

  const parsed = Number(stripEnclosingBraces(rawValue).trim());
  return Number.isFinite(parsed) ? parsed : spec.defaultValue;
}

function resolvePathMorphingDecorationPreset(
  source: string,
  targetId: string | null,
  styleDecoration: { enabled: boolean; name: string | null },
  parseOptions: EditParseOptions = {}
): PathMorphingDecorationPresetId {
  const fallback = pathMorphingDecorationPresetFromStyle(styleDecoration);
  if (!targetId) {
    return fallback;
  }

  const resolved = resolvePropertyTarget(source, targetId, parseOptions);
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
  return parseBooleanishNormalized(stripEnclosingBraces(raw), { allowOnOff: true, empty: true });
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

function resolveGridInspectorState(
  source: string,
  pathSourceId: string,
  parseOptions: EditParseOptions = {}
): { keywordId: string; step: number; xstep: number; ystep: number } | null {
  const pathStatement = findPathStatementInSource(source, pathSourceId, parseOptions);
  if (!pathStatement) {
    return null;
  }

  const gridKeywords = collectGridKeywords(pathStatement.items);
  if (gridKeywords.length !== 1) {
    return null;
  }

  const gridKeyword = gridKeywords[0];
  if (!gridKeyword) {
    return null;
  }
  const values = resolveGridStepValues(gridKeyword.options);
  return {
    keywordId: gridKeyword.keyword.id,
    step: values.step,
    xstep: values.xstep,
    ystep: values.ystep
  };
}

function findPathStatementInSource(source: string, sourceId: string, parseOptions: EditParseOptions = {}): PathStatement | null {
  const parsed = parseTikz(source, { recover: true, activeFigureId: parseOptions.activeFigureId });
  return findPathStatementById(parsed.figure.body, sourceId);
}

function findPathStatementById(statements: Statement[], sourceId: string): PathStatement | null {
  for (const statement of statements) {
    if (statement.kind === "Path" && statement.id === sourceId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, sourceId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function collectGridKeywords(
  items: readonly PathItem[]
): Array<{ keyword: Extract<PathItem, { kind: "PathKeyword" }>; options: Extract<PathItem, { kind: "PathOption" }> | null }> {
  const collected: Array<{ keyword: Extract<PathItem, { kind: "PathKeyword" }>; options: Extract<PathItem, { kind: "PathOption" }> | null }> = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    if (item.kind === "PathKeyword" && item.keyword === "grid") {
      const next = items[index + 1];
      collected.push({
        keyword: item,
        options: next?.kind === "PathOption" ? next : null
      });
      continue;
    }
    if (item.kind === "ChildOperation") {
      collected.push(...collectGridKeywords(item.body));
    }
  }

  return collected;
}

function resolveGridStepValues(
  optionItem: Extract<PathItem, { kind: "PathOption" }> | null
): { step: number; xstep: number; ystep: number } {
  if (!optionItem) {
    return {
      step: GRID_DEFAULT_STEP_CM,
      xstep: GRID_DEFAULT_STEP_CM,
      ystep: GRID_DEFAULT_STEP_CM
    };
  }

  let xstep = GRID_DEFAULT_STEP_CM;
  let ystep = GRID_DEFAULT_STEP_CM;
  let sawXstep = false;
  let sawYstep = false;
  let stepCandidate: number | null = null;

  for (const entry of optionItem.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }

    const key = normalizeOptionKey(entry.key);
    if (key === "step") {
      const parsed = parseGridStepValueCm(entry.valueRaw);
      if (!parsed) {
        continue;
      }
      xstep = parsed.x;
      ystep = parsed.y;
      sawXstep = true;
      sawYstep = true;
      stepCandidate = parsed.step;
      continue;
    }

    if (key === "xstep" || key === "x step") {
      const parsed = parseGridLengthCm(entry.valueRaw);
      if (parsed != null) {
        xstep = parsed;
        sawXstep = true;
      }
      continue;
    }

    if (key === "ystep" || key === "y step") {
      const parsed = parseGridLengthCm(entry.valueRaw);
      if (parsed != null) {
        ystep = parsed;
        sawYstep = true;
      }
    }
  }

  if (!sawXstep) {
    xstep = GRID_DEFAULT_STEP_CM;
  }
  if (!sawYstep) {
    ystep = GRID_DEFAULT_STEP_CM;
  }

  if (stepCandidate == null && Math.abs(xstep - ystep) <= 1e-6) {
    stepCandidate = xstep;
  }

  return {
    step: stepCandidate ?? GRID_DEFAULT_STEP_CM,
    xstep,
    ystep
  };
}

function parseGridStepValueCm(raw: string): { step: number | null; x: number; y: number } | null {
  const pair = parseCoordinateLike(raw);
  if (pair) {
    const x = parseGridLengthCm(pair.x);
    const y = parseGridLengthCm(pair.y);
    if (x == null || y == null) {
      return null;
    }
    return {
      step: Math.abs(x - y) <= 1e-6 ? x : null,
      x,
      y
    };
  }

  const scalar = parseGridLengthCm(raw);
  if (scalar == null) {
    return null;
  }
  return {
    step: scalar,
    x: scalar,
    y: scalar
  };
}

function parseGridLengthCm(raw: string): number | null {
  const parsedPt = parseLength(raw, "cm");
  if (parsedPt == null || !Number.isFinite(parsedPt) || parsedPt <= 0) {
    return null;
  }
  return normalizeTinyNumber(parsedPt * CM_PER_PT);
}

function resolveNodeInspectorState(
  source: string,
  targetId: string | null,
  style: Pick<ResolvedStyle, "fontFamily" | "fontWeight" | "fontStyle" | "fontSize">,
  elementKind: SceneElement["kind"],
  parseOptions: EditParseOptions = {}
): {
  shape: NodeShapePresetId;
  shapeNote?: string;
  innerSep: number;
  innerSepNote?: string;
  font: {
    family: NodeFontFamilyId;
    weight: "normal" | "bold";
    style: "normal" | "italic";
    sizePreset: NodeFontSizePresetId;
    customSizePt: number | null;
    context: NodeFontMutationContext;
    note?: string;
  };
} {
  const fallbackShape = nodeShapeFallbackFromElementKind(elementKind);
  const fallbackFontSize =
    Number.isFinite(style.fontSize) && style.fontSize > 0 ? style.fontSize : DEFAULT_TEXT_FONT_SIZE;
  const fallbackFontSizePreset = nodeFontSizePresetFromFontSize(fallbackFontSize);
  const state: {
    shape: NodeShapePresetId;
    shapeNote?: string;
    innerSep: number;
    innerSepNote?: string;
    font: {
      family: NodeFontFamilyId;
      weight: "normal" | "bold";
      style: "normal" | "italic";
      sizePreset: NodeFontSizePresetId;
      customSizePt: number | null;
      context: NodeFontMutationContext;
      note?: string;
    };
  } = {
    shape: fallbackShape,
    innerSep: NODE_INNER_SEP_DEFAULT,
    font: {
      family: style.fontFamily,
      weight: style.fontWeight,
      style: style.fontStyle,
      sizePreset: fallbackFontSizePreset,
      customSizePt: fallbackFontSizePreset === "custom" ? fallbackFontSize : null,
      context: {
        key: "node font",
        clearKeys: ["font"],
        fallbackCustomSizePt: fallbackFontSize
      }
    }
  };

  if (!targetId) {
    return state;
  }

  const resolved = resolvePropertyTarget(source, targetId, parseOptions);
  if (resolved.kind === "not-found" || !resolved.target.options) {
    return state;
  }

  let rawShape: string | null = null;
  let innerXSep = NODE_INNER_SEP_DEFAULT;
  let innerYSep = NODE_INNER_SEP_DEFAULT;
  let sawAxisSpecificInnerSep = false;
  let selectedFontKey: "font" | "node font" | null = null;
  let selectedFontRaw: string | null = null;

  for (const entry of resolved.target.options.entries) {
    if (entry.kind === "flag") {
      const key = normalizeOptionKey(entry.key);
      if (NODE_SHAPE_KNOWN_SET.has(key)) {
        rawShape = key;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    const key = normalizeOptionKey(entry.key);
    if (key === NODE_SHAPE_KEY) {
      rawShape = normalizeShapeRawValue(entry.valueRaw);
      continue;
    }
    if (key === "inner sep") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null && parsed >= 0) {
        innerXSep = parsed;
        innerYSep = parsed;
        sawAxisSpecificInnerSep = false;
      }
      continue;
    }
    if (key === "inner xsep") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null && parsed >= 0) {
        innerXSep = parsed;
        sawAxisSpecificInnerSep = true;
      }
      continue;
    }
    if (key === "inner ysep") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null && parsed >= 0) {
        innerYSep = parsed;
        sawAxisSpecificInnerSep = true;
      }
      continue;
    }
    if (key === "font" || key === "node font") {
      selectedFontKey = key;
      selectedFontRaw = entry.valueRaw;
      continue;
    }
  }

  if (rawShape != null) {
    if (CURATED_NODE_SHAPE_SET.has(rawShape as Exclude<NodeShapePresetId, "custom">)) {
      state.shape = rawShape as Exclude<NodeShapePresetId, "custom">;
    } else {
      state.shape = "custom";
      state.shapeNote = NODE_SHAPE_CUSTOM_NOTE;
    }
  }

  state.innerSep = (innerXSep + innerYSep) / 2;
  if (sawAxisSpecificInnerSep || Math.abs(innerXSep - innerYSep) > 1e-6) {
    state.innerSepNote = NODE_INNER_SEP_CONFLICT_NOTE;
  }

  let fallbackCustomSizePt = fallbackFontSize;
  if (selectedFontRaw != null) {
    const parsedFont = parseFontStyle(selectedFontRaw);
    if (parsedFont == null) {
      state.font.note = NODE_FONT_CUSTOM_NOTE;
    } else {
      if (parsedFont.fontFamily) {
        state.font.family = parsedFont.fontFamily;
      }
      if (parsedFont.fontWeight) {
        state.font.weight = parsedFont.fontWeight;
      }
      if (parsedFont.fontStyle) {
        state.font.style = parsedFont.fontStyle;
      }
      const parsedFontSize =
        Number.isFinite(parsedFont.fontSize) && (parsedFont.fontSize ?? 0) > 0
          ? (parsedFont.fontSize as number)
          : fallbackFontSize;
      fallbackCustomSizePt = parsedFontSize;
      const parsedSizePreset = nodeFontSizePresetFromFontSize(parsedFontSize);
      state.font.sizePreset = parsedSizePreset;
      state.font.customSizePt = parsedSizePreset === "custom" ? parsedFontSize : null;
    }
  } else if (state.font.sizePreset === "custom" && Number.isFinite(state.font.customSizePt)) {
    fallbackCustomSizePt = state.font.customSizePt as number;
  }

  const preferredFontKey = selectedFontKey ?? "node font";
  state.font.context = {
    key: preferredFontKey,
    clearKeys: preferredFontKey === "font" ? ["node font"] : ["font"],
    fallbackCustomSizePt
  };

  return state;
}

function nodeShapeFallbackFromElementKind(kind: SceneElement["kind"]): Exclude<NodeShapePresetId, "custom"> {
  if (kind === "Circle") {
    return "circle";
  }
  if (kind === "Ellipse") {
    return "ellipse";
  }
  return "rectangle";
}

function normalizeShapeRawValue(raw: string): string {
  return stripEnclosingBraces(raw).trim().toLowerCase().replace(/\s+/g, " ");
}

function nodeFontSizePresetFromFontSize(fontSize: number): NodeFontSizePresetId {
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    return "normalsize";
  }
  for (const preset of NODE_FONT_SIZE_PRESETS) {
    const expected = DEFAULT_TEXT_FONT_SIZE * preset.scale;
    if (Math.abs(expected - fontSize) <= NODE_FONT_SIZE_EPSILON) {
      return preset.value;
    }
  }
  return "custom";
}

function resolveInlineWriteTarget(
  element: SceneElement,
  source: string,
  parseOptions: EditParseOptions = {}
): { targetId: string | null; targetKind: string | null; writable: boolean; reason?: string } {
  if (element.origin?.foreachStack && element.origin.foreachStack.length > 0) {
    return {
      targetId: null,
      targetKind: null,
      writable: false,
      reason: "This element comes from a \\foreach expansion and is read-only in the Phase 2 inspector."
    };
  }

  if (element.origin?.macroStack && element.origin.macroStack.length > 0) {
    return {
      targetId: null,
      targetKind: null,
      writable: false,
      reason: "This element comes from a macro expansion and is read-only in the Phase 2 inspector."
    };
  }

  const styleChainCommandSourceId =
    [...element.styleChain].reverse().find((entry) => entry.kind === "command")?.sourceRef?.sourceId ?? null;
  const candidateTargetIds = [
    element.adornment?.targetId ?? null,
    styleChainCommandSourceId,
    element.sourceRef.sourceId
  ].filter((candidate, index, all): candidate is string => Boolean(candidate) && all.indexOf(candidate) === index);

  for (const targetId of candidateTargetIds) {
    const resolved = resolvePropertyTarget(source, targetId, parseOptions);
    if (resolved.kind === "found") {
      return { targetId, targetKind: resolved.target.kind, writable: true };
    }
  }

  const fallbackTargetId = candidateTargetIds[0] ?? null;
  if (!fallbackTargetId) {
    return {
      targetId: null,
      targetKind: null,
      writable: false,
      reason: "Inline command options could not be resolved for this element."
    };
  }

  return {
    targetId: fallbackTargetId,
    targetKind: null,
    writable: false,
    reason: "Inline command options could not be resolved for this element."
  };
}

function resolveAdornmentInspectorState(
  source: string,
  targetId: string,
  style: ResolvedStyle,
  parseOptions: EditParseOptions = {}
): {
  kind: "label" | "pin";
  text: string;
  angleDeg: number;
  distancePt: number;
  distanceExplicit: boolean;
  pinEdge: {
    draw: string | null;
    lineWidthPt: number;
    dashStyle: DashStylePresetId;
  };
} | null {
  const resolved = resolvePropertyTarget(source, targetId, parseOptions);
  if (resolved.kind === "not-found" || resolved.target.kind !== "node-adornment") {
    return null;
  }

  const angleDeg = parseAdornmentAngleForInspector(resolved.target.angleRaw ?? "center");
  const text = resolved.target.textSpan
    ? stripEnclosingBraces(source.slice(resolved.target.textSpan.from, resolved.target.textSpan.to))
    : "";
  const pinEdge = resolvePinEdgeInspectorState(resolved.target.pinEdgeRaw ?? null);

  return {
    kind: resolved.target.adornmentKind ?? "label",
    text,
    angleDeg,
    distancePt: resolved.target.distancePt ?? resolved.target.defaultDistancePt ?? 0,
    distanceExplicit: resolved.target.distanceExplicit ?? false,
    pinEdge: {
      draw: pinEdge.draw,
      lineWidthPt: pinEdge.lineWidthPt ?? style.lineWidth,
      dashStyle: pinEdge.dashStyle
    }
  };
}

function parseAdornmentAngleForInspector(raw: string): number {
  const normalized = raw.trim().toLowerCase();
  const keyword =
    normalized === "center" || normalized === "centered" ? 0 :
    normalized === "right" || normalized === "east" ? 0 :
    normalized === "above right" || normalized === "north east" ? 45 :
    normalized === "above" || normalized === "north" ? 90 :
    normalized === "above left" || normalized === "north west" ? 135 :
    normalized === "left" || normalized === "west" ? 180 :
    normalized === "below left" || normalized === "south west" ? -135 :
    normalized === "below" || normalized === "south" ? -90 :
    normalized === "below right" || normalized === "south east" ? -45 :
    null;
  if (keyword != null) {
    return keyword;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

function resolvePinEdgeInspectorState(pinEdgeRaw: string | null): {
  draw: string | null;
  lineWidthPt: number | null;
  dashStyle: DashStylePresetId;
} {
  const options = pinEdgeRaw ? parseStyleValueAsOptionList(pinEdgeRaw) : null;
  let draw: string | null = null;
  let lineWidthPt: number | null = null;
  let dashStyle: DashStylePresetId = "solid";

  for (const entry of options?.entries ?? []) {
    if (entry.kind === "flag") {
      const normalized = normalizeOptionKey(entry.key);
      if (
        normalized === "dashed" ||
        normalized === "densely dashed" ||
        normalized === "loosely dashed" ||
        normalized === "dotted" ||
        normalized === "densely dotted" ||
        normalized === "loosely dotted"
      ) {
        dashStyle = normalized as DashStylePresetId;
      } else if (isLikelyColorValue(entry.key)) {
        draw = entry.key.trim();
      }
      continue;
    }
    if (entry.kind !== "kv") {
      continue;
    }
    const key = normalizeOptionKey(entry.key);
    if (key === "draw" || key === "color") {
      draw = entry.valueRaw.trim() || null;
      continue;
    }
    if (key === "line width") {
      lineWidthPt = parseLength(entry.valueRaw, "pt");
      continue;
    }
    if (
      key === "solid" ||
      key === "dashed" ||
      key === "densely dashed" ||
      key === "loosely dashed" ||
      key === "dotted" ||
      key === "densely dotted" ||
      key === "loosely dotted"
    ) {
      dashStyle = key as DashStylePresetId;
    }
  }

  return { draw, lineWidthPt, dashStyle };
}

function isLikelyColorValue(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return false;
  }
  return trimmed === "none" || /^[a-z][a-z0-9._:@!-]*$/i.test(trimmed) || /^#[0-9a-f]{3,8}$/i.test(trimmed);
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

function polygonSignedArea(points: ReadonlyArray<{ x: number; y: number }>): number {
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

export function lineWidthPresetLabel(value: number): string | null {
  for (const preset of LINE_WIDTH_PRESETS) {
    if (Math.abs(preset.value - value) <= 0.02) {
      return preset.label;
    }
  }
  return null;
}

export function dashStylePresetFromStyle(dashArray: number[] | null, lineWidth: number): DashStylePresetId {
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

export function lineCapPresetFromStyle(value: "butt" | "round" | "square"): LineCapPresetId {
  if (value === "butt" || value === "round" || value === "square") {
    return value;
  }
  return "custom";
}

export function lineJoinPresetFromStyle(value: "miter" | "round" | "bevel"): LineJoinPresetId {
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

function parseTransformScalar(raw: string): number | null {
  const parsed = Number(stripEnclosingBraces(raw).trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return normalizeTinyNumber(parsed);
}

function parseShiftTransformValue(raw: string): { x: number; y: number } | null {
  const normalized = stripEnclosingBraces(raw).trim();
  const coordinate = parseCoordinateLike(normalized);
  if (!coordinate) {
    return null;
  }

  const x = parseLength(coordinate.x, "cm");
  const y = parseLength(coordinate.y, "cm");
  if (x == null || y == null) {
    return null;
  }

  return {
    x: normalizeTinyNumber(x),
    y: normalizeTinyNumber(y)
  };
}

function cloneTransformInspectorValues(values: TransformInspectorValues): TransformInspectorValues {
  return {
    xshift: values.xshift,
    yshift: values.yshift,
    xscale: values.xscale,
    yscale: values.yscale,
    rotate: values.rotate
  };
}

function sanitizeTransformInspectorValues(values: TransformInspectorValues): TransformInspectorValues {
  return {
    xshift: Number.isFinite(values.xshift) ? normalizeTinyNumber(values.xshift) : DEFAULT_TRANSFORM_INSPECTOR_VALUES.xshift,
    yshift: Number.isFinite(values.yshift) ? normalizeTinyNumber(values.yshift) : DEFAULT_TRANSFORM_INSPECTOR_VALUES.yshift,
    xscale: Number.isFinite(values.xscale) ? normalizeTinyNumber(values.xscale) : DEFAULT_TRANSFORM_INSPECTOR_VALUES.xscale,
    yscale: Number.isFinite(values.yscale) ? normalizeTinyNumber(values.yscale) : DEFAULT_TRANSFORM_INSPECTOR_VALUES.yscale,
    rotate: Number.isFinite(values.rotate) ? normalizeTinyNumber(values.rotate) : DEFAULT_TRANSFORM_INSPECTOR_VALUES.rotate
  };
}

function normalizeTinyNumber(value: number): number {
  return Math.abs(value) <= 1e-9 ? 0 : value;
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
