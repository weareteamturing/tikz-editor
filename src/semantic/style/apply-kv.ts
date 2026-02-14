import type { OptionEntry } from "../../options/types.js";
import { parseCoordinateLike, parseLength } from "../coords/parse-length.js";
import { multiplyMatrix, rotationMatrix, scaleMatrix, translationMatrix } from "../transform.js";
import {
  SHADOW_INHERIT_FILL,
  SHADOW_INHERIT_STROKE,
  type Matrix2D,
  type ResolvedStyle,
  type ShadowFadeKind,
  type ShadowLayer,
  type ShadowPaintStyle
} from "../types.js";
import { parseArrowSideSpecification, parseArrowSpecification, parseTipsMode } from "./arrows.js";
import type { ApplyEntryFn, ApplyOutcome } from "./apply-types.js";
import { NON_STYLE_OPTION_KEYS, PT_PER_CM } from "./constants.js";
import { clamp01, mixNormalizedColors, normalizeColor, normalizeShadingName } from "./colors.js";
import { parseDashPattern, parseDashValue } from "./dash.js";
import { normalizeOptionValue, parseAxisVector, parseFontStyle, parseStyleValueAsOptionList } from "./option-utils.js";

export function applyKvEntry(
  key: string,
  valueRaw: string,
  style: ResolvedStyle,
  transform: Matrix2D,
  applyOptionEntry: ApplyEntryFn
): ApplyOutcome {
  if (key === "every path/.style" || key === "every path/.append style") {
    const nested = parseStyleValueAsOptionList(valueRaw);
    if (!nested) {
      return { style, transform, diagnostics: [`invalid-style-value:${valueRaw}`] };
    }

    let nextStyle = style;
    let nextTransform = transform;
    const diagnostics: string[] = [];
    for (const entry of nested.entries) {
      const outcome = applyOptionEntry(entry, nextStyle, nextTransform);
      nextStyle = outcome.style;
      nextTransform = outcome.transform;
      diagnostics.push(...outcome.diagnostics);
    }

    return { style: nextStyle, transform: nextTransform, diagnostics };
  }

  if (key === "every shadow/.style" || key === "every shadow/.append style") {
    const nested = parseStyleValueAsOptionList(valueRaw);
    if (!nested) {
      return { style, transform, diagnostics: [`invalid-style-value:${valueRaw}`] };
    }

    const everyShadowStyles = key === "every shadow/.style" ? [nested] : [...style.everyShadowStyles, nested];
    return { style: { ...style, everyShadowStyles }, transform, diagnostics: [] };
  }

  if (key === "shadow scale") {
    const scale = Number(normalizeOptionValue(valueRaw));
    if (!Number.isFinite(scale)) {
      return { style, transform, diagnostics: [`invalid-shadow-scale:${valueRaw}`] };
    }
    return { style: { ...style, shadowScale: scale }, transform, diagnostics: [] };
  }

  if (key === "shadow xshift") {
    const shift = parseLength(valueRaw, "pt");
    if (shift == null) {
      return { style, transform, diagnostics: [`invalid-shadow-xshift:${valueRaw}`] };
    }
    return { style: { ...style, shadowXShift: shift }, transform, diagnostics: [] };
  }

  if (key === "shadow yshift") {
    const shift = parseLength(valueRaw, "pt");
    if (shift == null) {
      return { style, transform, diagnostics: [`invalid-shadow-yshift:${valueRaw}`] };
    }
    return { style: { ...style, shadowYShift: shift }, transform, diagnostics: [] };
  }

  if (key === "path fading") {
    const fading = parseShadowFadeKind(valueRaw);
    if (!fading) {
      return { style, transform, diagnostics: [`unsupported-path-fading:${normalizeOptionValue(valueRaw)}`] };
    }
    return { style: { ...style, shadowFade: fading }, transform, diagnostics: [] };
  }

  if (key === "general shadow") {
    return appendShadowLayers(style, transform, valueRaw, applyOptionEntry, {
      preset: null,
      applyEveryShadow: false
    });
  }

  if (key === "drop shadow") {
    return appendShadowLayers(style, transform, valueRaw, applyOptionEntry, {
      preset: "shadow scale=1,shadow xshift=.5ex,shadow yshift=-.5ex,opacity=.5,fill=black!50",
      applyEveryShadow: true
    });
  }

  if (key === "copy shadow") {
    return appendShadowLayers(style, transform, valueRaw, applyOptionEntry, {
      preset: "shadow scale=1,shadow xshift=.5ex,shadow yshift=.5ex",
      applyEveryShadow: true,
      copyMainPaint: true
    });
  }

  if (key === "double copy shadow") {
    return appendShadowLayers(style, transform, valueRaw, applyOptionEntry, {
      preset: "shadow scale=1,shadow xshift=.5ex,shadow yshift=.5ex",
      applyEveryShadow: true,
      duplicateWithDoubleShift: true,
      copyMainPaint: true
    });
  }

  if (key === "circular drop shadow") {
    return appendShadowLayers(style, transform, valueRaw, applyOptionEntry, {
      preset:
        "shadow scale=1.1,shadow xshift=.3ex,shadow yshift=-.3ex,fill=black!50,path fading={circle with fuzzy edge 15 percent}",
      applyEveryShadow: true
    });
  }

  if (key === "circular glow") {
    return appendShadowLayers(style, transform, valueRaw, applyOptionEntry, {
      preset:
        "shadow scale=1.25,shadow xshift=0pt,shadow yshift=0pt,fill=black!50,path fading={circle with fuzzy edge 15 percent}",
      applyEveryShadow: true
    });
  }

  if (key === "arrows") {
    const parsed = parseArrowSpecification(valueRaw, style);
    if (!parsed) {
      return { style, transform, diagnostics: [] };
    }
    return { style: { ...style, markerStart: parsed.start, markerEnd: parsed.end }, transform, diagnostics: [] };
  }
  if (key === ">") {
    const parsed = parseArrowSideSpecification(valueRaw, "end", style);
    if (!parsed) {
      return { style, transform, diagnostics: [] };
    }
    return { style: { ...style, arrowShorthandEnd: parsed }, transform, diagnostics: [] };
  }
  if (key === "<") {
    const parsed = parseArrowSideSpecification(valueRaw, "start", style);
    if (!parsed) {
      return { style, transform, diagnostics: [] };
    }
    return { style: { ...style, arrowShorthandStart: parsed }, transform, diagnostics: [] };
  }
  if (key === "tips") {
    const parsed = parseTipsMode(valueRaw);
    if (!parsed) {
      return { style, transform, diagnostics: [`invalid-tips:${valueRaw}`] };
    }
    return { style: { ...style, tipsMode: parsed }, transform, diagnostics: [] };
  }
  if (key === "shade") {
    const normalized = normalizeOptionValue(valueRaw).toLowerCase();
    if (normalized === "" || normalized === "true") {
      return { style: { ...style, fill: style.fill ?? "black", shadeEnabled: true }, transform, diagnostics: [] };
    }
    if (normalized === "false" || normalized === "none") {
      return { style: { ...style, shadeEnabled: false }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-shade:${valueRaw}`] };
  }
  if (key === "shading") {
    const shading = normalizeShadingName(valueRaw);
    if (!shading) {
      return { style, transform, diagnostics: [`invalid-shading:${valueRaw}`] };
    }
    return { style: { ...style, shading, shadeEnabled: true }, transform, diagnostics: [] };
  }
  if (key === "shading angle") {
    const angle = Number(valueRaw);
    if (!Number.isFinite(angle)) {
      return { style, transform, diagnostics: [`invalid-shading-angle:${valueRaw}`] };
    }
    return { style: { ...style, shadingAngle: angle, shadeEnabled: true }, transform, diagnostics: [] };
  }
  if (key === "top color") {
    const topColor = normalizeColor(valueRaw);
    const middleColor = mixNormalizedColors(topColor, style.axisBottomColor, 0.5) ?? style.axisMiddleColor;
    return {
      style: {
        ...style,
        shadeEnabled: true,
        shading: "axis",
        shadingAngle: 0,
        axisTopColor: topColor,
        axisMiddleColor: middleColor
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "bottom color") {
    const bottomColor = normalizeColor(valueRaw);
    const middleColor = mixNormalizedColors(style.axisTopColor, bottomColor, 0.5) ?? style.axisMiddleColor;
    return {
      style: {
        ...style,
        shadeEnabled: true,
        shading: "axis",
        shadingAngle: 0,
        axisBottomColor: bottomColor,
        axisMiddleColor: middleColor
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "middle color") {
    return {
      style: {
        ...style,
        shadeEnabled: true,
        shading: "axis",
        axisMiddleColor: normalizeColor(valueRaw)
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "left color") {
    const topColor = normalizeColor(valueRaw);
    const middleColor = mixNormalizedColors(topColor, style.axisBottomColor, 0.5) ?? style.axisMiddleColor;
    return {
      style: {
        ...style,
        shadeEnabled: true,
        shading: "axis",
        shadingAngle: 90,
        axisTopColor: topColor,
        axisMiddleColor: middleColor
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "right color") {
    const bottomColor = normalizeColor(valueRaw);
    const middleColor = mixNormalizedColors(style.axisTopColor, bottomColor, 0.5) ?? style.axisMiddleColor;
    return {
      style: {
        ...style,
        shadeEnabled: true,
        shading: "axis",
        shadingAngle: 90,
        axisBottomColor: bottomColor,
        axisMiddleColor: middleColor
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "ball color") {
    return {
      style: {
        ...style,
        shadeEnabled: true,
        shading: "ball",
        ballColor: normalizeColor(valueRaw)
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "inner color") {
    return {
      style: {
        ...style,
        shadeEnabled: true,
        shading: "radial",
        radialInnerColor: normalizeColor(valueRaw)
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "outer color") {
    return {
      style: {
        ...style,
        shadeEnabled: true,
        shading: "radial",
        radialOuterColor: normalizeColor(valueRaw)
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "lower left") {
    return {
      style: {
        ...style,
        shadeEnabled: true,
        shading: "bilinear interpolation",
        bilinearLowerLeft: normalizeColor(valueRaw)
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "lower right") {
    return {
      style: {
        ...style,
        shadeEnabled: true,
        shading: "bilinear interpolation",
        bilinearLowerRight: normalizeColor(valueRaw)
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "upper left") {
    return {
      style: {
        ...style,
        shadeEnabled: true,
        shading: "bilinear interpolation",
        bilinearUpperLeft: normalizeColor(valueRaw)
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "upper right") {
    return {
      style: {
        ...style,
        shadeEnabled: true,
        shading: "bilinear interpolation",
        bilinearUpperRight: normalizeColor(valueRaw)
      },
      transform,
      diagnostics: []
    };
  }

  if (key === "fill") {
    return { style: { ...style, fill: normalizeColor(valueRaw) }, transform, diagnostics: [] };
  }
  if (key === "draw") {
    if (valueRaw.trim().toLowerCase() === "none") {
      return { style: { ...style, stroke: null, drawExplicit: false }, transform, diagnostics: [] };
    }
    return { style: { ...style, stroke: normalizeColor(valueRaw), drawExplicit: true }, transform, diagnostics: [] };
  }
  if (key === "color") {
    if (valueRaw.trim().toLowerCase() === "none") {
      return { style: { ...style, stroke: null, textColor: null }, transform, diagnostics: [] };
    }
    const normalizedColor = normalizeColor(valueRaw);
    return { style: { ...style, stroke: normalizedColor, textColor: normalizedColor }, transform, diagnostics: [] };
  }
  if (key === "text") {
    return { style: { ...style, textColor: normalizeColor(valueRaw) }, transform, diagnostics: [] };
  }
  if (key === "text opacity") {
    const value = Number(valueRaw);
    if (Number.isFinite(value)) {
      return { style: { ...style, textOpacity: clamp01(value) }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-text-opacity:${valueRaw}`] };
  }
  if (key === "align") {
    const normalized = valueRaw.trim().toLowerCase();
    if (
      normalized === "left" ||
      normalized === "flush left" ||
      normalized === "right" ||
      normalized === "flush right" ||
      normalized === "center" ||
      normalized === "flush center" ||
      normalized === "justify" ||
      normalized === "none"
    ) {
      return { style: { ...style, textAlign: normalized }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-align:${valueRaw}`] };
  }
  if (key === "line width") {
    const length = parseLength(valueRaw, "pt");
    if (length == null) {
      return { style, transform, diagnostics: [`invalid-line-width:${valueRaw}`] };
    }
    return { style: { ...style, lineWidth: length }, transform, diagnostics: [] };
  }
  if (key === "double distance") {
    const length = parseLength(valueRaw, "pt");
    if (length == null || length < 0) {
      return { style, transform, diagnostics: [`invalid-double-distance:${valueRaw}`] };
    }
    return { style: { ...style, doubleStroke: true, doubleDistance: length }, transform, diagnostics: [] };
  }
  if (key === "node font" || key === "font") {
    const parsed = parseFontStyle(valueRaw);
    if (!parsed) {
      return { style, transform, diagnostics: [] };
    }
    return { style: { ...style, ...parsed }, transform, diagnostics: [] };
  }
  if (key === "radius") {
    const radius = parseLength(valueRaw, "cm");
    if (radius == null) {
      return { style, transform, diagnostics: [`invalid-radius:${valueRaw}`] };
    }
    return { style: { ...style, radius }, transform, diagnostics: [] };
  }
  if (key === "x radius") {
    const xRadius = parseLength(valueRaw, "cm");
    if (xRadius == null) {
      return { style, transform, diagnostics: [`invalid-x-radius:${valueRaw}`] };
    }
    return { style: { ...style, xRadius }, transform, diagnostics: [] };
  }
  if (key === "y radius") {
    const yRadius = parseLength(valueRaw, "cm");
    if (yRadius == null) {
      return { style, transform, diagnostics: [`invalid-y-radius:${valueRaw}`] };
    }
    return { style: { ...style, yRadius }, transform, diagnostics: [] };
  }
  if (key === "rounded corners") {
    const roundedCorners = parseLength(valueRaw, "pt");
    if (roundedCorners == null) {
      return { style, transform, diagnostics: [`invalid-rounded-corners:${valueRaw}`] };
    }
    return { style: { ...style, roundedCorners }, transform, diagnostics: [] };
  }
  if (key === "opacity") {
    const value = Number(valueRaw);
    if (Number.isFinite(value)) {
      return {
        style: {
          ...style,
          strokeOpacity: clamp01(value),
          fillOpacity: clamp01(value),
          textOpacity: clamp01(value)
        },
        transform,
        diagnostics: []
      };
    }
    return { style, transform, diagnostics: [`invalid-opacity:${valueRaw}`] };
  }
  if (key === "draw opacity") {
    const value = Number(valueRaw);
    if (Number.isFinite(value)) {
      return { style: { ...style, strokeOpacity: clamp01(value) }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-draw-opacity:${valueRaw}`] };
  }
  if (key === "fill opacity") {
    const value = Number(valueRaw);
    if (Number.isFinite(value)) {
      return { style: { ...style, fillOpacity: clamp01(value) }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-fill-opacity:${valueRaw}`] };
  }
  if (key === "line cap") {
    const normalized = valueRaw.trim().toLowerCase();
    if (normalized === "round" || normalized === "butt") {
      return { style: { ...style, lineCap: normalized }, transform, diagnostics: [] };
    }
    if (normalized === "rect" || normalized === "projecting") {
      return { style: { ...style, lineCap: "square" }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-line-cap:${valueRaw}`] };
  }
  if (key === "line join") {
    const normalized = valueRaw.trim().toLowerCase();
    if (normalized === "round" || normalized === "bevel" || normalized === "miter") {
      return { style: { ...style, lineJoin: normalized }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [`invalid-line-join:${valueRaw}`] };
  }
  if (key === "dash pattern") {
    const parsed = parseDashPattern(valueRaw);
    if (!parsed) {
      return { style, transform, diagnostics: [`invalid-dash-pattern:${valueRaw}`] };
    }
    return { style: { ...style, dashArray: parsed }, transform, diagnostics: [] };
  }
  if (key === "dash phase") {
    const phase = parseLength(valueRaw, "pt");
    if (phase == null) {
      return { style, transform, diagnostics: [`invalid-dash-phase:${valueRaw}`] };
    }
    return { style: { ...style, dashOffset: phase }, transform, diagnostics: [] };
  }
  if (key === "dash") {
    const parsed = parseDashValue(valueRaw);
    if (!parsed) {
      return { style, transform, diagnostics: [`invalid-dash:${valueRaw}`] };
    }
    return {
      style: {
        ...style,
        dashArray: parsed.pattern,
        dashOffset: parsed.phase ?? style.dashOffset
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "xshift") {
    const shift = parseLength(valueRaw, "pt");
    if (shift == null) {
      return { style, transform, diagnostics: [`invalid-xshift:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, translationMatrix(shift, 0)), diagnostics: [] };
  }
  if (key === "yshift") {
    const shift = parseLength(valueRaw, "pt");
    if (shift == null) {
      return { style, transform, diagnostics: [`invalid-yshift:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, translationMatrix(0, shift)), diagnostics: [] };
  }
  if (key === "shift") {
    const normalizedShift = normalizeOptionValue(valueRaw);
    const vector = parseCoordinateLike(normalizedShift);
    if (!vector) {
      return { style, transform, diagnostics: [`invalid-shift:${valueRaw}`] };
    }

    const x = parseLength(vector.x, "cm");
    const y = parseLength(vector.y, "cm");
    if (x == null || y == null) {
      return { style, transform, diagnostics: [`invalid-shift:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, translationMatrix(x, y)), diagnostics: [] };
  }
  if (key === "scale") {
    const factor = Number(valueRaw);
    if (!Number.isFinite(factor)) {
      return { style, transform, diagnostics: [`invalid-scale:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, scaleMatrix(factor, factor)), diagnostics: [] };
  }
  if (key === "xscale") {
    const factor = Number(valueRaw);
    if (!Number.isFinite(factor)) {
      return { style, transform, diagnostics: [`invalid-xscale:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, scaleMatrix(factor, 1)), diagnostics: [] };
  }
  if (key === "yscale") {
    const factor = Number(valueRaw);
    if (!Number.isFinite(factor)) {
      return { style, transform, diagnostics: [`invalid-yscale:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, scaleMatrix(1, factor)), diagnostics: [] };
  }
  if (key === "rotate") {
    const degrees = Number(valueRaw);
    if (!Number.isFinite(degrees)) {
      return { style, transform, diagnostics: [`invalid-rotate:${valueRaw}`] };
    }
    return { style, transform: multiplyMatrix(transform, rotationMatrix(degrees)), diagnostics: [] };
  }
  if (key === "x") {
    const parsed = parseAxisVector(valueRaw, "x");
    if (!parsed) {
      return { style, transform, diagnostics: [`invalid-x-axis:${valueRaw}`] };
    }
    const matrix = {
      ...transform,
      a: parsed.x / PT_PER_CM,
      b: parsed.y / PT_PER_CM
    };
    return { style, transform: matrix, diagnostics: [] };
  }
  if (key === "y") {
    const parsed = parseAxisVector(valueRaw, "y");
    if (!parsed) {
      return { style, transform, diagnostics: [`invalid-y-axis:${valueRaw}`] };
    }
    const matrix = {
      ...transform,
      c: parsed.x / PT_PER_CM,
      d: parsed.y / PT_PER_CM
    };
    return { style, transform: matrix, diagnostics: [] };
  }

  if (NON_STYLE_OPTION_KEYS.has(key)) {
    return { style, transform, diagnostics: [] };
  }

  return {
    style,
    transform,
    diagnostics: [`unsupported-option-key:${key}`]
  };
}

type AppendShadowOptions = {
  preset: string | null;
  applyEveryShadow: boolean;
  duplicateWithDoubleShift?: boolean;
  copyMainPaint?: boolean;
};

function appendShadowLayers(
  style: ResolvedStyle,
  transform: Matrix2D,
  valueRaw: string,
  applyOptionEntry: ApplyEntryFn,
  options: AppendShadowOptions
): ApplyOutcome {
  const seedStyle = toShadowSeedStyle(style);
  let workingStyle = options.copyMainPaint
    ? {
        ...seedStyle,
        stroke: SHADOW_INHERIT_STROKE,
        drawExplicit: true,
        fill: SHADOW_INHERIT_FILL
      }
    : seedStyle;
  let workingTransform = transform;
  const diagnostics: string[] = [];

  if (options.preset) {
    const presetList = parseStyleValueAsOptionList(options.preset);
    if (presetList) {
      const presetResult = applyOptionListEntries(presetList.entries, workingStyle, workingTransform, applyOptionEntry);
      workingStyle = presetResult.style;
      workingTransform = presetResult.transform;
      diagnostics.push(...presetResult.diagnostics);
    }
  }

  if (options.applyEveryShadow) {
    for (const list of style.everyShadowStyles) {
      const everyResult = applyOptionListEntries(list.entries, workingStyle, workingTransform, applyOptionEntry);
      workingStyle = everyResult.style;
      workingTransform = everyResult.transform;
      diagnostics.push(...everyResult.diagnostics);
    }
  }

  const nested = parseStyleValueAsOptionList(valueRaw);
  if (valueRaw.trim().length > 0 && !nested) {
    diagnostics.push(`invalid-style-value:${valueRaw}`);
  } else if (nested) {
    const nestedResult = applyOptionListEntries(nested.entries, workingStyle, workingTransform, applyOptionEntry);
    workingStyle = nestedResult.style;
    workingTransform = nestedResult.transform;
    diagnostics.push(...nestedResult.diagnostics);
  }

  const shadowLayer = makeShadowLayerFromStyle(workingStyle);
  const shadowLayers = options.duplicateWithDoubleShift
    ? [
        {
          ...shadowLayer,
          xshift: shadowLayer.xshift * 2,
          yshift: shadowLayer.yshift * 2
        },
        shadowLayer
      ]
    : [shadowLayer];

  return {
    style: {
      ...style,
      shadowLayers: [...style.shadowLayers, ...shadowLayers]
    },
    transform,
    diagnostics
  };
}

function applyOptionListEntries(
  entries: OptionEntry[],
  style: ResolvedStyle,
  transform: Matrix2D,
  applyOptionEntry: ApplyEntryFn
): ApplyOutcome {
  let nextStyle = style;
  let nextTransform = transform;
  const diagnostics: string[] = [];

  for (const entry of entries) {
    const outcome = applyOptionEntry(entry, nextStyle, nextTransform);
    nextStyle = outcome.style;
    nextTransform = outcome.transform;
    diagnostics.push(...outcome.diagnostics);
  }

  return { style: nextStyle, transform: nextTransform, diagnostics };
}

function makeShadowLayerFromStyle(style: ResolvedStyle): ShadowLayer {
  const scale = Number.isFinite(style.shadowScale) ? style.shadowScale : 1;
  const xshift = Number.isFinite(style.shadowXShift) ? style.shadowXShift : 0;
  const yshift = Number.isFinite(style.shadowYShift) ? style.shadowYShift : 0;
  const fade: ShadowFadeKind = style.shadowFade;
  return {
    scale,
    xshift,
    yshift,
    fade,
    style: extractShadowPaintStyle(style)
  };
}

function toShadowSeedStyle(style: ResolvedStyle): ResolvedStyle {
  return {
    ...style,
    stroke: null,
    drawExplicit: false,
    shadeEnabled: false,
    shadowLayers: []
  };
}

function extractShadowPaintStyle(style: ResolvedStyle): ShadowPaintStyle {
  return {
    stroke: style.stroke,
    fill: style.fill,
    fillRule: style.fillRule,
    doubleStroke: style.doubleStroke,
    doubleDistance: style.doubleDistance,
    lineWidth: style.lineWidth,
    dashArray: style.dashArray ? [...style.dashArray] : null,
    dashOffset: style.dashOffset,
    lineCap: style.lineCap,
    lineJoin: style.lineJoin,
    opacity: style.opacity,
    strokeOpacity: style.strokeOpacity,
    fillOpacity: style.fillOpacity,
    shadeEnabled: style.shadeEnabled,
    shading: style.shading,
    shadingAngle: style.shadingAngle,
    axisTopColor: style.axisTopColor,
    axisMiddleColor: style.axisMiddleColor,
    axisBottomColor: style.axisBottomColor,
    radialInnerColor: style.radialInnerColor,
    radialOuterColor: style.radialOuterColor,
    ballColor: style.ballColor,
    bilinearLowerLeft: style.bilinearLowerLeft,
    bilinearLowerRight: style.bilinearLowerRight,
    bilinearUpperLeft: style.bilinearUpperLeft,
    bilinearUpperRight: style.bilinearUpperRight
  };
}

function parseShadowFadeKind(valueRaw: string): ShadowFadeKind | null {
  const normalized = normalizeOptionValue(valueRaw).toLowerCase().replace(/\s+/g, " ");
  if (normalized === "circle with fuzzy edge 15 percent") {
    return "circle-fuzzy-edge-15";
  }
  if (normalized === "none" || normalized === "false") {
    return "none";
  }
  return null;
}
