import { parseLength } from "../coords/parse-length.js";
import type { Point } from "../types.js";
import type { OptionListAst } from "../../options/types.js";
import { parseCoordinate } from "../../domains/coordinates/parse.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import type { SemanticContext } from "../context.js";
import { normalizeOptionValue } from "./utils.js";

export type ShapeGeometryParams = {
  diamondAspect: number;
  isoscelesTriangleApexAngle: number;
  isoscelesTriangleStretches: boolean;
  kiteUpperVertexAngle: number;
  kiteLowerVertexAngle: number;
  dartTipAngle: number;
  dartTailAngle: number;
  circularSectorAngle: number;
  cylinderAspect: number;
  cloudPuffs: number;
  cloudPuffArc: number;
  cloudIgnoresAspect: boolean;
  starburstPoints: number;
  starburstPointHeightPt: number;
  randomStarburstSeed: number;
  signalPointerAngle: number;
  signalToSides: SignalDirection[];
  signalFromSides: SignalDirection[];
  tapeBendTop: TapeBendStyle;
  tapeBendBottom: TapeBendStyle;
  tapeBendHeightPt: number;
  calloutPointerIsAbsolute: boolean;
  calloutRelativePointerRaw: string;
  calloutAbsolutePointerRaw: string | null;
  calloutPointerShortenPt: number;
  calloutPointerWidthPt: number;
  calloutPointerArc: number;
  calloutPointerStartSizeRaw: string;
  calloutPointerEndSizeRaw: string;
  calloutPointerSegments: number;
  singleArrowTipAngle: number;
  singleArrowHeadExtendPt: number;
  singleArrowHeadIndentPt: number;
  doubleArrowTipAngle: number;
  doubleArrowHeadExtendPt: number;
  doubleArrowHeadIndentPt: number;
  trapeziumLeftAngle: number;
  trapeziumRightAngle: number;
  shapeBorderRotate: number;
  trapeziumStretches: boolean;
  trapeziumStretchesBody: boolean;
  regularPolygonSides: number;
  starPoints: number;
  starPointRatio: number;
  starPointHeightPt: number;
  starUsesPointRatio: boolean;
};

export type TrapeziumSizingInput = {
  naturalHalfWidth: number;
  naturalHalfHeight: number;
  minimumWidth: number;
  minimumHeight: number;
};

export type CircularSizingInput = {
  naturalWidth: number;
  naturalHeight: number;
  minimumWidth: number;
  minimumHeight: number;
};

export type SignalDirection = "north" | "south" | "east" | "west";
export type TapeBendStyle = "in and out" | "out and in" | "none";

export type SemicircleGeometry = {
  center: Point;
  radius: number;
  rotation: number;
  apex: Point;
  arcStart: Point;
  arcEnd: Point;
  chordCenter: Point;
  polygon: Point[];
};

export type CircularSectorGeometry = {
  sectorCenter: Point;
  arcStart: Point;
  arcEnd: Point;
  arcCenter: Point;
  radius: number;
  rotation: number;
  polygon: Point[];
};

export type CylinderGeometry = {
  shapeCenter: Point;
  beforeTop: Point;
  top: Point;
  afterTop: Point;
  beforeBottom: Point;
  bottom: Point;
  afterBottom: Point;
  polygon: Point[];
};

export type CloudGeometry = {
  polygon: Point[];
  puffs: Point[];
};

export type StarburstGeometry = {
  polygon: Point[];
  outer: Point[];
  inner: Point[];
};

export type SignalGeometry = {
  polygon: Point[];
};

export type TapeGeometry = {
  polygon: Point[];
};

export type RectangleCalloutGeometry = {
  polygon: Point[];
  pointer: Point;
  pointerAnchor: Point;
};

export type EllipseCalloutGeometry = {
  polygon: Point[];
  pointer: Point;
  pointerAnchor: Point;
};

export type CloudCalloutGeometry = {
  polygon: Point[];
  pointerPolygon: Point[];
  pointer: Point;
  pointerAnchor: Point;
  puffs: Point[];
};

export type SingleArrowGeometry = {
  polygon: Point[];
  tip: Point;
  beforeTip: Point;
  afterTip: Point;
  beforeHead: Point;
  afterHead: Point;
  beforeTail: Point;
  afterTail: Point;
  tail: Point;
};

export type DoubleArrowGeometry = {
  polygon: Point[];
  tip1: Point;
  beforeTip1: Point;
  afterTip1: Point;
  beforeHead1: Point;
  afterHead1: Point;
  tip2: Point;
  beforeTip2: Point;
  afterTip2: Point;
  beforeHead2: Point;
  afterHead2: Point;
};

const DEFAULT_DIAMOND_ASPECT = 1;
const DEFAULT_ISOSCELES_TRIANGLE_APEX_ANGLE = 45;
const DEFAULT_KITE_UPPER_VERTEX_ANGLE = 120;
const DEFAULT_KITE_LOWER_VERTEX_ANGLE = 60;
const DEFAULT_DART_TIP_ANGLE = 45;
const DEFAULT_DART_TAIL_ANGLE = 135;
const DEFAULT_CIRCULAR_SECTOR_ANGLE = 60;
const DEFAULT_CYLINDER_ASPECT = 1;
const DEFAULT_CLOUD_PUFFS = 10;
const DEFAULT_CLOUD_PUFF_ARC = 150;
const DEFAULT_CLOUD_IGNORES_ASPECT = false;
const DEFAULT_STARBURST_POINTS = 17;
const DEFAULT_STARBURST_POINT_HEIGHT_PT = parseLength(".5cm", "pt") ?? 14.2264;
const DEFAULT_RANDOM_STARBURST_SEED = 100;
const DEFAULT_SIGNAL_POINTER_ANGLE = 90;
const DEFAULT_TAPE_BEND_STYLE: TapeBendStyle = "in and out";
const DEFAULT_TAPE_BEND_HEIGHT_PT = parseLength("5pt", "pt") ?? 5;
const DEFAULT_CALLOUT_RELATIVE_POINTER_RAW = "(315:.5cm)";
const DEFAULT_CALLOUT_POINTER_SHORTEN_PT = 0;
const DEFAULT_CALLOUT_POINTER_WIDTH_PT = parseLength(".25cm", "pt") ?? 7.1132;
const DEFAULT_CALLOUT_POINTER_ARC = 15;
const DEFAULT_CALLOUT_POINTER_START_SIZE_RAW = ".2 of callout";
const DEFAULT_CALLOUT_POINTER_END_SIZE_RAW = ".1 of callout";
const DEFAULT_CALLOUT_POINTER_SEGMENTS = 2;
const DEFAULT_SINGLE_ARROW_TIP_ANGLE = 90;
const DEFAULT_SINGLE_ARROW_HEAD_EXTEND_PT = parseLength(".5cm", "pt") ?? 14.2264;
const DEFAULT_SINGLE_ARROW_HEAD_INDENT_PT = 0;
const DEFAULT_DOUBLE_ARROW_TIP_ANGLE = 90;
const DEFAULT_DOUBLE_ARROW_HEAD_EXTEND_PT = parseLength(".5cm", "pt") ?? 14.2264;
const DEFAULT_DOUBLE_ARROW_HEAD_INDENT_PT = 0;
const DEFAULT_TRAPEZIUM_ANGLE = 60;
const DEFAULT_SHAPE_BORDER_ROTATE = 0;
const DEFAULT_REGULAR_POLYGON_SIDES = 5;
const DEFAULT_STAR_POINTS = 5;
const DEFAULT_STAR_RATIO = 1.5;
const DEFAULT_STAR_POINT_HEIGHT_PT = parseLength(".5cm", "pt") ?? 14.2264;
const EPSILON = 1e-9;

export function resolveNodeShapeGeometryParams(options: OptionListAst | undefined): ShapeGeometryParams {
  let diamondAspect = DEFAULT_DIAMOND_ASPECT;
  let isoscelesTriangleApexAngle = DEFAULT_ISOSCELES_TRIANGLE_APEX_ANGLE;
  let isoscelesTriangleStretches = false;
  let kiteUpperVertexAngle = DEFAULT_KITE_UPPER_VERTEX_ANGLE;
  let kiteLowerVertexAngle = DEFAULT_KITE_LOWER_VERTEX_ANGLE;
  let dartTipAngle = DEFAULT_DART_TIP_ANGLE;
  let dartTailAngle = DEFAULT_DART_TAIL_ANGLE;
  let circularSectorAngle = DEFAULT_CIRCULAR_SECTOR_ANGLE;
  let cylinderAspect = DEFAULT_CYLINDER_ASPECT;
  let cloudPuffs = DEFAULT_CLOUD_PUFFS;
  let cloudPuffArc = DEFAULT_CLOUD_PUFF_ARC;
  let cloudIgnoresAspect = DEFAULT_CLOUD_IGNORES_ASPECT;
  let starburstPoints = DEFAULT_STARBURST_POINTS;
  let starburstPointHeightPt = DEFAULT_STARBURST_POINT_HEIGHT_PT;
  let randomStarburstSeed = DEFAULT_RANDOM_STARBURST_SEED;
  let signalPointerAngle = DEFAULT_SIGNAL_POINTER_ANGLE;
  let signalToSides: SignalDirection[] = ["east"];
  let signalFromSides: SignalDirection[] = [];
  let tapeBendTop: TapeBendStyle = DEFAULT_TAPE_BEND_STYLE;
  let tapeBendBottom: TapeBendStyle = DEFAULT_TAPE_BEND_STYLE;
  let tapeBendHeightPt = DEFAULT_TAPE_BEND_HEIGHT_PT;
  let calloutPointerIsAbsolute = false;
  let calloutRelativePointerRaw = DEFAULT_CALLOUT_RELATIVE_POINTER_RAW;
  let calloutAbsolutePointerRaw: string | null = null;
  let calloutPointerShortenPt = DEFAULT_CALLOUT_POINTER_SHORTEN_PT;
  let calloutPointerWidthPt = DEFAULT_CALLOUT_POINTER_WIDTH_PT;
  let calloutPointerArc = DEFAULT_CALLOUT_POINTER_ARC;
  let calloutPointerStartSizeRaw = DEFAULT_CALLOUT_POINTER_START_SIZE_RAW;
  let calloutPointerEndSizeRaw = DEFAULT_CALLOUT_POINTER_END_SIZE_RAW;
  let calloutPointerSegments = DEFAULT_CALLOUT_POINTER_SEGMENTS;
  let singleArrowTipAngle = DEFAULT_SINGLE_ARROW_TIP_ANGLE;
  let singleArrowHeadExtendPt = DEFAULT_SINGLE_ARROW_HEAD_EXTEND_PT;
  let singleArrowHeadIndentPt = DEFAULT_SINGLE_ARROW_HEAD_INDENT_PT;
  let doubleArrowTipAngle = DEFAULT_DOUBLE_ARROW_TIP_ANGLE;
  let doubleArrowHeadExtendPt = DEFAULT_DOUBLE_ARROW_HEAD_EXTEND_PT;
  let doubleArrowHeadIndentPt = DEFAULT_DOUBLE_ARROW_HEAD_INDENT_PT;
  let trapeziumLeftAngle = DEFAULT_TRAPEZIUM_ANGLE;
  let trapeziumRightAngle = DEFAULT_TRAPEZIUM_ANGLE;
  let shapeBorderRotate = DEFAULT_SHAPE_BORDER_ROTATE;
  let trapeziumStretches = false;
  let trapeziumStretchesBody = false;
  let regularPolygonSides = DEFAULT_REGULAR_POLYGON_SIDES;
  let starPoints = DEFAULT_STAR_POINTS;
  let starPointRatio = DEFAULT_STAR_RATIO;
  let starPointHeightPt = DEFAULT_STAR_POINT_HEIGHT_PT;
  let starUsesPointRatio = true;

  if (!options) {
    return {
      diamondAspect,
      isoscelesTriangleApexAngle,
      isoscelesTriangleStretches,
      kiteUpperVertexAngle,
      kiteLowerVertexAngle,
      dartTipAngle,
      dartTailAngle,
      circularSectorAngle,
      cylinderAspect,
      cloudPuffs,
      cloudPuffArc,
      cloudIgnoresAspect,
      starburstPoints,
      starburstPointHeightPt,
      randomStarburstSeed,
      signalPointerAngle,
      signalToSides,
      signalFromSides,
      tapeBendTop,
      tapeBendBottom,
      tapeBendHeightPt,
      calloutPointerIsAbsolute,
      calloutRelativePointerRaw,
      calloutAbsolutePointerRaw,
      calloutPointerShortenPt,
      calloutPointerWidthPt,
      calloutPointerArc,
      calloutPointerStartSizeRaw,
      calloutPointerEndSizeRaw,
      calloutPointerSegments,
      singleArrowTipAngle,
      singleArrowHeadExtendPt,
      singleArrowHeadIndentPt,
      doubleArrowTipAngle,
      doubleArrowHeadExtendPt,
      doubleArrowHeadIndentPt,
      trapeziumLeftAngle,
      trapeziumRightAngle,
      shapeBorderRotate,
      trapeziumStretches,
      trapeziumStretchesBody,
      regularPolygonSides,
      starPoints,
      starPointRatio,
      starPointHeightPt,
      starUsesPointRatio
    };
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "trapezium stretches") {
        trapeziumStretches = true;
      } else if (entry.key === "trapezium stretches body") {
        trapeziumStretchesBody = true;
      } else if (entry.key === "isosceles triangle stretches") {
        isoscelesTriangleStretches = true;
      } else if (entry.key === "cloud ignores aspect") {
        cloudIgnoresAspect = true;
      } else if (entry.key === "random starburst") {
        randomStarburstSeed = Math.floor(Math.random() * 0x7fffffff) + 1;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "aspect" || entry.key === "shape aspect") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        diamondAspect = normalizeAspect(parsed);
        cylinderAspect = normalizeAspect(parsed);
      }
      continue;
    }

    if (entry.key === "isosceles triangle apex angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        isoscelesTriangleApexAngle = normalizeAcuteAngle(parsed, DEFAULT_ISOSCELES_TRIANGLE_APEX_ANGLE);
      }
      continue;
    }

    if (entry.key === "isosceles triangle stretches") {
      const parsed = parseBoolishOption(entry.valueRaw);
      if (parsed != null) {
        isoscelesTriangleStretches = parsed;
      }
      continue;
    }

    if (entry.key === "kite upper vertex angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        kiteUpperVertexAngle = normalizeAcuteAngle(parsed, DEFAULT_KITE_UPPER_VERTEX_ANGLE);
      }
      continue;
    }

    if (entry.key === "kite lower vertex angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        kiteLowerVertexAngle = normalizeAcuteAngle(parsed, DEFAULT_KITE_LOWER_VERTEX_ANGLE);
      }
      continue;
    }

    if (entry.key === "kite vertex angles") {
      const parsed = parseKiteVertexAngles(entry.valueRaw);
      if (parsed) {
        kiteUpperVertexAngle = normalizeAcuteAngle(parsed.upper, DEFAULT_KITE_UPPER_VERTEX_ANGLE);
        kiteLowerVertexAngle = normalizeAcuteAngle(parsed.lower, DEFAULT_KITE_LOWER_VERTEX_ANGLE);
      }
      continue;
    }

    if (entry.key === "dart tip angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        dartTipAngle = normalizeAcuteAngle(parsed, DEFAULT_DART_TIP_ANGLE);
      }
      continue;
    }

    if (entry.key === "dart tail angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        dartTailAngle = normalizeTailAngle(parsed);
      }
      continue;
    }

    if (entry.key === "circular sector angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        circularSectorAngle = normalizeSectorAngle(parsed);
      }
      continue;
    }

    if (entry.key === "cloud puffs") {
      const parsed = parseIntegerOption(entry.valueRaw);
      if (parsed != null) {
        cloudPuffs = normalizeInteger(parsed, 2, 360, DEFAULT_CLOUD_PUFFS);
      }
      continue;
    }

    if (entry.key === "cloud puff arc") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        cloudPuffArc = normalizeCloudPuffArc(parsed);
      }
      continue;
    }

    if (entry.key === "cloud ignores aspect") {
      const parsed = parseBoolishOption(entry.valueRaw);
      if (parsed != null) {
        cloudIgnoresAspect = parsed;
      }
      continue;
    }

    if (entry.key === "starburst points") {
      const parsed = parseIntegerOption(entry.valueRaw);
      if (parsed != null) {
        starburstPoints = normalizeInteger(parsed, 2, 360, DEFAULT_STARBURST_POINTS);
      }
      continue;
    }

    if (entry.key === "starburst point height") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        starburstPointHeightPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "random starburst") {
      const parsed = parseRandomStarburstOption(entry.valueRaw);
      if (parsed != null) {
        randomStarburstSeed = parsed;
      }
      continue;
    }

    if (entry.key === "signal pointer angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        signalPointerAngle = normalizeSignalPointerAngle(parsed);
      }
      continue;
    }

    if (entry.key === "signal to") {
      signalToSides = parseSignalDirectionSpec(entry.valueRaw);
      continue;
    }

    if (entry.key === "signal from") {
      signalFromSides = parseSignalDirectionSpec(entry.valueRaw);
      continue;
    }

    if (entry.key === "tape bend top") {
      tapeBendTop = parseTapeBendStyle(entry.valueRaw, DEFAULT_TAPE_BEND_STYLE);
      continue;
    }

    if (entry.key === "tape bend bottom") {
      tapeBendBottom = parseTapeBendStyle(entry.valueRaw, DEFAULT_TAPE_BEND_STYLE);
      continue;
    }

    if (entry.key === "tape bend") {
      const style = parseTapeBendStyle(entry.valueRaw, DEFAULT_TAPE_BEND_STYLE);
      tapeBendTop = style;
      tapeBendBottom = style;
      continue;
    }

    if (entry.key === "tape bend height") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        tapeBendHeightPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "callout relative pointer") {
      const normalized = normalizeOptionValue(entry.valueRaw);
      if (normalized.length > 0) {
        calloutPointerIsAbsolute = false;
        calloutRelativePointerRaw = normalized;
      }
      continue;
    }

    if (entry.key === "callout absolute pointer") {
      const normalized = normalizeOptionValue(entry.valueRaw);
      if (normalized.length > 0) {
        calloutPointerIsAbsolute = true;
        calloutAbsolutePointerRaw = normalized;
      }
      continue;
    }

    if (entry.key === "callout pointer shorten") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        calloutPointerShortenPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "callout pointer width") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        calloutPointerWidthPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "callout pointer arc") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        calloutPointerArc = normalizeCalloutPointerArc(parsed);
      }
      continue;
    }

    if (entry.key === "callout pointer start size") {
      const normalized = normalizeOptionValue(entry.valueRaw);
      if (normalized.length > 0) {
        calloutPointerStartSizeRaw = normalized;
      }
      continue;
    }

    if (entry.key === "callout pointer end size") {
      const normalized = normalizeOptionValue(entry.valueRaw);
      if (normalized.length > 0) {
        calloutPointerEndSizeRaw = normalized;
      }
      continue;
    }

    if (entry.key === "callout pointer segments") {
      const parsed = parseIntegerOption(entry.valueRaw);
      if (parsed != null) {
        calloutPointerSegments = normalizeInteger(parsed, 1, 128, DEFAULT_CALLOUT_POINTER_SEGMENTS);
      }
      continue;
    }

    if (entry.key === "single arrow tip angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        singleArrowTipAngle = normalizeArrowTipAngle(parsed, DEFAULT_SINGLE_ARROW_TIP_ANGLE);
      }
      continue;
    }

    if (entry.key === "single arrow head extend") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        singleArrowHeadExtendPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "single arrow head indent") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        singleArrowHeadIndentPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "double arrow tip angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        doubleArrowTipAngle = normalizeArrowTipAngle(parsed, DEFAULT_DOUBLE_ARROW_TIP_ANGLE);
      }
      continue;
    }

    if (entry.key === "double arrow head extend") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        doubleArrowHeadExtendPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "double arrow head indent") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        doubleArrowHeadIndentPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "trapezium angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        const normalized = normalizeAngle(parsed);
        trapeziumLeftAngle = normalized;
        trapeziumRightAngle = normalized;
      }
      continue;
    }

    if (entry.key === "trapezium left angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        trapeziumLeftAngle = normalizeAngle(parsed);
      }
      continue;
    }

    if (entry.key === "trapezium right angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        trapeziumRightAngle = normalizeAngle(parsed);
      }
      continue;
    }

    if (entry.key === "shape border rotate" || entry.key === "regular polygon rotate" || entry.key === "star rotate") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        shapeBorderRotate = parsed;
      }
      continue;
    }

    if (entry.key === "trapezium stretches") {
      const parsed = parseBoolishOption(entry.valueRaw);
      if (parsed != null) {
        trapeziumStretches = parsed;
      }
      continue;
    }

    if (entry.key === "trapezium stretches body") {
      const parsed = parseBoolishOption(entry.valueRaw);
      if (parsed != null) {
        trapeziumStretchesBody = parsed;
      }
      continue;
    }

    if (entry.key === "regular polygon sides") {
      const parsed = parseIntegerOption(entry.valueRaw);
      if (parsed != null) {
        regularPolygonSides = normalizeInteger(parsed, 3, 360, DEFAULT_REGULAR_POLYGON_SIDES);
      }
      continue;
    }

    if (entry.key === "star points") {
      const parsed = parseIntegerOption(entry.valueRaw);
      if (parsed != null) {
        starPoints = normalizeInteger(parsed, 2, 360, DEFAULT_STAR_POINTS);
      }
      continue;
    }

    if (entry.key === "star point ratio") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        starPointRatio = normalizeRatio(parsed);
        starUsesPointRatio = true;
      }
      continue;
    }

    if (entry.key === "star point height") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        starPointHeightPt = Math.max(0, parsedLength);
        starUsesPointRatio = false;
      }
    }
  }

  return {
    diamondAspect,
    isoscelesTriangleApexAngle,
    isoscelesTriangleStretches,
    kiteUpperVertexAngle,
    kiteLowerVertexAngle,
    dartTipAngle,
    dartTailAngle,
    circularSectorAngle,
    cylinderAspect,
    cloudPuffs,
    cloudPuffArc,
    cloudIgnoresAspect,
    starburstPoints,
    starburstPointHeightPt,
    randomStarburstSeed,
    signalPointerAngle,
    signalToSides,
    signalFromSides,
    tapeBendTop,
    tapeBendBottom,
    tapeBendHeightPt,
    calloutPointerIsAbsolute,
    calloutRelativePointerRaw,
    calloutAbsolutePointerRaw,
    calloutPointerShortenPt,
    calloutPointerWidthPt,
    calloutPointerArc,
    calloutPointerStartSizeRaw,
    calloutPointerEndSizeRaw,
    calloutPointerSegments,
    singleArrowTipAngle,
    singleArrowHeadExtendPt,
    singleArrowHeadIndentPt,
    doubleArrowTipAngle,
    doubleArrowHeadExtendPt,
    doubleArrowHeadIndentPt,
    trapeziumLeftAngle,
    trapeziumRightAngle,
    shapeBorderRotate,
    trapeziumStretches,
    trapeziumStretchesBody,
    regularPolygonSides,
    starPoints,
    starPointRatio,
    starPointHeightPt,
    starUsesPointRatio
  };
}

export function makeDiamondPolygon(halfWidth: number, halfHeight: number, aspect: number): Point[] {
  const safeHalfWidth = Math.max(0, halfWidth);
  const safeHalfHeight = Math.max(0, halfHeight);
  const safeAspect = normalizeAspect(aspect);
  const horizontalRadius = safeHalfWidth + safeAspect * safeHalfHeight;
  const verticalRadius = safeHalfWidth / safeAspect + safeHalfHeight;
  return [
    { x: 0, y: verticalRadius },
    { x: horizontalRadius, y: 0 },
    { x: 0, y: -verticalRadius },
    { x: -horizontalRadius, y: 0 }
  ];
}

export function makeIsoscelesTrianglePolygon(
  sizing: CircularSizingInput,
  apexAngleRaw: number,
  rotation: number,
  stretches: boolean
): Point[] {
  const apexAngle = normalizeAcuteAngle(apexAngleRaw, DEFAULT_ISOSCELES_TRIANGLE_APEX_ANGLE);
  const halfAngleRadians = toRadians(apexAngle / 2);
  const tangent = Math.tan(halfAngleRadians);
  const safeTangent = Number.isFinite(tangent) && Math.abs(tangent) > EPSILON ? Math.abs(tangent) : 1;
  const targetHalfWidth = Math.max(0, Math.max(sizing.naturalWidth, sizing.minimumWidth) / 2);
  const targetHalfHeight = Math.max(0, Math.max(sizing.naturalHeight, sizing.minimumHeight) / 2);

  let halfWidth = targetHalfWidth;
  let halfHeight = targetHalfHeight;
  if (!stretches) {
    halfHeight = Math.max(targetHalfHeight, EPSILON);
    halfWidth = halfHeight * safeTangent;
    if (halfWidth + EPSILON < targetHalfWidth) {
      halfWidth = targetHalfWidth;
      halfHeight = halfWidth / safeTangent;
    }
    if (halfHeight + EPSILON < targetHalfHeight) {
      halfHeight = targetHalfHeight;
      halfWidth = halfHeight * safeTangent;
    }
  }

  const polygon = [
    { x: 0, y: halfHeight },
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight }
  ];
  return rotatePolygon(polygon, rotation);
}

export function makeKitePolygon(
  sizing: CircularSizingInput,
  upperAngleRaw: number,
  lowerAngleRaw: number,
  rotation: number
): Point[] {
  const upperAngle = normalizeAcuteAngle(upperAngleRaw, DEFAULT_KITE_UPPER_VERTEX_ANGLE);
  const lowerAngle = normalizeAcuteAngle(lowerAngleRaw, DEFAULT_KITE_LOWER_VERTEX_ANGLE);
  const targetWidth = Math.max(0, Math.max(sizing.naturalWidth, sizing.minimumWidth));
  const targetHeight = Math.max(0, Math.max(sizing.naturalHeight, sizing.minimumHeight));
  const halfWidth = Math.max(targetWidth / 2, EPSILON);

  const upperTan = Math.tan(toRadians(upperAngle / 2));
  const lowerTan = Math.tan(toRadians(lowerAngle / 2));
  const safeUpperTan = Number.isFinite(upperTan) && Math.abs(upperTan) > EPSILON ? Math.abs(upperTan) : 1;
  const safeLowerTan = Number.isFinite(lowerTan) && Math.abs(lowerTan) > EPSILON ? Math.abs(lowerTan) : 1;
  let topHeight = halfWidth / safeUpperTan;
  let bottomHeight = halfWidth / safeLowerTan;

  const totalHeight = topHeight + bottomHeight;
  if (totalHeight + EPSILON < targetHeight) {
    const scale = targetHeight / Math.max(totalHeight, EPSILON);
    topHeight *= scale;
    bottomHeight *= scale;
  }

  const polygon = [
    { x: 0, y: topHeight },
    { x: -halfWidth, y: 0 },
    { x: 0, y: -bottomHeight },
    { x: halfWidth, y: 0 }
  ];
  return rotatePolygon(polygon, rotation);
}

export function makeDartPolygon(
  sizing: CircularSizingInput,
  tipAngleRaw: number,
  tailAngleRaw: number,
  rotation: number
): Point[] {
  const tipAngle = normalizeAcuteAngle(tipAngleRaw, DEFAULT_DART_TIP_ANGLE);
  const tailAngle = normalizeTailAngle(tailAngleRaw);
  const targetWidth = Math.max(0, Math.max(sizing.naturalWidth, sizing.minimumWidth));
  const targetHeight = Math.max(0, Math.max(sizing.naturalHeight, sizing.minimumHeight));

  let halfHeight = Math.max(targetHeight / 2, EPSILON);
  let tipDistance = halfHeight / Math.max(Math.tan(toRadians(tipAngle / 2)), EPSILON);
  let tailDistance = halfHeight / Math.max(Math.tan(toRadians(tailAngle / 2)), EPSILON);

  if (tipDistance + EPSILON < targetWidth) {
    const scale = targetWidth / Math.max(tipDistance, EPSILON);
    halfHeight *= scale;
    tipDistance = halfHeight / Math.max(Math.tan(toRadians(tipAngle / 2)), EPSILON);
    tailDistance = halfHeight / Math.max(Math.tan(toRadians(tailAngle / 2)), EPSILON);
  }

  const leftX = -tipDistance / 2;
  const tipX = tipDistance / 2;
  const tailCenterX = Math.min(tipX - 1e-3, leftX + Math.max(0, tailDistance));

  const polygon = [
    { x: tipX, y: 0 },
    { x: leftX, y: halfHeight },
    { x: tailCenterX, y: 0 },
    { x: leftX, y: -halfHeight }
  ];
  return rotatePolygon(polygon, rotation);
}

export function makeTrapeziumPolygon(
  sizing: TrapeziumSizingInput,
  leftAngle: number,
  rightAngle: number,
  rotation: number,
  stretches: boolean,
  stretchesBody: boolean
): Point[] {
  const resolved = resolveTrapeziumDimensions(
    sizing.naturalHalfWidth,
    sizing.naturalHalfHeight,
    sizing.minimumWidth,
    sizing.minimumHeight,
    leftAngle,
    rightAngle,
    stretches,
    stretchesBody
  );

  const polygon = [
    {
      x: -resolved.halfWidth - Math.max(resolved.leftExtension, 0),
      y: -resolved.halfHeight
    },
    {
      x: -resolved.halfWidth + Math.min(resolved.leftExtension, 0),
      y: resolved.halfHeight
    },
    {
      x: resolved.halfWidth - Math.min(resolved.rightExtension, 0),
      y: resolved.halfHeight
    },
    {
      x: resolved.halfWidth + Math.max(resolved.rightExtension, 0),
      y: -resolved.halfHeight
    }
  ];

  if (Math.abs(rotation) <= 1e-6) {
    return polygon;
  }

  return polygon.map((point) => rotatePoint(point, rotation));
}

export function makeRegularPolygon(
  sizing: CircularSizingInput,
  sidesRaw: number,
  rotation: number
): Point[] {
  const sides = normalizeInteger(Math.round(sidesRaw), 3, 360, DEFAULT_REGULAR_POLYGON_SIDES);
  const diagonalHalf = Math.hypot(sizing.naturalWidth / 2, sizing.naturalHeight / 2);
  const minRadius = Math.max(sizing.minimumWidth, sizing.minimumHeight) / 2;
  const cosine = Math.cos(Math.PI / sides);
  const circumRadius = cosine <= 1e-6 ? minRadius : Math.max(diagonalHalf / cosine, minRadius);
  const startAngle = regularPolygonStartAngle(sides, rotation);

  const vertices: Point[] = [];
  const step = 360 / sides;
  for (let index = 0; index < sides; index += 1) {
    vertices.push(pointPolar(startAngle + index * step, circumRadius));
  }
  return vertices;
}

export function makeStar(
  sizing: CircularSizingInput,
  pointsRaw: number,
  ratioRaw: number,
  pointHeightPt: number,
  useRatio: boolean,
  rotation: number
): { polygon: Point[]; outer: Point[]; inner: Point[] } {
  const points = normalizeInteger(Math.round(pointsRaw), 2, 360, DEFAULT_STAR_POINTS);
  const safeRatio = normalizeRatio(ratioRaw);
  const innerBase = Math.hypot(sizing.naturalWidth / 2, sizing.naturalHeight / 2);
  const safeHeight = Math.max(0, pointHeightPt);

  let innerRadius = innerBase;
  let outerRadius = useRatio ? innerRadius * safeRatio : innerRadius + safeHeight;

  const minRadius = Math.max(sizing.minimumWidth, sizing.minimumHeight) / 2;
  if (outerRadius < minRadius) {
    outerRadius = minRadius;
    innerRadius = useRatio ? outerRadius / safeRatio : Math.max(0, outerRadius - safeHeight);
  }

  const startAngle = 90 + rotation;
  const step = 180 / points;
  const polygon: Point[] = [];
  const outer: Point[] = [];
  const inner: Point[] = [];

  for (let index = 0; index < points; index += 1) {
    const outerAngle = startAngle + index * 2 * step;
    const innerAngle = outerAngle + step;
    const outerPoint = pointPolar(outerAngle, outerRadius);
    const innerPoint = pointPolar(innerAngle, innerRadius);
    outer.push(outerPoint);
    inner.push(innerPoint);
    polygon.push(outerPoint, innerPoint);
  }

  return { polygon, outer, inner };
}

export function makeSemicircle(
  sizing: CircularSizingInput,
  rotation: number,
  outerSep: number,
  sampleSteps = 48
): SemicircleGeometry {
  const safeNaturalWidth = Math.max(0, sizing.naturalWidth);
  const safeNaturalHeight = Math.max(0, sizing.naturalHeight);
  const safeMinimumWidth = Math.max(0, sizing.minimumWidth);
  const safeMinimumHeight = Math.max(0, sizing.minimumHeight);

  const halfWidth = safeNaturalWidth / 2;
  const halfHeight = safeNaturalHeight / 2;
  const defaultRadius = Math.hypot(halfWidth, 2 * halfHeight);
  const radiusBase = Math.max(defaultRadius, safeMinimumWidth / 2, safeMinimumHeight);
  const adjustment = 0.4 * (radiusBase - defaultRadius);
  const centerY = -(adjustment + halfHeight);

  const safeOuterSep = Math.max(0, outerSep);
  const anchorRadius = radiusBase + safeOuterSep;
  const chordY = centerY - safeOuterSep;

  const centerUnrotated = { x: 0, y: centerY };
  const apexUnrotated = { x: 0, y: centerY + anchorRadius };
  const arcStartUnrotated = { x: anchorRadius, y: chordY };
  const arcEndUnrotated = { x: -anchorRadius, y: chordY };
  const chordCenterUnrotated = { x: 0, y: chordY };

  const polygonUnrotated: Point[] = [];
  const steps = Math.max(8, sampleSteps);
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const angle = t * Math.PI;
    polygonUnrotated.push({
      x: anchorRadius * Math.cos(angle),
      y: centerY + anchorRadius * Math.sin(angle)
    });
  }
  polygonUnrotated.push(arcEndUnrotated, arcStartUnrotated);

  const center = rotatePoint(centerUnrotated, rotation);
  const apex = rotatePoint(apexUnrotated, rotation);
  const arcStart = rotatePoint(arcStartUnrotated, rotation);
  const arcEnd = rotatePoint(arcEndUnrotated, rotation);
  const chordCenter = rotatePoint(chordCenterUnrotated, rotation);
  const polygon = polygonUnrotated.map((point) => rotatePoint(point, rotation));

  return {
    center,
    radius: anchorRadius,
    rotation,
    apex,
    arcStart,
    arcEnd,
    chordCenter,
    polygon
  };
}

export function makeCircularSector(
  sizing: CircularSizingInput,
  sectorAngleRaw: number,
  rotation: number,
  outerSep: number,
  sampleSteps = 48
): CircularSectorGeometry {
  const sectorAngle = normalizeSectorAngle(sectorAngleRaw);
  const halfAngle = sectorAngle / 2;
  const sineHalfAngle = Math.sin(toRadians(halfAngle));
  const safeSine = Math.max(Math.abs(sineHalfAngle), 1e-3);
  const targetWidth = Math.max(0, Math.max(sizing.naturalWidth, sizing.minimumWidth));
  const targetHeight = Math.max(0, Math.max(sizing.naturalHeight, sizing.minimumHeight));
  const baseRadius = Math.max(targetWidth, targetHeight / (2 * safeSine), EPSILON);
  const safeOuterSep = Math.max(0, outerSep);
  const radius = baseRadius + safeOuterSep;
  const sectorCenterUnrotated = { x: radius / 2, y: 0 };
  const arcCenterUnrotated = { x: sectorCenterUnrotated.x - radius, y: 0 };
  const startAngle = 180 - halfAngle;
  const endAngle = 180 + halfAngle;
  const arcStartUnrotated = pointPolarOffset(startAngle, radius, sectorCenterUnrotated);
  const arcEndUnrotated = pointPolarOffset(endAngle, radius, sectorCenterUnrotated);

  const polygonUnrotated: Point[] = [sectorCenterUnrotated];
  const steps = Math.max(8, sampleSteps);
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    polygonUnrotated.push(pointPolarOffset(startAngle + sectorAngle * t, radius, sectorCenterUnrotated));
  }

  return {
    sectorCenter: rotatePoint(sectorCenterUnrotated, rotation),
    arcStart: rotatePoint(arcStartUnrotated, rotation),
    arcEnd: rotatePoint(arcEndUnrotated, rotation),
    arcCenter: rotatePoint(arcCenterUnrotated, rotation),
    radius,
    rotation,
    polygon: polygonUnrotated.map((point) => rotatePoint(point, rotation))
  };
}

export function makeCylinder(
  sizing: CircularSizingInput,
  aspectRaw: number,
  rotation: number,
  outerSep: number,
  sampleSteps = 24
): CylinderGeometry {
  const aspect = normalizeAspect(aspectRaw);
  const totalLength = Math.max(EPSILON, Math.max(sizing.naturalWidth, sizing.minimumHeight));
  const totalThickness = Math.max(EPSILON, Math.max(sizing.naturalHeight, sizing.minimumWidth));
  const safeOuterSep = Math.max(0, outerSep);
  const capRadiusY = totalThickness / 2 + safeOuterSep;
  const capRadiusX = Math.max(EPSILON, (totalThickness / 2) * aspect + safeOuterSep);
  const bodyHalfLength = Math.max(0, totalLength / 2 - capRadiusX);

  const leftCenter = { x: -bodyHalfLength, y: 0 };
  const rightCenter = { x: bodyHalfLength, y: 0 };
  const beforeTopUnrotated = { x: rightCenter.x, y: capRadiusY };
  const topUnrotated = { x: rightCenter.x + capRadiusX, y: 0 };
  const afterTopUnrotated = { x: rightCenter.x, y: -capRadiusY };
  const beforeBottomUnrotated = { x: leftCenter.x, y: -capRadiusY };
  const bottomUnrotated = { x: leftCenter.x - capRadiusX, y: 0 };
  const afterBottomUnrotated = { x: leftCenter.x, y: capRadiusY };
  const shapeCenterUnrotated = { x: capRadiusX / 2, y: 0 };

  const polygonUnrotated: Point[] = [];
  const rightArcSteps = Math.max(8, sampleSteps);
  const leftArcSteps = Math.max(8, sampleSteps);

  for (let index = 0; index <= leftArcSteps; index += 1) {
    const t = index / leftArcSteps;
    polygonUnrotated.push(pointEllipsePolarOffset(90 + 180 * t, capRadiusX, capRadiusY, leftCenter));
  }
  for (let index = 0; index <= rightArcSteps; index += 1) {
    const t = index / rightArcSteps;
    polygonUnrotated.push(pointEllipsePolarOffset(-90 + 180 * t, capRadiusX, capRadiusY, rightCenter));
  }

  return {
    shapeCenter: rotatePoint(shapeCenterUnrotated, rotation),
    beforeTop: rotatePoint(beforeTopUnrotated, rotation),
    top: rotatePoint(topUnrotated, rotation),
    afterTop: rotatePoint(afterTopUnrotated, rotation),
    beforeBottom: rotatePoint(beforeBottomUnrotated, rotation),
    bottom: rotatePoint(bottomUnrotated, rotation),
    afterBottom: rotatePoint(afterBottomUnrotated, rotation),
    polygon: polygonUnrotated.map((point) => rotatePoint(point, rotation))
  };
}

export function makeCloud(
  sizing: CircularSizingInput,
  puffsRaw: number,
  puffArcRaw: number,
  aspectRaw: number,
  ignoreAspect: boolean,
  rotation: number
): CloudGeometry {
  const puffs = normalizeInteger(Math.round(puffsRaw), 2, 360, DEFAULT_CLOUD_PUFFS);
  const puffArc = normalizeCloudPuffArc(puffArcRaw);
  let rx = Math.max(EPSILON, Math.max(sizing.naturalWidth, sizing.minimumWidth) / 2);
  let ry = Math.max(EPSILON, Math.max(sizing.naturalHeight, sizing.minimumHeight) / 2);
  const aspect = normalizeAspect(aspectRaw);
  if (!ignoreAspect) {
    if (rx + EPSILON < aspect * ry) {
      rx = aspect * ry;
    }
    if (ry + EPSILON < rx / aspect) {
      ry = rx / aspect;
    }
  }

  const step = 360 / puffs;
  const depth = Math.max(0, Math.min(rx, ry) * (0.12 + (puffArc / 180) * 0.2));
  const valleyDepth = depth * 0.28;
  const polygon: Point[] = [];
  const peaks: Point[] = [];
  for (let index = 0; index < puffs; index += 1) {
    const peakAngle = 90 + rotation - index * step;
    const valleyAngle = peakAngle - step / 2;
    const peakBase = pointEllipsePolar(peakAngle, rx, ry);
    const valleyBase = pointEllipsePolar(valleyAngle, rx, ry);
    const peakNormal = ellipseOutwardUnit(peakBase, rx, ry);
    const valleyNormal = ellipseOutwardUnit(valleyBase, rx, ry);
    const peak = {
      x: peakBase.x + peakNormal.x * depth,
      y: peakBase.y + peakNormal.y * depth
    };
    const valley = {
      x: valleyBase.x + valleyNormal.x * valleyDepth,
      y: valleyBase.y + valleyNormal.y * valleyDepth
    };
    peaks.push(peak);
    polygon.push(peak, valley);
  }
  return { polygon, puffs: peaks };
}

export function makeStarburst(
  sizing: CircularSizingInput,
  pointsRaw: number,
  pointHeightPt: number,
  randomSeedRaw: number,
  rotation: number
): StarburstGeometry {
  const points = normalizeInteger(Math.round(pointsRaw), 2, 360, DEFAULT_STARBURST_POINTS);
  const pointHeight = Math.max(0, pointHeightPt);
  const targetWidth = Math.max(0, Math.max(sizing.naturalWidth, sizing.minimumWidth));
  const targetHeight = Math.max(0, Math.max(sizing.naturalHeight, sizing.minimumHeight));
  const innerRx = Math.max(EPSILON, targetWidth / 2 - pointHeight);
  const innerRy = Math.max(EPSILON, targetHeight / 2 - pointHeight);
  const step = 180 / points;
  const rng = makeSeededRng(randomSeedRaw);
  const polygon: Point[] = [];
  const outer: Point[] = [];
  const inner: Point[] = [];

  for (let index = 0; index < points; index += 1) {
    const outerAngle = 90 + rotation - index * 2 * step;
    const innerAngle = outerAngle - step;
    const outerScale = randomSeedRaw === 0 ? 1 : 0.25 + 0.75 * rng();
    const delta = pointHeight * outerScale;
    const outerPoint = pointEllipsePolar(outerAngle, innerRx + delta, innerRy + delta);
    const innerPoint = pointEllipsePolar(innerAngle, innerRx, innerRy);
    outer.push(outerPoint);
    inner.push(innerPoint);
    polygon.push(outerPoint, innerPoint);
  }

  return { polygon, outer, inner };
}

export function makeSignal(
  sizing: CircularSizingInput,
  pointerAngleRaw: number,
  toSides: SignalDirection[],
  fromSides: SignalDirection[]
): SignalGeometry {
  const pointerAngle = normalizeSignalPointerAngle(pointerAngleRaw);
  const halfWidth = Math.max(EPSILON, Math.max(sizing.naturalWidth, sizing.minimumWidth) / 2);
  const halfHeight = Math.max(EPSILON, Math.max(sizing.naturalHeight, sizing.minimumHeight) / 2);
  const halfAngle = toRadians(pointerAngle / 2);
  const cotHalf = Math.abs(1 / Math.max(Math.tan(halfAngle), 1e-3));
  const horizontalDepth = halfHeight * cotHalf;
  const verticalDepth = halfWidth * cotHalf;
  const to = new Set<SignalDirection>(toSides);
  const from = new Set<SignalDirection>(fromSides);

  const north = {
    x: 0,
    y: halfHeight + (to.has("north") ? verticalDepth : 0)
  };
  const south = {
    x: 0,
    y: -halfHeight - (to.has("south") ? verticalDepth : 0)
  };
  const east = {
    x: halfWidth + (to.has("east") ? horizontalDepth : 0),
    y: 0
  };
  const west = {
    x: -halfWidth - (to.has("west") ? horizontalDepth : 0),
    y: 0
  };
  const northEast = {
    x: halfWidth + (from.has("east") ? horizontalDepth : 0),
    y: halfHeight + (from.has("north") ? verticalDepth : 0)
  };
  const southEast = {
    x: halfWidth + (from.has("east") ? horizontalDepth : 0),
    y: -halfHeight - (from.has("south") ? verticalDepth : 0)
  };
  const southWest = {
    x: -halfWidth - (from.has("west") ? horizontalDepth : 0),
    y: -halfHeight - (from.has("south") ? verticalDepth : 0)
  };
  const northWest = {
    x: -halfWidth - (from.has("west") ? horizontalDepth : 0),
    y: halfHeight + (from.has("north") ? verticalDepth : 0)
  };

  return {
    polygon: [north, northEast, east, southEast, south, southWest, west, northWest]
  };
}

export function makeTape(
  sizing: CircularSizingInput,
  bendTop: TapeBendStyle,
  bendBottom: TapeBendStyle,
  bendHeightPt: number
): TapeGeometry {
  const halfWidth = Math.max(EPSILON, Math.max(sizing.naturalWidth, sizing.minimumWidth) / 2);
  const halfHeight = Math.max(EPSILON, Math.max(sizing.naturalHeight, sizing.minimumHeight) / 2);
  const halfBend = Math.max(0, bendHeightPt) / 2;
  const samples = 18;
  const polygon: Point[] = [];

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const x = -halfWidth + 2 * halfWidth * t;
    const y = halfHeight + tapeEdgeOffset(t, bendTop, true, halfBend);
    polygon.push({ x, y });
  }

  for (let index = 1; index <= samples; index += 1) {
    const t = index / samples;
    const x = halfWidth - 2 * halfWidth * t;
    const y = -halfHeight + tapeEdgeOffset(t, bendBottom, false, halfBend);
    polygon.push({ x, y });
  }

  return { polygon };
}

export function resolveCalloutPointerOffset(
  shapeGeometry: Pick<
    ShapeGeometryParams,
    "calloutPointerIsAbsolute" | "calloutRelativePointerRaw" | "calloutAbsolutePointerRaw" | "calloutPointerShortenPt"
  >,
  context: SemanticContext | null,
  center: Point | null
): Point {
  let pointer =
    parseCalloutCoordinateVector(shapeGeometry.calloutRelativePointerRaw) ??
    parseCalloutCoordinateVector(DEFAULT_CALLOUT_RELATIVE_POINTER_RAW) ?? { x: 0, y: 0 };

  if (shapeGeometry.calloutPointerIsAbsolute && shapeGeometry.calloutAbsolutePointerRaw && context && center) {
    const evaluated = evaluateRawCoordinate(ensureCoordinateRaw(shapeGeometry.calloutAbsolutePointerRaw), context);
    if (evaluated.point) {
      pointer = {
        x: evaluated.point.x - center.x,
        y: evaluated.point.y - center.y
      };
    }
  }

  return pointer;
}

export function makeRectangleCallout(
  sizing: CircularSizingInput,
  pointerOffset: Point,
  pointerWidthPt: number,
  pointerIsAbsolute: boolean,
  pointerShortenPt: number
): RectangleCalloutGeometry {
  const halfWidth = Math.max(EPSILON, Math.max(sizing.naturalWidth, sizing.minimumWidth) / 2);
  const halfHeight = Math.max(EPSILON, Math.max(sizing.naturalHeight, sizing.minimumHeight) / 2);
  const relativePointer = Math.hypot(pointerOffset.x, pointerOffset.y) > EPSILON ? pointerOffset : { x: halfWidth, y: 0 };
  const relativeSide = rectanglePointerSide(relativePointer, halfWidth, halfHeight);
  const relativeBorder = rectangleBorderPoint(relativePointer, halfWidth, halfHeight, relativeSide);
  let pointer = pointerIsAbsolute
    ? relativePointer
    : resolveRelativeCalloutPointer(relativePointer, relativeBorder);
  pointer = shortenCalloutPointer(pointer, pointerShortenPt);
  if (Math.hypot(pointer.x, pointer.y) <= EPSILON) {
    pointer = { x: halfWidth, y: 0 };
  }
  const pointerWidth = Math.max(0, pointerWidthPt);

  const side = rectanglePointerSide(pointer, halfWidth, halfHeight);
  const border = rectangleBorderPoint(pointer, halfWidth, halfHeight, side);
  const halfBase = pointerWidth / 2;

  const topLeft = { x: -halfWidth, y: halfHeight };
  const topRight = { x: halfWidth, y: halfHeight };
  const bottomRight = { x: halfWidth, y: -halfHeight };
  const bottomLeft = { x: -halfWidth, y: -halfHeight };

  let polygon: Point[];
  if (side === "east") {
    const top = clamp(border.y + halfBase, -halfHeight, halfHeight);
    const bottom = clamp(border.y - halfBase, -halfHeight, halfHeight);
    const baseTop = { x: halfWidth, y: top };
    const baseBottom = { x: halfWidth, y: bottom };
    polygon = [topLeft, topRight, baseTop, pointer, baseBottom, bottomRight, bottomLeft];
  } else if (side === "west") {
    const top = clamp(border.y + halfBase, -halfHeight, halfHeight);
    const bottom = clamp(border.y - halfBase, -halfHeight, halfHeight);
    const baseTop = { x: -halfWidth, y: top };
    const baseBottom = { x: -halfWidth, y: bottom };
    polygon = [topLeft, topRight, bottomRight, bottomLeft, baseBottom, pointer, baseTop];
  } else if (side === "north") {
    const left = clamp(border.x - halfBase, -halfWidth, halfWidth);
    const right = clamp(border.x + halfBase, -halfWidth, halfWidth);
    const baseLeft = { x: left, y: halfHeight };
    const baseRight = { x: right, y: halfHeight };
    polygon = [topLeft, baseLeft, pointer, baseRight, topRight, bottomRight, bottomLeft];
  } else {
    const left = clamp(border.x - halfBase, -halfWidth, halfWidth);
    const right = clamp(border.x + halfBase, -halfWidth, halfWidth);
    const baseLeft = { x: left, y: -halfHeight };
    const baseRight = { x: right, y: -halfHeight };
    polygon = [topLeft, topRight, bottomRight, baseRight, pointer, baseLeft, bottomLeft];
  }

  return {
    polygon,
    pointer,
    pointerAnchor: pointer
  };
}

export function makeEllipseCallout(
  sizing: CircularSizingInput,
  pointerOffset: Point,
  pointerArcRaw: number,
  pointerIsAbsolute: boolean,
  pointerShortenPt: number,
  sampleSteps = 64
): EllipseCalloutGeometry {
  const rx = Math.max(EPSILON, Math.max(sizing.naturalWidth, sizing.minimumWidth) / 2);
  const ry = Math.max(EPSILON, Math.max(sizing.naturalHeight, sizing.minimumHeight) / 2);
  const relativePointer = Math.hypot(pointerOffset.x, pointerOffset.y) > EPSILON ? pointerOffset : { x: rx, y: 0 };
  const relativeBorder = ellipseBorderPoint(relativePointer, rx, ry);
  let pointer = pointerIsAbsolute
    ? relativePointer
    : resolveRelativeCalloutPointer(relativePointer, relativeBorder);
  pointer = shortenCalloutPointer(pointer, pointerShortenPt);
  if (Math.hypot(pointer.x, pointer.y) <= EPSILON) {
    pointer = { x: rx, y: 0 };
  }

  const pointerBorder = ellipseBorderPoint(pointer, rx, ry);
  const pointerAngle = Math.atan2(pointerBorder.y / Math.max(ry, EPSILON), pointerBorder.x / Math.max(rx, EPSILON));
  const pointerArc = normalizeCalloutPointerArc(pointerArcRaw);
  const halfArc = toRadians(pointerArc / 2);
  const beforeAngle = pointerAngle + halfArc;
  const afterAngle = pointerAngle - halfArc;

  const arcPoints = sampleEllipseArc(afterAngle, beforeAngle, rx, ry, sampleSteps);
  return {
    polygon: [pointer, ...arcPoints],
    pointer,
    pointerAnchor: pointer
  };
}

export function makeCloudCallout(
  sizing: CircularSizingInput,
  puffsRaw: number,
  puffArcRaw: number,
  aspectRaw: number,
  ignoreAspect: boolean,
  rotation: number,
  pointerOffset: Point,
  startSizeRaw: string,
  endSizeRaw: string,
  segmentsRaw: number,
  pointerIsAbsolute: boolean,
  pointerShortenPt: number
): CloudCalloutGeometry {
  const cloud = makeCloud(sizing, puffsRaw, puffArcRaw, aspectRaw, ignoreAspect, rotation);
  const relativePointer = Math.hypot(pointerOffset.x, pointerOffset.y) > EPSILON ? pointerOffset : { x: 0, y: 0 };
  const relativeBorder = intersectRayWithPolygon({ x: 0, y: 0 }, relativePointer, cloud.polygon) ?? { x: 0, y: 0 };
  let pointer = pointerIsAbsolute
    ? relativePointer
    : resolveRelativeCalloutPointer(relativePointer, relativeBorder);
  pointer = shortenCalloutPointer(pointer, pointerShortenPt);
  const border = intersectRayWithPolygon({ x: 0, y: 0 }, pointer, cloud.polygon) ?? { x: 0, y: 0 };

  const { width: calloutWidth, height: calloutHeight } = polygonSize(cloud.polygon);
  const startSize = resolveCloudCalloutPointerSize(startSizeRaw, calloutWidth, calloutHeight, 0.2);
  const endSize = resolveCloudCalloutPointerSize(endSizeRaw, calloutWidth, calloutHeight, 0.1);
  const segmentCount = normalizeInteger(Math.round(segmentsRaw), 1, 128, DEFAULT_CALLOUT_POINTER_SEGMENTS);
  const pointerPolygon = makeCloudCalloutPointerPolygon(border, pointer, startSize, endSize, segmentCount);

  return {
    polygon: cloud.polygon,
    pointerPolygon,
    pointer,
    pointerAnchor: pointer,
    puffs: cloud.puffs
  };
}

export function makeSingleArrow(
  sizing: CircularSizingInput,
  tipAngleRaw: number,
  headExtendPt: number,
  headIndentPt: number,
  rotation: number
): SingleArrowGeometry {
  const arrow = resolveArrowCore(sizing, tipAngleRaw, headExtendPt, headIndentPt, DEFAULT_SINGLE_ARROW_TIP_ANGLE);
  const tipUnrotated = { x: arrow.bodyHalfLength + arrow.tipHalfLength, y: 0 };
  const beforeTipUnrotated = { x: arrow.bodyHalfLength, y: arrow.headHalfHeight };
  const beforeHeadUnrotated = { x: arrow.bodyHalfLength + arrow.headIndent, y: arrow.shaftHalfHeight };
  const afterTailUnrotated = { x: -arrow.bodyHalfLength, y: arrow.shaftHalfHeight };
  const beforeTailUnrotated = { x: afterTailUnrotated.x, y: -afterTailUnrotated.y };
  const afterHeadUnrotated = { x: beforeHeadUnrotated.x, y: -beforeHeadUnrotated.y };
  const afterTipUnrotated = { x: beforeTipUnrotated.x, y: -beforeTipUnrotated.y };
  const tailUnrotated = { x: afterTailUnrotated.x, y: 0 };

  const polygon = rotatePolygon(
    [
      tipUnrotated,
      beforeTipUnrotated,
      beforeHeadUnrotated,
      afterTailUnrotated,
      beforeTailUnrotated,
      afterHeadUnrotated,
      afterTipUnrotated
    ],
    rotation
  );

  return {
    polygon,
    tip: rotatePoint(tipUnrotated, rotation),
    beforeTip: rotatePoint(beforeTipUnrotated, rotation),
    afterTip: rotatePoint(afterTipUnrotated, rotation),
    beforeHead: rotatePoint(beforeHeadUnrotated, rotation),
    afterHead: rotatePoint(afterHeadUnrotated, rotation),
    beforeTail: rotatePoint(beforeTailUnrotated, rotation),
    afterTail: rotatePoint(afterTailUnrotated, rotation),
    tail: rotatePoint(tailUnrotated, rotation)
  };
}

export function makeDoubleArrow(
  sizing: CircularSizingInput,
  tipAngleRaw: number,
  headExtendPt: number,
  headIndentPt: number,
  rotation: number
): DoubleArrowGeometry {
  const arrow = resolveArrowCore(sizing, tipAngleRaw, headExtendPt, headIndentPt, DEFAULT_DOUBLE_ARROW_TIP_ANGLE);
  const tip1Unrotated = { x: arrow.bodyHalfLength + arrow.tipHalfLength, y: 0 };
  const beforeTip1Unrotated = { x: arrow.bodyHalfLength, y: arrow.headHalfHeight };
  const beforeHead1Unrotated = { x: arrow.bodyHalfLength + arrow.headIndent, y: arrow.shaftHalfHeight };
  const afterTip1Unrotated = { x: beforeTip1Unrotated.x, y: -beforeTip1Unrotated.y };
  const afterHead1Unrotated = { x: beforeHead1Unrotated.x, y: -beforeHead1Unrotated.y };

  const tip2Unrotated = { x: -tip1Unrotated.x, y: 0 };
  const beforeTip2Unrotated = { x: -beforeTip1Unrotated.x, y: -beforeTip1Unrotated.y };
  const beforeHead2Unrotated = { x: -beforeHead1Unrotated.x, y: -beforeHead1Unrotated.y };
  const afterTip2Unrotated = { x: -beforeTip1Unrotated.x, y: beforeTip1Unrotated.y };
  const afterHead2Unrotated = { x: -beforeHead1Unrotated.x, y: beforeHead1Unrotated.y };

  const polygon = rotatePolygon(
    [
      tip1Unrotated,
      beforeTip1Unrotated,
      beforeHead1Unrotated,
      afterHead2Unrotated,
      afterTip2Unrotated,
      tip2Unrotated,
      beforeTip2Unrotated,
      beforeHead2Unrotated,
      afterHead1Unrotated,
      afterTip1Unrotated
    ],
    rotation
  );

  return {
    polygon,
    tip1: rotatePoint(tip1Unrotated, rotation),
    beforeTip1: rotatePoint(beforeTip1Unrotated, rotation),
    afterTip1: rotatePoint(afterTip1Unrotated, rotation),
    beforeHead1: rotatePoint(beforeHead1Unrotated, rotation),
    afterHead1: rotatePoint(afterHead1Unrotated, rotation),
    tip2: rotatePoint(tip2Unrotated, rotation),
    beforeTip2: rotatePoint(beforeTip2Unrotated, rotation),
    afterTip2: rotatePoint(afterTip2Unrotated, rotation),
    beforeHead2: rotatePoint(beforeHead2Unrotated, rotation),
    afterHead2: rotatePoint(afterHead2Unrotated, rotation)
  };
}

export function regularPolygonStartAngle(sidesRaw: number, rotation: number): number {
  const sides = normalizeInteger(Math.round(sidesRaw), 3, 360, DEFAULT_REGULAR_POLYGON_SIDES);
  if (sides % 2 === 1) {
    return 90 + rotation;
  }
  return 90 - 180 / sides + rotation;
}

export function intersectRayWithPolygon(reference: Point, direction: Point, polygon: Point[]): Point | null {
  if (polygon.length < 2) {
    return null;
  }

  const directionLength = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(directionLength) || directionLength <= EPSILON) {
    return null;
  }

  const maxRadius = polygon.reduce((max, point) => Math.max(max, Math.hypot(point.x, point.y)), 0);
  const referenceRadius = Math.hypot(reference.x, reference.y);
  const rayLength = Math.max(1, maxRadius + referenceRadius + 1) * 4;
  const rayTarget = {
    x: reference.x + (direction.x / directionLength) * rayLength,
    y: reference.y + (direction.y / directionLength) * rayLength
  };

  let best: { point: Point; t: number } | null = null;
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    const hit = intersectSegments(reference, rayTarget, edgeStart, edgeEnd);
    if (!hit) {
      continue;
    }
    if (hit.t < -1e-6) {
      continue;
    }
    if (!best || hit.t < best.t) {
      best = hit;
    }
  }

  return best?.point ?? null;
}

export function midpoint(from: Point, to: Point): Point {
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2
  };
}

function parseNumericOption(raw: string): number | null {
  const normalized = normalizeOptionValue(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  const direct = Number(normalized);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const match = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*deg(?:ree)?s?)?$/i);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntegerOption(raw: string): number | null {
  const numeric = parseNumericOption(raw);
  if (numeric == null) {
    return null;
  }
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.round(numeric);
}

function parseBoolishOption(raw: string): boolean | null {
  const normalized = normalizeOptionValue(raw).toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0" || normalized === "off") {
    return false;
  }
  return null;
}

function parseKiteVertexAngles(raw: string): { upper: number; lower: number } | null {
  const normalized = normalizeOptionValue(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  const andMatch = normalized.match(/^(.+)\band\b(.+)$/i);
  if (andMatch) {
    const upper = parseNumericOption(andMatch[1] ?? "");
    const lower = parseNumericOption(andMatch[2] ?? "");
    if (upper == null || lower == null) {
      return null;
    }
    return { upper, lower };
  }

  const single = parseNumericOption(normalized);
  if (single == null) {
    return null;
  }
  return { upper: single, lower: single };
}

function parseRandomStarburstOption(raw: string): number | null {
  const normalized = normalizeOptionValue(raw).trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized === "true" || normalized === "yes" || normalized === "1" || normalized === "on") {
    return Math.floor(Math.random() * 0x7fffffff) + 1;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0" || normalized === "off") {
    return 0;
  }
  const numeric = parseNumericOption(normalized);
  if (numeric == null) {
    return null;
  }
  return Math.abs(Math.round(numeric));
}

function parseSignalDirectionSpec(raw: string): SignalDirection[] {
  const normalized = normalizeOptionValue(raw).toLowerCase();
  const tokens = normalized.split(/[^a-z]+/u).filter((token) => token.length > 0);
  const set = new Set<SignalDirection>();
  for (const token of tokens) {
    if (token === "north" || token === "south") {
      set.delete("east");
      set.delete("west");
      set.add(token);
    } else if (token === "east" || token === "west") {
      set.delete("north");
      set.delete("south");
      set.add(token);
    }
  }
  const orderedDirections: SignalDirection[] = ["north", "south", "east", "west"];
  return orderedDirections.filter((direction) => set.has(direction));
}

function parseTapeBendStyle(raw: string, fallback: TapeBendStyle): TapeBendStyle {
  const normalized = normalizeOptionValue(raw).toLowerCase().replace(/\s+/gu, " ").trim();
  if (normalized === "in and out") {
    return "in and out";
  }
  if (normalized === "out and in") {
    return "out and in";
  }
  if (normalized === "none" || normalized === "false" || normalized === "off" || normalized === "0") {
    return "none";
  }
  if (normalized === "true" || normalized === "on" || normalized === "1" || normalized === "yes") {
    return fallback;
  }
  return fallback;
}

function parseCalloutCoordinateVector(raw: string): Point | null {
  const coordinate = parseCoordinate(ensureCoordinateRaw(raw));
  if (coordinate.form === "cartesian") {
    const x = parseLength(coordinate.x, "cm");
    const y = parseLength(coordinate.y, "cm");
    if (x == null || y == null) {
      return null;
    }
    return { x, y };
  }
  if (coordinate.form === "polar") {
    const angle = parseNumericOption(coordinate.x);
    const radius = parseLength(coordinate.y, "cm");
    if (angle == null || radius == null) {
      return null;
    }
    const radians = toRadians(angle);
    return {
      x: radius * Math.cos(radians),
      y: radius * Math.sin(radians)
    };
  }
  return null;
}

function ensureCoordinateRaw(raw: string): string {
  const normalized = normalizeOptionValue(raw).trim();
  if (normalized.startsWith("(") && normalized.endsWith(")")) {
    return normalized;
  }
  return `(${normalized})`;
}

function normalizeAspect(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_DIAMOND_ASPECT;
  }
  const magnitude = Math.abs(value);
  if (magnitude <= 1e-4) {
    return DEFAULT_DIAMOND_ASPECT;
  }
  return Math.min(10_000, magnitude);
}

function normalizeAcuteAngle(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = ((value % 360) + 360) % 360;
  if (normalized <= 1e-3 || normalized >= 179.999) {
    return fallback;
  }
  return normalized;
}

function normalizeTailAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_DART_TAIL_ANGLE;
  }
  const normalized = ((value % 360) + 360) % 360;
  if (normalized <= 1e-3 || normalized >= 359.999) {
    return DEFAULT_DART_TAIL_ANGLE;
  }
  return normalized;
}

function normalizeSectorAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CIRCULAR_SECTOR_ANGLE;
  }
  const normalized = Math.abs(value);
  if (normalized <= 1e-3) {
    return DEFAULT_CIRCULAR_SECTOR_ANGLE;
  }
  return Math.min(179.5, normalized);
}

function normalizeCloudPuffArc(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CLOUD_PUFF_ARC;
  }
  const normalized = Math.abs(value);
  if (normalized <= 1e-3) {
    return DEFAULT_CLOUD_PUFF_ARC;
  }
  return Math.max(10, Math.min(360, normalized));
}

function normalizeSignalPointerAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SIGNAL_POINTER_ANGLE;
  }
  const normalized = Math.abs(value);
  if (normalized <= 1e-3) {
    return DEFAULT_SIGNAL_POINTER_ANGLE;
  }
  return Math.max(1, Math.min(179, normalized));
}

function normalizeCalloutPointerArc(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CALLOUT_POINTER_ARC;
  }
  const normalized = Math.abs(value);
  if (normalized <= 1e-3) {
    return DEFAULT_CALLOUT_POINTER_ARC;
  }
  return Math.max(1, Math.min(180, normalized));
}

function normalizeArrowTipAngle(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.abs(value);
  if (normalized <= 1e-3) {
    return fallback;
  }
  return Math.max(1, Math.min(179, normalized));
}

function normalizeRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_STAR_RATIO;
  }
  const magnitude = Math.abs(value);
  if (magnitude <= 1e-4) {
    return DEFAULT_STAR_RATIO;
  }
  return Math.min(10_000, magnitude);
}

function normalizeAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TRAPEZIUM_ANGLE;
  }
  const normalized = ((value % 360) + 360) % 360;
  return normalized;
}

function normalizeInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min || value > max) {
    return fallback;
  }
  return value;
}

function resolveArrowCore(
  sizing: CircularSizingInput,
  tipAngleRaw: number,
  headExtendPt: number,
  headIndentPt: number,
  fallbackTipAngle: number
): {
  bodyHalfLength: number;
  shaftHalfHeight: number;
  headHalfHeight: number;
  tipHalfLength: number;
  headIndent: number;
} {
  const tipAngle = normalizeArrowTipAngle(tipAngleRaw, fallbackTipAngle);
  const halfAngle = toRadians(tipAngle / 2);
  const tangent = Math.tan(halfAngle);
  const safeTangent = Number.isFinite(tangent) && Math.abs(tangent) > EPSILON ? Math.abs(tangent) : 1;

  // Arrow shapes interpret "minimum width" as shaft thickness and "minimum height" as tip-to-tail span.
  const shaftHalfHeight = Math.max(EPSILON, Math.max(sizing.naturalHeight, sizing.minimumWidth) / 2);
  const bodyHalfLength = Math.max(EPSILON, Math.max(sizing.naturalWidth, sizing.minimumHeight) / 2);
  const headHalfHeight = shaftHalfHeight + Math.max(0, headExtendPt);
  const tipHalfLength = Math.max(EPSILON, headHalfHeight / safeTangent);
  const headIndent = Math.min(Math.max(0, headIndentPt), Math.max(0, tipHalfLength - EPSILON));

  return {
    bodyHalfLength,
    shaftHalfHeight,
    headHalfHeight,
    tipHalfLength,
    headIndent
  };
}

function rectanglePointerSide(pointer: Point, halfWidth: number, halfHeight: number): "east" | "west" | "north" | "south" {
  const rx = halfWidth > EPSILON ? Math.abs(pointer.x) / halfWidth : Number.POSITIVE_INFINITY;
  const ry = halfHeight > EPSILON ? Math.abs(pointer.y) / halfHeight : Number.POSITIVE_INFINITY;
  if (rx >= ry) {
    return pointer.x >= 0 ? "east" : "west";
  }
  return pointer.y >= 0 ? "north" : "south";
}

function rectangleBorderPoint(
  pointer: Point,
  halfWidth: number,
  halfHeight: number,
  side: "east" | "west" | "north" | "south"
): Point {
  if (side === "east" || side === "west") {
    const x = side === "east" ? halfWidth : -halfWidth;
    const yScale = Math.abs(pointer.x) > EPSILON ? x / pointer.x : 0;
    return {
      x,
      y: clamp(pointer.y * yScale, -halfHeight, halfHeight)
    };
  }

  const y = side === "north" ? halfHeight : -halfHeight;
  const xScale = Math.abs(pointer.y) > EPSILON ? y / pointer.y : 0;
  return {
    x: clamp(pointer.x * xScale, -halfWidth, halfWidth),
    y
  };
}

function ellipseBorderPoint(pointer: Point, rx: number, ry: number): Point {
  const px = pointer.x;
  const py = pointer.y;
  const norm = Math.hypot(px / Math.max(rx, EPSILON), py / Math.max(ry, EPSILON));
  if (!Number.isFinite(norm) || norm <= EPSILON) {
    return { x: rx, y: 0 };
  }
  const scale = 1 / norm;
  return {
    x: px * scale,
    y: py * scale
  };
}

function resolveRelativeCalloutPointer(relativePointer: Point, borderPoint: Point): Point {
  const length = Math.hypot(relativePointer.x, relativePointer.y);
  if (length <= EPSILON) {
    return borderPoint;
  }
  const angle = Math.atan2(borderPoint.y, borderPoint.x);
  return {
    x: borderPoint.x + Math.cos(angle) * length,
    y: borderPoint.y + Math.sin(angle) * length
  };
}

function shortenCalloutPointer(pointer: Point, shortenPt: number): Point {
  const distance = Math.hypot(pointer.x, pointer.y);
  if (distance <= EPSILON || shortenPt <= 0) {
    return pointer;
  }
  const remaining = Math.max(0, distance - shortenPt);
  const scale = remaining / distance;
  return {
    x: pointer.x * scale,
    y: pointer.y * scale
  };
}

function sampleEllipseArc(startRadians: number, endRadians: number, rx: number, ry: number, steps: number): Point[] {
  const tau = 2 * Math.PI;
  const normalizedStart = ((startRadians % tau) + tau) % tau;
  const normalizedEnd = ((endRadians % tau) + tau) % tau;
  let sweep = normalizedEnd - normalizedStart;
  if (sweep < 0) {
    sweep += tau;
  }

  const count = Math.max(8, steps);
  const points: Point[] = [];
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const angle = normalizedStart + sweep * t;
    points.push({
      x: rx * Math.cos(angle),
      y: ry * Math.sin(angle)
    });
  }
  return points;
}

function polygonSize(points: Point[]): { width: number; height: number } {
  if (points.length === 0) {
    return { width: 0, height: 0 };
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
}

function resolveCloudCalloutPointerSize(
  raw: string,
  calloutWidth: number,
  calloutHeight: number,
  fallbackFraction: number
): { xDiameter: number; yDiameter: number } {
  const normalized = normalizeOptionValue(raw).toLowerCase().trim();
  const fallback = {
    xDiameter: Math.max(EPSILON, calloutWidth * fallbackFraction),
    yDiameter: Math.max(EPSILON, calloutHeight * fallbackFraction)
  };

  const ofIndex = normalized.indexOf("of callout");
  if (ofIndex >= 0) {
    const ratioRaw = normalized.slice(0, ofIndex).trim();
    const ratio = parseNumericOption(ratioRaw);
    if (ratio != null && Number.isFinite(ratio) && ratio > 0) {
      return {
        xDiameter: Math.max(EPSILON, calloutWidth * ratio),
        yDiameter: Math.max(EPSILON, calloutHeight * ratio)
      };
    }
  }

  const andMatch = normalized.match(/^(.+)\band\b(.+)$/i);
  if (andMatch) {
    const xDiameter = parseLength(andMatch[1]?.trim() ?? "", "pt");
    const yDiameter = parseLength(andMatch[2]?.trim() ?? "", "pt");
    if (xDiameter != null && yDiameter != null && xDiameter > 0 && yDiameter > 0) {
      return { xDiameter, yDiameter };
    }
  }

  const diameter = parseLength(normalized, "pt");
  if (diameter != null && diameter > 0) {
    return {
      xDiameter: diameter,
      yDiameter: diameter
    };
  }

  return fallback;
}

function makeCloudCalloutPointerPolygon(
  borderPoint: Point,
  pointer: Point,
  startSize: { xDiameter: number; yDiameter: number },
  endSize: { xDiameter: number; yDiameter: number },
  segments: number
): Point[] {
  const direction = {
    x: pointer.x - borderPoint.x,
    y: pointer.y - borderPoint.y
  };
  const length = Math.hypot(direction.x, direction.y);
  if (length <= EPSILON) {
    return [pointer];
  }

  const ux = direction.x / length;
  const uy = direction.y / length;
  const nx = -uy;
  const ny = ux;
  const segmentCount = Math.max(1, segments);
  const left: Point[] = [];
  const right: Point[] = [];

  for (let index = 0; index <= segmentCount; index += 1) {
    const t = index / segmentCount;
    const center = {
      x: borderPoint.x + direction.x * t,
      y: borderPoint.y + direction.y * t
    };
    const diameterX = lerp(startSize.xDiameter, endSize.xDiameter, t);
    const diameterY = lerp(startSize.yDiameter, endSize.yDiameter, t);
    const halfWidth = Math.max(EPSILON, (diameterX + diameterY) / 4);
    left.push({
      x: center.x + nx * halfWidth,
      y: center.y + ny * halfWidth
    });
    right.push({
      x: center.x - nx * halfWidth,
      y: center.y - ny * halfWidth
    });
  }

  return [...left, ...right.reverse()];
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function pointPolar(degrees: number, radius: number): Point {
  const radians = toRadians(degrees);
  return {
    x: radius * Math.cos(radians),
    y: radius * Math.sin(radians)
  };
}

function pointPolarOffset(degrees: number, radius: number, center: Point): Point {
  const point = pointPolar(degrees, radius);
  return {
    x: center.x + point.x,
    y: center.y + point.y
  };
}

function pointEllipsePolar(degrees: number, rx: number, ry: number): Point {
  const radians = toRadians(degrees);
  return {
    x: rx * Math.cos(radians),
    y: ry * Math.sin(radians)
  };
}

function ellipseOutwardUnit(point: Point, rx: number, ry: number): Point {
  const gx = point.x / Math.max(rx * rx, EPSILON);
  const gy = point.y / Math.max(ry * ry, EPSILON);
  const norm = Math.hypot(gx, gy);
  if (norm > EPSILON && Number.isFinite(norm)) {
    return { x: gx / norm, y: gy / norm };
  }
  const radialNorm = Math.hypot(point.x, point.y);
  if (radialNorm > EPSILON && Number.isFinite(radialNorm)) {
    return { x: point.x / radialNorm, y: point.y / radialNorm };
  }
  return { x: 1, y: 0 };
}

function pointEllipsePolarOffset(degrees: number, rx: number, ry: number, center: Point): Point {
  const radians = toRadians(degrees);
  return {
    x: center.x + rx * Math.cos(radians),
    y: center.y + ry * Math.sin(radians)
  };
}

function makeSeededRng(seedRaw: number): () => number {
  let state = Math.abs(Math.round(seedRaw)) >>> 0;
  if (state === 0) {
    state = 1;
  }
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function tapeEdgeOffset(t: number, bend: TapeBendStyle, isTopEdge: boolean, halfBend: number): number {
  if (bend === "none" || halfBend <= EPSILON) {
    return 0;
  }
  let wave = Math.sin((t - 0.5) * Math.PI);
  if (bend === "out and in") {
    wave *= -1;
  }
  return wave * halfBend * (isTopEdge ? 1 : -1);
}

function cotDegrees(degrees: number): number {
  const radians = (degrees * Math.PI) / 180;
  const sine = Math.sin(radians);
  const cosine = Math.cos(radians);
  if (!Number.isFinite(sine) || Math.abs(sine) <= 1e-6) {
    return cosine >= 0 ? 1e6 : -1e6;
  }
  return cosine / sine;
}

function resolveTrapeziumDimensions(
  naturalHalfWidth: number,
  naturalHalfHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  leftAngle: number,
  rightAngle: number,
  stretches: boolean,
  stretchesBody: boolean
): {
  halfWidth: number;
  halfHeight: number;
  leftExtension: number;
  rightExtension: number;
} {
  let halfWidth = Math.max(0, naturalHalfWidth);
  let halfHeight = Math.max(0, naturalHalfHeight);
  const targetHalfHeight = Math.max(0, minimumHeight / 2);
  const targetWidth = Math.max(0, minimumWidth);
  let leftExtension = 2 * halfHeight * cotDegrees(leftAngle);
  let rightExtension = 2 * halfHeight * cotDegrees(rightAngle);

  if (halfHeight + EPSILON < targetHalfHeight) {
    if (stretches || stretchesBody) {
      halfHeight = targetHalfHeight;
      leftExtension = 2 * halfHeight * cotDegrees(leftAngle);
      rightExtension = 2 * halfHeight * cotDegrees(rightAngle);
    } else {
      const scale = targetHalfHeight / Math.max(halfHeight, EPSILON);
      halfWidth *= scale;
      halfHeight = targetHalfHeight;
      leftExtension *= scale;
      rightExtension *= scale;
    }
  }

  let totalWidth = 2 * halfWidth + Math.abs(leftExtension) + Math.abs(rightExtension);
  if (totalWidth + EPSILON < targetWidth) {
    if (stretchesBody) {
      const remainder = targetWidth - totalWidth;
      halfWidth += remainder / 2;
    } else {
      const scale = targetWidth / Math.max(totalWidth, EPSILON);
      halfWidth *= scale;
      leftExtension *= scale;
      rightExtension *= scale;
      if (!stretches) {
        halfHeight *= scale;
      }
    }
    totalWidth = 2 * halfWidth + Math.abs(leftExtension) + Math.abs(rightExtension);
  }

  if (!Number.isFinite(totalWidth)) {
    return {
      halfWidth: Math.max(0, naturalHalfWidth),
      halfHeight: Math.max(0, naturalHalfHeight),
      leftExtension: 0,
      rightExtension: 0
    };
  }

  return {
    halfWidth: Math.max(0, halfWidth),
    halfHeight: Math.max(0, halfHeight),
    leftExtension: clampFinite(leftExtension),
    rightExtension: clampFinite(rightExtension)
  };
}

function rotatePoint(point: Point, degrees: number): Point {
  const radians = toRadians(degrees);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine
  };
}

function rotatePolygon(points: Point[], rotation: number): Point[] {
  if (Math.abs(rotation) <= 1e-6) {
    return points;
  }
  return points.map((point) => rotatePoint(point, rotation));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function intersectSegments(
  firstFrom: Point,
  firstTo: Point,
  secondFrom: Point,
  secondTo: Point
): { point: Point; t: number } | null {
  const firstDirection = { x: firstTo.x - firstFrom.x, y: firstTo.y - firstFrom.y };
  const secondDirection = { x: secondTo.x - secondFrom.x, y: secondTo.y - secondFrom.y };
  const denominator = cross(firstDirection, secondDirection);
  if (Math.abs(denominator) <= EPSILON) {
    return null;
  }

  const offset = {
    x: secondFrom.x - firstFrom.x,
    y: secondFrom.y - firstFrom.y
  };
  const firstT = cross(offset, secondDirection) / denominator;
  const secondT = cross(offset, firstDirection) / denominator;
  if (firstT < -1e-6 || firstT > 1 + 1e-6 || secondT < -1e-6 || secondT > 1 + 1e-6) {
    return null;
  }

  const clampedFirstT = Math.max(0, Math.min(1, firstT));
  return {
    point: {
      x: firstFrom.x + clampedFirstT * firstDirection.x,
      y: firstFrom.y + clampedFirstT * firstDirection.y
    },
    t: clampedFirstT
  };
}

function clampFinite(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1e6, Math.min(1e6, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cross(left: Point, right: Point): number {
  return left.x * right.y - left.y * right.x;
}
