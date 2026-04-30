import type { OptionEntry } from "../options/types.js";
import type { ResolvedStyle } from "../semantic/types.js";
import { normalizeOptionKey } from "./option-key.js";
import {
  ARROW_DEFAULT_CLEAR_KEYS,
  AXIS_SHADING_CONFLICT_CLEAR_KEYS,
  BALL_SHADING_CONFLICT_CLEAR_KEYS,
  DASH_STYLE_PRESET_CLEAR_KEYS,
  FILL_PATTERN_CLEAR_KEYS,
  FILL_SHADING_CLEAR_KEYS,
  NODE_INNER_SEP_CLEAR_KEYS,
  NODE_MINIMUM_DIMENSION_CLEAR_KEYS,
  NODE_SHAPE_KNOWN_KEYS,
  PATH_MORPHING_DECORATION_CLEAR_KEYS,
  RADIAL_SHADING_CONFLICT_CLEAR_KEYS,
  ROUNDED_CORNERS_CLEAR_KEYS,
  SHADOW_ALL_KEYS
} from "./inspector/presets.js";

export type SemanticPropertyId =
  | "adornment-text-color"
  | "arrow-tip"
  | "dash-style"
  | "decorations.path-morphing"
  | "fill-axis-bottom-color"
  | "fill-axis-top-color"
  | "fill-ball-color"
  | "fill-color"
  | "fill-mode"
  | "fill-pattern"
  | "fill-pattern-color"
  | "fill-pattern-option"
  | "fill-radial-inner-color"
  | "fill-radial-outer-color"
  | "fill-shading"
  | "grid-step"
  | "grid-xstep"
  | "grid-ystep"
  | "line-cap"
  | "line-join"
  | "line-width"
  | "matrix-column-sep"
  | "matrix-draw-color"
  | "matrix-fill-color"
  | "matrix-row-sep"
  | "node-font"
  | "node-inner-sep"
  | "node-minimum-height"
  | "node-minimum-width"
  | "node-shape"
  | "node-text-align"
  | "node-text-color"
  | "node-text-width"
  | "rounded-corners"
  | "shadow-preset"
  | "stroke-color"
  | "stroke-opacity"
  | "fill-opacity"
  | "text-opacity"
  | "text"
  | "transform.rotate"
  | "transform.xscale"
  | "transform.xshift"
  | "transform.yscale"
  | "transform.yshift";

export type PropertyWriteMutation = {
  key: string;
  value: string;
  clearKeys?: string[];
  propertyId?: SemanticPropertyId;
};

export type PropertyWriteContext = {
  propertyId?: SemanticPropertyId;
  key?: string;
  value: string;
  clearKeys?: readonly string[];
};

export type PropertyCleanupKind = "paint-command";

export type PropertySemantics = {
  id: SemanticPropertyId;
  label: string;
  primaryKey: string;
  aliases?: readonly string[];
  conflictKeys?: readonly string[];
  candidateKeys?: readonly string[];
  addable?: boolean;
  addableKind?: string;
  defaultOmission?: "never" | "certified";
  cleanup?: readonly PropertyCleanupKind[];
};

const SHIFT_CLEAR_KEYS = ["shift", "/tikz/shift"] as const;
const SCALE_CLEAR_KEYS = ["scale", "/tikz/scale"] as const;
const ROTATE_CLEAR_KEYS = ["/tikz/rotate"] as const;
const GRID_STEP_CLEAR_KEYS = ["xstep", "x step", "ystep", "y step"] as const;
const GRID_XSTEP_CLEAR_KEYS = ["x step"] as const;
const GRID_YSTEP_CLEAR_KEYS = ["y step"] as const;
const LINE_WIDTH_PRESET_KEYS = ["ultra thin", "very thin", "thin", "semithick", "thick", "very thick", "ultra thick"] as const;
const LINE_WIDTH_ALL_KEYS = ["line width", ...LINE_WIDTH_PRESET_KEYS] as const;

const TRANSFORM_ALIAS_KEYS: Record<Extract<SemanticPropertyId, `transform.${string}`>, readonly string[]> = {
  "transform.rotate": ROTATE_CLEAR_KEYS,
  "transform.xscale": ["/tikz/xscale"],
  "transform.xshift": ["/tikz/xshift"],
  "transform.yscale": ["/tikz/yscale"],
  "transform.yshift": ["/tikz/yshift"]
};

const PROPERTY_DEFINITIONS = [
  property("stroke-color", "Stroke color", "draw", {
    aliases: ["color"],
    candidateKeys: ["draw", "color"],
    addable: true,
    addableKind: "color",
    cleanup: ["paint-command"]
  }),
  property("fill-color", "Fill color", "fill", {
    candidateKeys: ["fill"],
    addable: true,
    addableKind: "color",
    cleanup: ["paint-command"]
  }),
  property("node-text-color", "Text color", "text", { candidateKeys: ["text", "text color"], addable: true, addableKind: "color", defaultOmission: "certified" }),
  property("adornment-text-color", "Text color", "text", { candidateKeys: ["text"], addable: true, addableKind: "color", defaultOmission: "certified" }),
  property("line-width", "Line width", "line width", { candidateKeys: LINE_WIDTH_ALL_KEYS, addable: true, addableKind: "lineWidth", defaultOmission: "certified" }),
  property("dash-style", "Dash style", "solid", { candidateKeys: DASH_STYLE_PRESET_CLEAR_KEYS, addable: true, addableKind: "dashStyle", defaultOmission: "certified" }),
  property("line-cap", "Line cap", "line cap", { addable: true, addableKind: "lineCap", defaultOmission: "certified" }),
  property("line-join", "Line join", "line join", { addable: true, addableKind: "lineJoin", defaultOmission: "certified" }),
  property("fill-mode", "Fill mode", "fill", {
    candidateKeys: ["fill", ...FILL_PATTERN_CLEAR_KEYS, ...FILL_SHADING_CLEAR_KEYS],
    addable: true,
    addableKind: "fillMode"
  }),
  property("fill-shading", "Shading", "shading", {
    candidateKeys: ["shade", "shading", ...AXIS_SHADING_CONFLICT_CLEAR_KEYS, ...RADIAL_SHADING_CONFLICT_CLEAR_KEYS, ...BALL_SHADING_CONFLICT_CLEAR_KEYS],
    addable: true,
    addableKind: "fillShading"
  }),
  property("fill-pattern", "Pattern", "pattern", { candidateKeys: ["pattern"], addable: true, addableKind: "fillPattern" }),
  property("fill-pattern-option", "Pattern option", "pattern", { candidateKeys: ["pattern"] }),
  property("fill-pattern-color", "Pattern color", "pattern color", { addable: true, addableKind: "color" }),
  property("fill-axis-top-color", "Top color", "top color", { addable: true, addableKind: "color" }),
  property("fill-axis-bottom-color", "Bottom color", "bottom color", { addable: true, addableKind: "color" }),
  property("fill-radial-inner-color", "Inner color", "inner color", { addable: true, addableKind: "color" }),
  property("fill-radial-outer-color", "Outer color", "outer color", { addable: true, addableKind: "color" }),
  property("fill-ball-color", "Ball color", "ball color", { addable: true, addableKind: "color" }),
  property("rounded-corners", "Rounded corners", "rounded corners", { candidateKeys: ROUNDED_CORNERS_CLEAR_KEYS, addable: true, addableKind: "roundedCorners", defaultOmission: "certified" }),
  property("arrow-tip", "Arrow tip", "arrows", { candidateKeys: ARROW_DEFAULT_CLEAR_KEYS }),
  property("decorations.path-morphing", "Decoration", "decorate", { candidateKeys: PATH_MORPHING_DECORATION_CLEAR_KEYS }),
  property("shadow-preset", "Shadow", "drop shadow", { candidateKeys: SHADOW_ALL_KEYS }),
  property("node-shape", "Shape", "shape", { candidateKeys: NODE_SHAPE_KNOWN_KEYS, addable: true, addableKind: "nodeShape" }),
  property("node-inner-sep", "Inner sep", "inner sep", { conflictKeys: NODE_INNER_SEP_CLEAR_KEYS, addable: true, addableKind: "length" }),
  property("node-minimum-width", "Minimum width", "minimum width", { conflictKeys: NODE_MINIMUM_DIMENSION_CLEAR_KEYS }),
  property("node-minimum-height", "Minimum height", "minimum height", { conflictKeys: NODE_MINIMUM_DIMENSION_CLEAR_KEYS }),
  property("node-font", "Font", "font", { candidateKeys: ["font", "node font"] }),
  property("node-text-align", "Align", "align", { conflictKeys: ["align"], defaultOmission: "certified" }),
  property("node-text-width", "Text width", "text width", { conflictKeys: ["text width"] }),
  property("stroke-opacity", "Stroke opacity", "draw opacity", { defaultOmission: "certified" }),
  property("fill-opacity", "Fill opacity", "fill opacity", { defaultOmission: "certified" }),
  property("text-opacity", "Text opacity", "text opacity", { defaultOmission: "certified" }),
  property("text", "Text", "text"),
  property("transform.xshift", "X shift", "xshift", { candidateKeys: ["xshift", ...SHIFT_CLEAR_KEYS, ...TRANSFORM_ALIAS_KEYS["transform.xshift"]], addable: true, addableKind: "number", defaultOmission: "certified" }),
  property("transform.yshift", "Y shift", "yshift", { candidateKeys: ["yshift", ...SHIFT_CLEAR_KEYS, ...TRANSFORM_ALIAS_KEYS["transform.yshift"]], addable: true, addableKind: "number", defaultOmission: "certified" }),
  property("transform.xscale", "X scale", "xscale", { candidateKeys: ["xscale", ...SCALE_CLEAR_KEYS, ...TRANSFORM_ALIAS_KEYS["transform.xscale"]], addable: true, addableKind: "number", defaultOmission: "certified" }),
  property("transform.yscale", "Y scale", "yscale", { candidateKeys: ["yscale", ...SCALE_CLEAR_KEYS, ...TRANSFORM_ALIAS_KEYS["transform.yscale"]], addable: true, addableKind: "number", defaultOmission: "certified" }),
  property("transform.rotate", "Rotate", "rotate", { candidateKeys: ["rotate", ...ROTATE_CLEAR_KEYS], addable: true, addableKind: "number", defaultOmission: "certified" }),
  property("grid-step", "Step", "step", { candidateKeys: GRID_STEP_CLEAR_KEYS }),
  property("grid-xstep", "X step", "xstep", { candidateKeys: ["xstep", ...GRID_XSTEP_CLEAR_KEYS] }),
  property("grid-ystep", "Y step", "ystep", { candidateKeys: ["ystep", ...GRID_YSTEP_CLEAR_KEYS] }),
  property("matrix-row-sep", "Row sep", "row sep"),
  property("matrix-column-sep", "Column sep", "column sep"),
  property("matrix-draw-color", "Draw", "draw", { cleanup: ["paint-command"] }),
  property("matrix-fill-color", "Fill", "fill", { cleanup: ["paint-command"] })
] as const;

const STYLE_CONTRIBUTION_PROPERTY_IDS: Partial<Record<keyof ResolvedStyle, readonly SemanticPropertyId[]>> = {
  axisBottomColor: ["fill-axis-bottom-color"],
  axisTopColor: ["fill-axis-top-color"],
  ballColor: ["fill-ball-color"],
  dashArray: ["dash-style"],
  fill: ["fill-color"],
  fillPattern: ["fill-pattern", "fill-mode"],
  lineCap: ["line-cap"],
  lineJoin: ["line-join"],
  lineWidth: ["line-width"],
  patternColor: ["fill-pattern-color"],
  radialInnerColor: ["fill-radial-inner-color"],
  radialOuterColor: ["fill-radial-outer-color"],
  roundedCorners: ["rounded-corners"],
  shadeEnabled: ["fill-mode"],
  shading: ["fill-shading", "fill-mode"],
  shadingAngle: ["fill-mode"],
  stroke: ["stroke-color"],
  textColor: ["node-text-color", "adornment-text-color"]
};

export const PROPERTY_REGISTRY: ReadonlyMap<SemanticPropertyId, PropertySemantics> = new Map(
  PROPERTY_DEFINITIONS.map((definition) => [definition.id, definition])
);

export function getPropertySemantics(propertyId: string | null | undefined): PropertySemantics | null {
  return propertyId && isSemanticPropertyId(propertyId) ? PROPERTY_REGISTRY.get(propertyId) ?? null : null;
}

export function isSemanticPropertyId(value: string): value is SemanticPropertyId {
  return PROPERTY_REGISTRY.has(value as SemanticPropertyId);
}

export function candidateKeysForProperty(propertyId: string | null | undefined): string[] {
  const semantics = resolvePropertySemantics(propertyId);
  if (!semantics) {
    return [];
  }
  return uniqueStrings([
    semantics.primaryKey,
    ...(semantics.aliases ?? []),
    ...(semantics.conflictKeys ?? []),
    ...(semantics.candidateKeys ?? [])
  ]);
}

export function conflictKeysForProperty(propertyId: string | null | undefined): string[] {
  const semantics = resolvePropertySemantics(propertyId);
  return semantics ? uniqueStrings([...(semantics.conflictKeys ?? []), ...(semantics.candidateKeys ?? [])]) : [];
}

export function isDefaultOmissionEligible(propertyId: string | null | undefined): boolean {
  return resolvePropertySemantics(propertyId)?.defaultOmission === "certified";
}

export function propertyCleanupKinds(propertyId: string | null | undefined): readonly PropertyCleanupKind[] {
  return resolvePropertySemantics(propertyId)?.cleanup ?? [];
}

export function isAddableProperty(propertyId: string, kind?: string): boolean {
  const semantics = resolvePropertySemantics(propertyId);
  return Boolean(semantics?.addable && (!kind || semantics.addableKind === kind));
}

export function addablePropertyKind(propertyId: string): string | null {
  return resolvePropertySemantics(propertyId)?.addableKind ?? null;
}

export function propertyIdForOptionEntry(
  entryOrKey: OptionEntry | string,
  availablePropertyIds?: ReadonlySet<string> | readonly string[]
): SemanticPropertyId | null {
  if (typeof entryOrKey !== "string" && entryOrKey.kind === "unknown") {
    return null;
  }
  const key = typeof entryOrKey === "string" ? entryOrKey : entryOrKey.key;
  const normalizedKey = normalizeOptionKey(key);
  const available = normalizeAvailablePropertyIds(availablePropertyIds);
  const firstAvailable = (...ids: SemanticPropertyId[]) => ids.find((id) => available == null || available.has(id)) ?? null;

  switch (normalizedKey) {
    case "xshift":
    case "/tikz/xshift":
      return firstAvailable("transform.xshift");
    case "yshift":
    case "/tikz/yshift":
      return firstAvailable("transform.yshift");
    case "xscale":
    case "/tikz/xscale":
      return firstAvailable("transform.xscale");
    case "yscale":
    case "/tikz/yscale":
      return firstAvailable("transform.yscale");
    case "rotate":
    case "/tikz/rotate":
      return firstAvailable("transform.rotate");
    case "draw":
    case "color":
      return firstAvailable("stroke-color", "matrix-draw-color");
    case "fill":
      return firstAvailable("fill-color", "matrix-fill-color");
    case "line width":
      return firstAvailable("line-width");
    case "solid":
    case "dashed":
    case "densely dashed":
    case "loosely dashed":
    case "dotted":
    case "densely dotted":
    case "loosely dotted":
    case "dash":
    case "dash pattern":
    case "dash phase":
      return firstAvailable("dash-style");
    case "line cap":
      return firstAvailable("line-cap");
    case "line join":
      return firstAvailable("line-join");
    case "shade":
    case "shading":
      return firstAvailable("fill-shading", "fill-mode");
    case "pattern":
      return firstAvailable("fill-pattern", "fill-pattern-option", "fill-mode");
    case "pattern color":
      return firstAvailable("fill-pattern-color");
    case "top color":
      return firstAvailable("fill-axis-top-color");
    case "bottom color":
      return firstAvailable("fill-axis-bottom-color");
    case "inner color":
      return firstAvailable("fill-radial-inner-color");
    case "outer color":
      return firstAvailable("fill-radial-outer-color");
    case "ball color":
      return firstAvailable("fill-ball-color");
    case "rounded corners":
    case "sharp corners":
      return firstAvailable("rounded-corners");
    case "arrows":
    case "-":
    case "->":
    case "<-":
    case "<->":
      return firstAvailable("arrow-tip");
    case "decorate":
    case "decoration":
    case "/tikz/decorate":
    case "/pgf/decoration":
      return firstAvailable("decorations.path-morphing");
    case "shape":
      return firstAvailable("node-shape");
    case "inner sep":
    case "inner xsep":
    case "inner ysep":
      return firstAvailable("node-inner-sep");
    case "minimum width":
      return firstAvailable("node-minimum-width");
    case "minimum height":
      return firstAvailable("node-minimum-height");
    case "font":
    case "node font":
      return firstAvailable("node-font");
    case "text":
    case "text color":
      return firstAvailable("node-text-color", "adornment-text-color", "text");
    case "align":
      return firstAvailable("node-text-align");
    case "text width":
      return firstAvailable("node-text-width");
    case "draw opacity":
      return firstAvailable("stroke-opacity");
    case "fill opacity":
      return firstAvailable("fill-opacity");
    case "text opacity":
      return firstAvailable("text-opacity");
    case "step":
      return firstAvailable("grid-step");
    case "xstep":
    case "x step":
      return firstAvailable("grid-xstep");
    case "ystep":
    case "y step":
      return firstAvailable("grid-ystep");
    case "row sep":
      return firstAvailable("matrix-row-sep");
    case "column sep":
      return firstAvailable("matrix-column-sep");
    default:
      return isSemanticPropertyId(normalizedKey) && (available == null || available.has(normalizedKey))
        ? normalizedKey
        : null;
  }
}

export function propertyIdForStyleContribution(
  key: keyof ResolvedStyle,
  availablePropertyIds?: ReadonlySet<string> | readonly string[]
): SemanticPropertyId | null {
  const available = normalizeAvailablePropertyIds(availablePropertyIds);
  return STYLE_CONTRIBUTION_PROPERTY_IDS[key]?.find((id) => available == null || available.has(id)) ?? null;
}

export function propertyIdForWriteKey(key: string, availablePropertyIds?: ReadonlySet<string> | readonly string[]): SemanticPropertyId | null {
  return propertyIdForOptionEntry(key, availablePropertyIds);
}

export function buildPropertyMutations(context: PropertyWriteContext): PropertyWriteMutation[] {
  const semantics = getPropertySemantics(context.propertyId ?? propertyIdForWriteKey(context.key ?? ""));
  const key = context.key ?? semantics?.primaryKey;
  if (!key) {
    return [];
  }
  return [
    {
      key,
      value: context.value,
      clearKeys: context.clearKeys ? uniqueStrings(context.clearKeys) : undefined,
      propertyId: semantics?.id
    }
  ];
}

export function uniqueStrings(values: readonly string[]): string[] {
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

function property(
  id: SemanticPropertyId,
  label: string,
  primaryKey: string,
  options: Omit<PropertySemantics, "id" | "label" | "primaryKey"> = {}
): PropertySemantics {
  return {
    id,
    label,
    primaryKey,
    defaultOmission: "never",
    ...options
  };
}

function normalizeAvailablePropertyIds(
  availablePropertyIds: ReadonlySet<string> | readonly string[] | undefined
): ReadonlySet<string> | null {
  if (!availablePropertyIds) {
    return null;
  }
  return "has" in availablePropertyIds ? availablePropertyIds : new Set(availablePropertyIds);
}

function resolvePropertySemantics(propertyIdOrKey: string | null | undefined): PropertySemantics | null {
  const direct = getPropertySemantics(propertyIdOrKey);
  if (direct || !propertyIdOrKey) {
    return direct;
  }
  const resolvedId = propertyIdForWriteKey(propertyIdOrKey);
  return resolvedId ? getPropertySemantics(resolvedId) : null;
}
