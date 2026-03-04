import type {
  ResolvedPattern,
  ResolvedStyle,
  SceneElement,
  SceneFigure,
  ScenePathCommand,
  ShadowLayer
} from "../semantic/types.js";
import { COLOR_HEX } from "../semantic/style/constants.js";
import { SHADOW_INHERIT_FILL, SHADOW_INHERIT_STROKE } from "../semantic/types.js";
import { renderPathWithArrows } from "./arrows/render.js";
import type { RenderedArrowTipPath } from "./arrows/types.js";
import { createSvgModelBuilder, serializeSvgModel } from "./model.js";
import { computeViewBox } from "./viewbox.js";
import type { EmitSvgOptions, EmitSvgResult, SvgRenderModel, SvgRenderPart } from "./types.js";

type ShadowRenderableStyle = Pick<
  ResolvedStyle,
  | "stroke"
  | "fill"
  | "fillPattern"
  | "patternColor"
  | "fillRule"
  | "doubleStroke"
  | "doubleDistance"
  | "lineWidth"
  | "dashArray"
  | "dashOffset"
  | "lineCap"
  | "lineJoin"
  | "opacity"
  | "strokeOpacity"
  | "fillOpacity"
  | "shadeEnabled"
  | "shading"
  | "shadingAngle"
  | "axisTopColor"
  | "axisMiddleColor"
  | "axisBottomColor"
  | "radialInnerColor"
  | "radialOuterColor"
  | "ballColor"
  | "bilinearLowerLeft"
  | "bilinearLowerRight"
  | "bilinearUpperLeft"
  | "bilinearUpperRight"
>;

type PatternRenderableStyle = Pick<ResolvedStyle, "fill" | "fillPattern" | "patternColor">;

type ElementBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type SvgModelReuseContext = {
  affectedSourceIds: Set<string>;
  previousPartsByElementId: Map<string, SvgRenderPart[]>;
};

let currentPatternGlobalYPhase = 0;

export function emitSvg(scene: SceneFigure, opts: EmitSvgOptions = {}): EmitSvgResult {
  const model = emitSvgModel(scene, opts);
  return {
    svg: serializeSvgModel(model, opts.includeXmlns !== false),
    viewBox: model.viewBox,
    model,
    diagnostics: model.diagnostics
  };
}

export function emitSvgModel(scene: SceneFigure, opts: EmitSvgOptions = {}): SvgRenderModel {
  const padding = opts.padding ?? 12;
  const viewBox = computeViewBox(scene, padding);

  const diagnostics: EmitSvgResult["diagnostics"] = [];
  const modelBuilder = createSvgModelBuilder();
  const gradientIdBySignature = new Map<string, string>();
  const gradientDefById = new Map<string, string>();
  const patternIdBySignature = new Map<string, string>();
  const patternDefById = new Map<string, string>();
  const shadowMaskDefById = new Map<string, string>();
  const unsupportedShadingNames = new Set<string>();

  const appendPart = (
    basePartId: string,
    sourceId: string,
    elementId: string | null,
    markup: string
  ): void => {
    modelBuilder.addPart({
      basePartId,
      sourceId,
      elementId,
      markup
    });
  };

  const ensureGradientDefinition = (signature: string, kind: string, buildDef: (id: string) => string): string => {
    const existing = gradientIdBySignature.get(signature);
    if (existing) {
      return existing;
    }

    const id = `tikz-shading-${kind}-${gradientIdBySignature.size + 1}`;
    gradientIdBySignature.set(signature, id);
    gradientDefById.set(id, buildDef(id));
    return id;
  };

  const ensurePatternDefinition = (signature: string, buildDef: (id: string) => string): string => {
    const existing = patternIdBySignature.get(signature);
    if (existing) {
      return existing;
    }

    const id = `tikz-pattern-${patternIdBySignature.size + 1}`;
    patternIdBySignature.set(signature, id);
    patternDefById.set(id, buildDef(id));
    return id;
  };

  const ensureCircularShadowMaskDefinition = (): string => {
    const id = "tikz-shadow-mask-circle-fuzzy-15";
    if (shadowMaskDefById.has(id)) {
      return id;
    }

    shadowMaskDefById.set(id, renderCircularShadowMaskDefinition(id, `${id}-gradient`));
    return id;
  };

  const resolveShadingFill = (style: ShadowRenderableStyle, sourceId: string): string | null => {
    if (!style.shadeEnabled) {
      return null;
    }

    const shadingName = normalizeShadingName(style.shading);
    if (!shadingName || shadingName === "axis") {
      const signature = JSON.stringify({
        kind: "axis",
        angle: style.shadingAngle,
        top: style.axisTopColor,
        middle: style.axisMiddleColor,
        bottom: style.axisBottomColor
      });
      const id = ensureGradientDefinition(signature, "axis", (gradientId) =>
        renderAxisGradientDefinition(gradientId, style.shadingAngle, style.axisTopColor, style.axisMiddleColor, style.axisBottomColor)
      );
      return `url(#${id})`;
    }

    if (shadingName === "radial") {
      const signature = JSON.stringify({
        kind: "radial",
        inner: style.radialInnerColor,
        outer: style.radialOuterColor
      });
      const id = ensureGradientDefinition(signature, "radial", (gradientId) =>
        renderRadialGradientDefinition(gradientId, style.radialInnerColor, style.radialOuterColor)
      );
      return `url(#${id})`;
    }

    if (shadingName === "ball") {
      const signature = JSON.stringify({
        kind: "ball",
        color: style.ballColor
      });
      const id = ensureGradientDefinition(signature, "ball", (gradientId) => renderBallGradientDefinition(gradientId, style.ballColor));
      return `url(#${id})`;
    }

    if (!unsupportedShadingNames.has(shadingName)) {
      unsupportedShadingNames.add(shadingName);
      diagnostics.push({
        code: `unsupported-shading:${shadingName}`,
        message: `Shading "${shadingName}" is not currently supported in SVG output (source ${sourceId}).`
      });
    }

    return null;
  };

  const patternGlobalYPhase = viewBox.y * 2 + viewBox.height;

  const resolvePatternFill = (style: PatternRenderableStyle): string | null => {
    if (!style.fillPattern || !style.fill || style.fill === "none") {
      return null;
    }

    const pattern = style.fillPattern;
    const effectivePatternColor = pattern.kind === "legacy" && pattern.inherentlyColored ? null : style.patternColor;
    const signature = JSON.stringify({
      pattern,
      patternColor: effectivePatternColor
    });
    const id = ensurePatternDefinition(signature, (patternId) =>
      renderPatternDefinition(patternId, pattern, effectivePatternColor, patternGlobalYPhase)
    );
    return `url(#${id})`;
  };

  const resolveFillPaint = (style: ShadowRenderableStyle, sourceId: string): string | null => {
    return resolveShadingFill(style, sourceId) ?? resolvePatternFill(style);
  };

  const reuseContext = createSvgModelReuseContext(opts.reuse, viewBox);

  const registerDefsForElement = (element: SceneElement): void => {
    if (element.kind === "Path") {
      if (!hasDrawablePathCommands(element.commands)) {
        return;
      }
      const renderedPath = renderPathWithArrows(element);
      if (!hasDrawablePathCommands(renderedPath.shaftCommands)) {
        return;
      }
      const d = encodePathData(renderedPath.shaftCommands, viewBox);
      if (d.length === 0) {
        return;
      }
    } else if (element.kind === "Text") {
      return;
    }

    for (const layer of element.style.shadowLayers) {
      const layerStyle = resolveShadowLayerStyle(layer.style as ShadowRenderableStyle, element.style);
      if (layer.fade === "circle-fuzzy-edge-15") {
        ensureCircularShadowMaskDefinition();
      }
      resolveFillPaint(layerStyle, element.sourceId);
    }
    resolveFillPaint(element.style, element.sourceId);
  };

  for (const element of scene.elements) {
    if (reuseContext) {
      registerDefsForElement(element);
      if (tryReuseElementParts(modelBuilder, reuseContext, element)) {
        continue;
      }
    }

    if (element.kind === "Path") {
      if (!hasDrawablePathCommands(element.commands)) {
        diagnostics.push({
          code: "empty-path",
          message: `Skipping path ${element.id} because it has no drawable segments.`
        });
        continue;
      }

      const renderedPath = renderPathWithArrows(element);
      const shaftHasDrawableSegment = hasDrawablePathCommands(renderedPath.shaftCommands);
      if (shaftHasDrawableSegment) {
        const d = encodePathData(renderedPath.shaftCommands, viewBox);
        if (d.length > 0) {
          const pathBounds = computePathBounds(renderedPath.shaftCommands, viewBox);
          emitShadowPathPart({
            appendPart,
            sourceId: element.sourceId,
            elementId: element.id,
            d,
            bounds: pathBounds,
            shadowLayers: element.style.shadowLayers,
            baseStyle: element.style,
            resolveFillPaint,
            ensureCircularShadowMaskDefinition
          });

          if (shouldEmitDoubleStroke(element.style)) {
            const outerFill = resolveFillPaint(element.style, element.sourceId);
            const outerAttrs = styleAttributes(element.style, false, {
              lineWidth: element.style.lineWidth * 2 + element.style.doubleDistance,
              fill: outerFill ?? undefined
            });
            appendPart(
              `${element.id}:shaft:outer`,
              element.sourceId,
              element.id,
              `<path data-source-id="${escapeAttr(element.sourceId)}" d="${escapeAttr(d)}" ${outerAttrs.join(" ")} />`
            );
            const innerAttrs = styleAttributes(element.style, false, {
              stroke: "#ffffff",
              fill: "none",
              lineWidth: element.style.doubleDistance
            });
            appendPart(
              `${element.id}:shaft:inner`,
              element.sourceId,
              element.id,
              `<path data-source-id="${escapeAttr(element.sourceId)}" d="${escapeAttr(d)}" ${innerAttrs.join(" ")} />`
            );
          } else {
            const resolvedFill = resolveFillPaint(element.style, element.sourceId);
            const attrs = styleAttributes(element.style, false, {
              fill: resolvedFill ?? undefined
            });
            appendPart(
              `${element.id}:shaft`,
              element.sourceId,
              element.id,
              `<path data-source-id="${escapeAttr(element.sourceId)}" d="${escapeAttr(d)}" ${attrs.join(" ")} />`
            );
          }
        }
      }

      for (const tipPath of renderedPath.tipPaths) {
        const d = encodePathData(tipPath.commands, viewBox);
        if (d.length === 0) {
          continue;
        }
        const attrs = arrowTipAttributes(element.style, tipPath);
        appendPart(
          `${element.id}:tip:${tipPath.side}:${tipPath.index}:${tipPath.tipKind}:${tipPath.bend ? "bend" : "flat"}`,
          element.sourceId,
          element.id,
          `<path data-source-id="${escapeAttr(element.sourceId)}" data-arrow-tip-kind="${escapeAttr(tipPath.tipKind)}" ` +
            `data-arrow-side="${tipPath.side}" data-arrow-index="${tipPath.index}" data-arrow-bend="${tipPath.bend ? "true" : "false"}" ` +
            `d="${escapeAttr(d)}" ${attrs.join(" ")} />`
        );
      }
      continue;
    }

    if (element.kind === "Circle") {
      const center = toSvgPoint(element.center, viewBox);
      const circleBounds: ElementBounds = {
        minX: center.x - element.radius,
        minY: center.y - element.radius,
        maxX: center.x + element.radius,
        maxY: center.y + element.radius
      };
      emitShadowCircle({
        appendPart,
        sourceId: element.sourceId,
        elementId: element.id,
        cx: center.x,
        cy: center.y,
        radius: element.radius,
        bounds: circleBounds,
        shadowLayers: element.style.shadowLayers,
        baseStyle: element.style,
        resolveFillPaint,
        ensureCircularShadowMaskDefinition
      });
      if (shouldEmitDoubleStroke(element.style)) {
        const outerFill = resolveFillPaint(element.style, element.sourceId);
        const outerAttrs = styleAttributes(element.style, false, {
          lineWidth: element.style.lineWidth * 2 + element.style.doubleDistance,
          fill: outerFill ?? undefined
        });
        appendPart(
          `${element.id}:circle:outer`,
          element.sourceId,
          element.id,
          `<circle data-source-id="${escapeAttr(element.sourceId)}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(element.radius)}" ${outerAttrs.join(" ")} />`
        );
        const innerAttrs = styleAttributes(element.style, false, {
          stroke: "#ffffff",
          fill: "none",
          lineWidth: element.style.doubleDistance
        });
        appendPart(
          `${element.id}:circle:inner`,
          element.sourceId,
          element.id,
          `<circle data-source-id="${escapeAttr(element.sourceId)}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(element.radius)}" ${innerAttrs.join(" ")} />`
        );
      } else {
        const resolvedFill = resolveFillPaint(element.style, element.sourceId);
        const attrs = styleAttributes(element.style, false, {
          fill: resolvedFill ?? undefined
        });
        appendPart(
          `${element.id}:circle`,
          element.sourceId,
          element.id,
          `<circle data-source-id="${escapeAttr(element.sourceId)}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(element.radius)}" ${attrs.join(" ")} />`
        );
      }
      continue;
    }

    if (element.kind === "Ellipse") {
      const center = toSvgPoint(element.center, viewBox);
      const ellipseBounds = computeEllipseBounds(center.x, center.y, element.rx, element.ry, element.rotation ?? 0);
      emitShadowEllipse({
        appendPart,
        sourceId: element.sourceId,
        elementId: element.id,
        cx: center.x,
        cy: center.y,
        rx: element.rx,
        ry: element.ry,
        rotation: element.rotation ?? 0,
        bounds: ellipseBounds,
        shadowLayers: element.style.shadowLayers,
        baseStyle: element.style,
        resolveFillPaint,
        ensureCircularShadowMaskDefinition
      });
      if (shouldEmitDoubleStroke(element.style)) {
        const outerFill = resolveFillPaint(element.style, element.sourceId);
        const outerAttrs = styleAttributes(element.style, false, {
          lineWidth: element.style.lineWidth * 2 + element.style.doubleDistance,
          fill: outerFill ?? undefined
        });
        if (element.rotation && Math.abs(element.rotation) > 1e-6) {
          outerAttrs.push(`transform="rotate(${fmt(-element.rotation)} ${fmt(center.x)} ${fmt(center.y)})"`);
        }
        appendPart(
          `${element.id}:ellipse:outer`,
          element.sourceId,
          element.id,
          `<ellipse data-source-id="${escapeAttr(element.sourceId)}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" rx="${fmt(element.rx)}" ry="${fmt(element.ry)}" ${outerAttrs.join(" ")} />`
        );
        const innerAttrs = styleAttributes(element.style, false, {
          stroke: "#ffffff",
          fill: "none",
          lineWidth: element.style.doubleDistance
        });
        if (element.rotation && Math.abs(element.rotation) > 1e-6) {
          innerAttrs.push(`transform="rotate(${fmt(-element.rotation)} ${fmt(center.x)} ${fmt(center.y)})"`);
        }
        appendPart(
          `${element.id}:ellipse:inner`,
          element.sourceId,
          element.id,
          `<ellipse data-source-id="${escapeAttr(element.sourceId)}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" rx="${fmt(element.rx)}" ry="${fmt(element.ry)}" ${innerAttrs.join(" ")} />`
        );
      } else {
        const resolvedFill = resolveFillPaint(element.style, element.sourceId);
        const attrs = styleAttributes(element.style, false, {
          fill: resolvedFill ?? undefined
        });
        if (element.rotation && Math.abs(element.rotation) > 1e-6) {
          attrs.push(`transform="rotate(${fmt(-element.rotation)} ${fmt(center.x)} ${fmt(center.y)})"`);
        }
        appendPart(
          `${element.id}:ellipse`,
          element.sourceId,
          element.id,
          `<ellipse data-source-id="${escapeAttr(element.sourceId)}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" rx="${fmt(element.rx)}" ry="${fmt(element.ry)}" ${attrs.join(" ")} />`
        );
      }
      continue;
    }

    const position = toSvgPoint(element.position, viewBox);
    const textBlockWidth = element.textBlockWidth ?? estimateTextBlockWidth(element.text, element.style.fontSize);
    const textBlockHeight = element.textBlockHeight ?? Math.max(1, element.text.split("\n").length) * element.style.fontSize * 1.15;
    const rotation = element.rotation ?? 0;
    const hasRotation = Math.abs(rotation) > 1e-6;
    if (element.textRenderInfo?.mode === "mathjax") {
      const rendered = opts.textEngine?.renderFromCache(element.textRenderInfo.cacheKey) ?? null;
      if (!rendered) {
        diagnostics.push({
          code: "missing-mathjax-text-render",
          message: `Missing cached MathJax text render payload for ${element.id}.`
        });
      } else {
        const textColor = element.style.textColor ?? "#000000";
        const textOpacity = element.style.textOpacity ?? element.style.strokeOpacity;
        const x = position.x - textBlockWidth / 2;
        const y = position.y - textBlockHeight / 2;
        const renderedViewBox = `${fmt(rendered.viewBox.x)} ${fmt(rendered.viewBox.y)} ${fmt(rendered.viewBox.width)} ${fmt(rendered.viewBox.height)}`;
        const renderedSvg = `<svg data-source-id="${escapeAttr(element.sourceId)}" data-text-renderer="mathjax" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(textBlockWidth)}" height="${fmt(textBlockHeight)}" viewBox="${renderedViewBox}" color="${escapeAttr(textColor)}" opacity="${fmt(textOpacity)}" overflow="visible">${rendered.body}</svg>`;
        if (hasRotation) {
          appendPart(
            `${element.id}:text:mathjax:rotated`,
            element.sourceId,
            element.id,
            `<g transform="rotate(${fmt(-rotation)} ${fmt(position.x)} ${fmt(position.y)})">${renderedSvg}</g>`
          );
        } else {
          appendPart(`${element.id}:text:mathjax`, element.sourceId, element.id, renderedSvg);
        }
        continue;
      }
    }
    const textX = alignedTextAnchorX(position.x, textBlockWidth, element.style.textAlign);
    const attrs = styleAttributes(element.style, true);
    if (hasRotation) {
      attrs.push(`transform="rotate(${fmt(-rotation)} ${fmt(position.x)} ${fmt(position.y)})"`);
    }
    const textBody = encodeTextBody(element.text, textX, position.y);
    appendPart(
      `${element.id}:text`,
      element.sourceId,
      element.id,
      `<text data-source-id="${escapeAttr(element.sourceId)}" x="${fmt(textX)}" y="${fmt(position.y)}" ${attrs.join(" ")}>${textBody}</text>`
    );
  }

  const defsParts = [...gradientDefById.values(), ...patternDefById.values(), ...shadowMaskDefById.values()];
  return modelBuilder.build({
    viewBox,
    defs: defsParts,
    diagnostics
  });
}

function encodePathData(commands: ScenePathCommand[], viewBox: { y: number; height: number }): string {
  const chunks: string[] = [];
  for (const command of commands) {
    if (command.kind === "Z") {
      chunks.push("Z");
      continue;
    }

    if (command.kind === "A") {
      const to = toSvgPoint(command.to, viewBox);
      const sweep = command.sweep ? 0 : 1;
      chunks.push(
        // Path points are mirrored into SVG space (`toSvgPoint`), so arc rotation must be mirrored too.
        `A ${fmt(command.rx)} ${fmt(command.ry)} ${fmt(-command.xAxisRotation)} ${command.largeArc ? 1 : 0} ${sweep} ${fmt(to.x)} ${fmt(to.y)}`
      );
      continue;
    }

    if (command.kind === "C") {
      const c1 = toSvgPoint(command.c1, viewBox);
      const c2 = toSvgPoint(command.c2, viewBox);
      const to = toSvgPoint(command.to, viewBox);
      chunks.push(`C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(to.x)} ${fmt(to.y)}`);
      continue;
    }

    const point = toSvgPoint(command.to, viewBox);
    chunks.push(`${command.kind} ${fmt(point.x)} ${fmt(point.y)}`);
  }
  return chunks.join(" ");
}

function emitShadowPathPart(args: {
  appendPart: (basePartId: string, sourceId: string, elementId: string | null, markup: string) => void;
  sourceId: string;
  elementId: string | null;
  d: string;
  bounds: ElementBounds | null;
  shadowLayers: ShadowLayer[];
  baseStyle: ResolvedStyle;
  resolveFillPaint: (style: ShadowRenderableStyle, sourceId: string) => string | null;
  ensureCircularShadowMaskDefinition: () => string;
}): void {
  for (let index = 0; index < args.shadowLayers.length; index += 1) {
    const layer = args.shadowLayers[index];
    const layerStyle = resolveShadowLayerStyle(layer.style as ShadowRenderableStyle, args.baseStyle);
    const groupTransform = shadowTransformMatrix(layer, args.bounds);
    const maskId = layer.fade === "circle-fuzzy-edge-15" ? args.ensureCircularShadowMaskDefinition() : null;
    const shapes: string[] = [];

    if (shouldEmitDoubleStroke(layerStyle)) {
      const outerFill = args.resolveFillPaint(layerStyle, args.sourceId);
      const outerAttrs = styleAttributes(layerStyle, false, {
        lineWidth: layerStyle.lineWidth * 2 + layerStyle.doubleDistance,
        fill: outerFill ?? undefined
      });
      shapes.push(`<path data-source-id="${escapeAttr(args.sourceId)}" d="${escapeAttr(args.d)}" ${outerAttrs.join(" ")} />`);
      const innerAttrs = styleAttributes(layerStyle, false, {
        stroke: "#ffffff",
        fill: "none",
        lineWidth: layerStyle.doubleDistance
      });
      shapes.push(`<path data-source-id="${escapeAttr(args.sourceId)}" d="${escapeAttr(args.d)}" ${innerAttrs.join(" ")} />`);
    } else {
      const resolvedFill = args.resolveFillPaint(layerStyle, args.sourceId);
      const attrs = styleAttributes(layerStyle, false, {
        fill: resolvedFill ?? undefined
      });
      shapes.push(`<path data-source-id="${escapeAttr(args.sourceId)}" d="${escapeAttr(args.d)}" ${attrs.join(" ")} />`);
    }

    const groupAttrs = shadowGroupAttributes(args.sourceId, index + 1, layer, groupTransform, maskId);
    args.appendPart(
      `${args.elementId ?? args.sourceId}:shadow:path:${index + 1}`,
      args.sourceId,
      args.elementId,
      `<g ${groupAttrs.join(" ")}>${shapes.join("")}</g>`
    );
  }
}

function emitShadowCircle(args: {
  appendPart: (basePartId: string, sourceId: string, elementId: string | null, markup: string) => void;
  sourceId: string;
  elementId: string | null;
  cx: number;
  cy: number;
  radius: number;
  bounds: ElementBounds | null;
  shadowLayers: ShadowLayer[];
  baseStyle: ResolvedStyle;
  resolveFillPaint: (style: ShadowRenderableStyle, sourceId: string) => string | null;
  ensureCircularShadowMaskDefinition: () => string;
}): void {
  for (let index = 0; index < args.shadowLayers.length; index += 1) {
    const layer = args.shadowLayers[index];
    const layerStyle = resolveShadowLayerStyle(layer.style as ShadowRenderableStyle, args.baseStyle);
    const groupTransform = shadowTransformMatrix(layer, args.bounds);
    const maskId = layer.fade === "circle-fuzzy-edge-15" ? args.ensureCircularShadowMaskDefinition() : null;
    const shapes: string[] = [];

    if (shouldEmitDoubleStroke(layerStyle)) {
      const outerFill = args.resolveFillPaint(layerStyle, args.sourceId);
      const outerAttrs = styleAttributes(layerStyle, false, {
        lineWidth: layerStyle.lineWidth * 2 + layerStyle.doubleDistance,
        fill: outerFill ?? undefined
      });
      shapes.push(
        `<circle data-source-id="${escapeAttr(args.sourceId)}" cx="${fmt(args.cx)}" cy="${fmt(args.cy)}" r="${fmt(args.radius)}" ${outerAttrs.join(" ")} />`
      );
      const innerAttrs = styleAttributes(layerStyle, false, {
        stroke: "#ffffff",
        fill: "none",
        lineWidth: layerStyle.doubleDistance
      });
      shapes.push(
        `<circle data-source-id="${escapeAttr(args.sourceId)}" cx="${fmt(args.cx)}" cy="${fmt(args.cy)}" r="${fmt(args.radius)}" ${innerAttrs.join(" ")} />`
      );
    } else {
      const resolvedFill = args.resolveFillPaint(layerStyle, args.sourceId);
      const attrs = styleAttributes(layerStyle, false, {
        fill: resolvedFill ?? undefined
      });
      shapes.push(
        `<circle data-source-id="${escapeAttr(args.sourceId)}" cx="${fmt(args.cx)}" cy="${fmt(args.cy)}" r="${fmt(args.radius)}" ${attrs.join(" ")} />`
      );
    }

    const groupAttrs = shadowGroupAttributes(args.sourceId, index + 1, layer, groupTransform, maskId);
    args.appendPart(
      `${args.elementId ?? args.sourceId}:shadow:circle:${index + 1}`,
      args.sourceId,
      args.elementId,
      `<g ${groupAttrs.join(" ")}>${shapes.join("")}</g>`
    );
  }
}

function emitShadowEllipse(args: {
  appendPart: (basePartId: string, sourceId: string, elementId: string | null, markup: string) => void;
  sourceId: string;
  elementId: string | null;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;
  bounds: ElementBounds | null;
  shadowLayers: ShadowLayer[];
  baseStyle: ResolvedStyle;
  resolveFillPaint: (style: ShadowRenderableStyle, sourceId: string) => string | null;
  ensureCircularShadowMaskDefinition: () => string;
}): void {
  for (let index = 0; index < args.shadowLayers.length; index += 1) {
    const layer = args.shadowLayers[index];
    const layerStyle = resolveShadowLayerStyle(layer.style as ShadowRenderableStyle, args.baseStyle);
    const groupTransform = shadowTransformMatrix(layer, args.bounds);
    const maskId = layer.fade === "circle-fuzzy-edge-15" ? args.ensureCircularShadowMaskDefinition() : null;
    const shapes: string[] = [];

    if (shouldEmitDoubleStroke(layerStyle)) {
      const outerFill = args.resolveFillPaint(layerStyle, args.sourceId);
      const outerAttrs = styleAttributes(layerStyle, false, {
        lineWidth: layerStyle.lineWidth * 2 + layerStyle.doubleDistance,
        fill: outerFill ?? undefined
      });
      if (Math.abs(args.rotation) > 1e-6) {
        outerAttrs.push(`transform="rotate(${fmt(-args.rotation)} ${fmt(args.cx)} ${fmt(args.cy)})"`);
      }
      shapes.push(
        `<ellipse data-source-id="${escapeAttr(args.sourceId)}" cx="${fmt(args.cx)}" cy="${fmt(args.cy)}" rx="${fmt(args.rx)}" ry="${fmt(args.ry)}" ${outerAttrs.join(" ")} />`
      );
      const innerAttrs = styleAttributes(layerStyle, false, {
        stroke: "#ffffff",
        fill: "none",
        lineWidth: layerStyle.doubleDistance
      });
      if (Math.abs(args.rotation) > 1e-6) {
        innerAttrs.push(`transform="rotate(${fmt(-args.rotation)} ${fmt(args.cx)} ${fmt(args.cy)})"`);
      }
      shapes.push(
        `<ellipse data-source-id="${escapeAttr(args.sourceId)}" cx="${fmt(args.cx)}" cy="${fmt(args.cy)}" rx="${fmt(args.rx)}" ry="${fmt(args.ry)}" ${innerAttrs.join(" ")} />`
      );
    } else {
      const resolvedFill = args.resolveFillPaint(layerStyle, args.sourceId);
      const attrs = styleAttributes(layerStyle, false, {
        fill: resolvedFill ?? undefined
      });
      if (Math.abs(args.rotation) > 1e-6) {
        attrs.push(`transform="rotate(${fmt(-args.rotation)} ${fmt(args.cx)} ${fmt(args.cy)})"`);
      }
      shapes.push(
        `<ellipse data-source-id="${escapeAttr(args.sourceId)}" cx="${fmt(args.cx)}" cy="${fmt(args.cy)}" rx="${fmt(args.rx)}" ry="${fmt(args.ry)}" ${attrs.join(" ")} />`
      );
    }

    const groupAttrs = shadowGroupAttributes(args.sourceId, index + 1, layer, groupTransform, maskId);
    args.appendPart(
      `${args.elementId ?? args.sourceId}:shadow:ellipse:${index + 1}`,
      args.sourceId,
      args.elementId,
      `<g ${groupAttrs.join(" ")}>${shapes.join("")}</g>`
    );
  }
}

function shadowGroupAttributes(
  sourceId: string,
  index: number,
  layer: ShadowLayer,
  transform: string | null,
  maskId: string | null
): string[] {
  const attrs: string[] = [
    `data-source-id="${escapeAttr(sourceId)}"`,
    `data-shadow-layer="${index}"`
  ];
  if (layer.fade !== "none") {
    attrs.push(`data-shadow-fade="${escapeAttr(layer.fade)}"`);
  }
  if (transform) {
    attrs.push(`transform="${escapeAttr(transform)}"`);
  }
  if (maskId) {
    attrs.push(`mask="url(#${escapeAttr(maskId)})"`);
  }
  return attrs;
}

function shadowTransformMatrix(layer: ShadowLayer, bounds: ElementBounds | null): string | null {
  const scale = Number.isFinite(layer.scale) ? layer.scale : 1;
  const dx = Number.isFinite(layer.xshift) ? layer.xshift : 0;
  const dy = Number.isFinite(layer.yshift) ? -layer.yshift : 0;

  let e = dx;
  let f = dy;
  if (bounds) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    e += cx - scale * cx;
    f += cy - scale * cy;
  }

  if (Math.abs(scale - 1) <= 1e-6 && Math.abs(e) <= 1e-6 && Math.abs(f) <= 1e-6) {
    return null;
  }

  return `matrix(${fmt(scale)} 0 0 ${fmt(scale)} ${fmt(e)} ${fmt(f)})`;
}

function computePathBounds(commands: ScenePathCommand[], viewBox: { y: number; height: number }): ElementBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let previous: { x: number; y: number } | null = null;

  const includePoint = (point: { x: number; y: number }) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const command of commands) {
    if (command.kind === "Z") {
      continue;
    }

    if (command.kind === "C") {
      const c1 = toSvgPoint(command.c1, viewBox);
      const c2 = toSvgPoint(command.c2, viewBox);
      includePoint(c1);
      includePoint(c2);
    }

    if (command.kind === "A") {
      if (previous) {
        includePoint({ x: previous.x - command.rx, y: previous.y - command.ry });
        includePoint({ x: previous.x + command.rx, y: previous.y + command.ry });
      }
      const to = toSvgPoint(command.to, viewBox);
      includePoint({ x: to.x - command.rx, y: to.y - command.ry });
      includePoint({ x: to.x + command.rx, y: to.y + command.ry });
      previous = to;
      continue;
    }

    const point = toSvgPoint(command.to, viewBox);
    includePoint(point);
    previous = point;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function computeEllipseBounds(cx: number, cy: number, rx: number, ry: number, rotation: number): ElementBounds {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const extentX = Math.sqrt(rx * rx * cos * cos + ry * ry * sin * sin);
  const extentY = Math.sqrt(rx * rx * sin * sin + ry * ry * cos * cos);
  return {
    minX: cx - extentX,
    maxX: cx + extentX,
    minY: cy - extentY,
    maxY: cy + extentY
  };
}

function renderCircularShadowMaskDefinition(maskId: string, gradientId: string): string {
  return (
    `<radialGradient id="${escapeAttr(gradientId)}" gradientUnits="objectBoundingBox" cx="0.5" cy="0.5" r="0.5">` +
    `<stop offset="85%" stop-color="#ffffff" stop-opacity="1" />` +
    `<stop offset="100%" stop-color="#ffffff" stop-opacity="0" />` +
    `</radialGradient>` +
    `<mask id="${escapeAttr(maskId)}" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox">` +
    `<rect x="0" y="0" width="1" height="1" fill="url(#${escapeAttr(gradientId)})" />` +
    `</mask>`
  );
}

function resolveShadowLayerStyle(layerStyle: ShadowRenderableStyle, baseStyle: ResolvedStyle): ShadowRenderableStyle {
  const inheritsFill = layerStyle.fill === SHADOW_INHERIT_FILL;
  return {
    ...layerStyle,
    stroke: layerStyle.stroke === SHADOW_INHERIT_STROKE ? baseStyle.stroke : layerStyle.stroke,
    fill: inheritsFill ? baseStyle.fill : layerStyle.fill,
    fillPattern: inheritsFill ? baseStyle.fillPattern : (layerStyle.fillPattern ?? null),
    patternColor: inheritsFill ? baseStyle.patternColor : (layerStyle.patternColor ?? baseStyle.patternColor)
  };
}

function arrowTipAttributes(style: ResolvedStyle, tipPath: RenderedArrowTipPath): string[] {
  return [
    `stroke="${escapeAttr(tipPath.stroke)}"`,
    `fill="${escapeAttr(tipPath.fill)}"`,
    `stroke-width="${fmt(tipPath.strokeWidth)}"`,
    `stroke-linecap="${tipPath.lineCap}"`,
    `stroke-linejoin="${tipPath.lineJoin}"`,
    `stroke-opacity="${fmt(style.strokeOpacity)}"`,
    `fill-opacity="${fmt(style.fillOpacity)}"`
  ];
}

function normalizeShadingName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function renderAxisGradientDefinition(id: string, angle: number, topColor: string, middleColor: string, bottomColor: string): string {
  const resolvedAngle = Number.isFinite(angle) ? angle : 0;
  return (
    `<linearGradient id="${escapeAttr(id)}" gradientUnits="objectBoundingBox" x1="0.5" y1="1" x2="0.5" y2="0" ` +
    `gradientTransform="rotate(${fmt(-resolvedAngle)} 0.5 0.5)">` +
    `<stop offset="0%" stop-color="${escapeAttr(bottomColor)}" />` +
    `<stop offset="25%" stop-color="${escapeAttr(bottomColor)}" />` +
    `<stop offset="50%" stop-color="${escapeAttr(middleColor)}" />` +
    `<stop offset="75%" stop-color="${escapeAttr(topColor)}" />` +
    `<stop offset="100%" stop-color="${escapeAttr(topColor)}" />` +
    `</linearGradient>`
  );
}

function renderRadialGradientDefinition(id: string, innerColor: string, outerColor: string): string {
  return (
    `<radialGradient id="${escapeAttr(id)}" gradientUnits="objectBoundingBox" cx="0.5" cy="0.5" r="0.7071" fx="0.5" fy="0.5">` +
    `<stop offset="0%" stop-color="${escapeAttr(innerColor)}" />` +
    `<stop offset="50%" stop-color="${escapeAttr(outerColor)}" />` +
    `<stop offset="100%" stop-color="${escapeAttr(outerColor)}" />` +
    `</radialGradient>`
  );
}

function renderBallGradientDefinition(id: string, ballColor: string): string {
  const light15 = mixColors(ballColor, "#ffffff", 0.15) ?? ballColor;
  const light75 = mixColors(ballColor, "#ffffff", 0.75) ?? ballColor;
  const dark70 = mixColors(ballColor, "#000000", 0.7) ?? ballColor;
  const dark50 = mixColors(ballColor, "#000000", 0.5) ?? ballColor;

  return (
    `<radialGradient id="${escapeAttr(id)}" gradientUnits="objectBoundingBox" cx="0.5" cy="0.5" r="0.75" fx="0.3" fy="0.3">` +
    `<stop offset="0%" stop-color="${escapeAttr(light15)}" />` +
    `<stop offset="18%" stop-color="${escapeAttr(light75)}" />` +
    `<stop offset="36%" stop-color="${escapeAttr(dark70)}" />` +
    `<stop offset="50%" stop-color="${escapeAttr(dark50)}" />` +
    `<stop offset="100%" stop-color="#000000" />` +
    `</radialGradient>`
  );
}

function renderPatternDefinition(id: string, pattern: ResolvedPattern, patternColor: string | null, globalYPhase: number): string {
  const previousGlobalYPhase = currentPatternGlobalYPhase;
  currentPatternGlobalYPhase = globalYPhase;
  try {
    if (pattern.kind === "legacy") {
      return renderLegacyPatternDefinition(id, pattern, patternColor);
    }
    return renderMetaPatternDefinition(id, pattern, patternColor ?? "black");
  } finally {
    currentPatternGlobalYPhase = previousGlobalYPhase;
  }
}

function renderLegacyPatternDefinition(
  id: string,
  pattern: Extract<ResolvedPattern, { kind: "legacy" }>,
  patternColor: string | null
): string {
  const strokeColor = patternColor ?? "black";
  const mm = 2.84527559055;

  if (pattern.name === "horizontal lines") {
    return renderPatternElement(id, 0, 0, 3, 3, `<path d="M -1 0.5 L 4 0.5" stroke="${escapeAttr(strokeColor)}" stroke-width="0.4" fill="none" />`);
  }
  if (pattern.name === "vertical lines") {
    return renderPatternElement(id, 0, 0, 3, 3, `<path d="M 0.5 -1 L 0.5 4" stroke="${escapeAttr(strokeColor)}" stroke-width="0.4" fill="none" />`);
  }
  if (pattern.name === "north east lines") {
    return renderPatternElement(
      id,
      0,
      0,
      3,
      3,
      `<path d="M -1 4 L 4 -1" stroke="${escapeAttr(strokeColor)}" stroke-width="0.4" fill="none" />`
    );
  }
  if (pattern.name === "north west lines") {
    return renderPatternElement(
      id,
      0,
      0,
      3,
      3,
      `<path d="M -1 -1 L 4 4" stroke="${escapeAttr(strokeColor)}" stroke-width="0.4" fill="none" />`
    );
  }
  if (pattern.name === "grid") {
    return renderPatternElement(
      id,
      0,
      0,
      3,
      3,
      `<path d="M 0 -1 L 0 4 M -1 0 L 4 0" stroke="${escapeAttr(strokeColor)}" stroke-width="0.4" fill="none" />`
    );
  }
  if (pattern.name === "crosshatch") {
    return renderPatternElement(
      id,
      0,
      0,
      3,
      3,
      `<path d="M -1 -1 L 4 4 M -1 4 L 4 -1" stroke="${escapeAttr(strokeColor)}" stroke-width="0.4" fill="none" />`
    );
  }
  if (pattern.name === "dots") {
    return renderPatternElement(id, -1, -1, 3, 3, `<circle cx="0" cy="0" r="0.5" fill="${escapeAttr(strokeColor)}" />`);
  }
  if (pattern.name === "crosshatch dots") {
    return renderPatternElement(
      id,
      -1,
      -1,
      3,
      3,
      `<circle cx="0" cy="0" r="0.5" fill="${escapeAttr(strokeColor)}" /><circle cx="1.5" cy="-1.5" r="0.5" fill="${escapeAttr(
        strokeColor
      )}" />`
    );
  }
  if (pattern.name === "fivepointed stars") {
    const center = 1 * mm;
    const radius = 1 * mm;
    const pathData = polygonPathFromPolarAngles(center, center, radius, [18, 162, 306, 90, 234]);
    return renderPatternElement(id, 0, 0, 3 * mm, 3 * mm, `<path d="${escapeAttr(pathData)}" fill="${escapeAttr(strokeColor)}" />`);
  }
  if (pattern.name === "sixpointed stars") {
    const center = 1 * mm;
    const radius = 1 * mm;
    const first = polygonPathFromPolarAngles(center, center, radius, [30, 150, 270]);
    const second = polygonPathFromPolarAngles(center, center, radius, [-30, -270, -150]);
    return renderPatternElement(
      id,
      0,
      0,
      3 * mm,
      3 * mm,
      `<path d="${escapeAttr(`${first} ${second}`)}" fill="${escapeAttr(strokeColor)}" fill-rule="nonzero" />`
    );
  }
  if (pattern.name === "bricks") {
    return renderPatternElement(
      id,
      0,
      0,
      4 * mm,
      4 * mm,
      `<path d="M 0 ${fmt(1 * mm)} L ${fmt(4 * mm)} ${fmt(1 * mm)} M 0 ${fmt(3 * mm)} L ${fmt(4 * mm)} ${fmt(3 * mm)} ` +
        `M ${fmt(1 * mm)} 0 L ${fmt(1 * mm)} ${fmt(1 * mm)} M ${fmt(3 * mm)} ${fmt(1 * mm)} L ${fmt(3 * mm)} ${fmt(
          3 * mm
        )} M ${fmt(1 * mm)} ${fmt(3 * mm)} L ${fmt(1 * mm)} ${fmt(4 * mm)}" ` +
        `stroke="${escapeAttr(strokeColor)}" stroke-width="0.8" fill="none" />`
    );
  }
  if (pattern.name === "checkerboard") {
    return renderPatternElement(
      id,
      0,
      0,
      4 * mm,
      4 * mm,
      `<rect x="0" y="0" width="${fmt(2 * mm)}" height="${fmt(2 * mm)}" fill="${escapeAttr(strokeColor)}" />` +
        `<rect x="${fmt(2 * mm)}" y="${fmt(2 * mm)}" width="${fmt(2 * mm)}" height="${fmt(2 * mm)}" fill="${escapeAttr(strokeColor)}" />`
    );
  }

  if (pattern.name === "checkerboard light gray") {
    const dark = mixColors("#000000", "#ffffff", 0.2) ?? "#cccccc";
    return renderPatternElement(
      id,
      0,
      0,
      4 * mm,
      4 * mm,
      `<rect x="0" y="0" width="${fmt(4 * mm)}" height="${fmt(4 * mm)}" fill="#000000" />` +
        `<rect x="0" y="0" width="${fmt(2 * mm)}" height="${fmt(2 * mm)}" fill="${escapeAttr(dark)}" />` +
        `<rect x="${fmt(2 * mm)}" y="${fmt(2 * mm)}" width="${fmt(2 * mm)}" height="${fmt(2 * mm)}" fill="${escapeAttr(dark)}" />`
    );
  }
  if (pattern.name === "horizontal lines light gray") {
    return renderHorizontalBandPattern(id, mixColors("#000000", "#ffffff", 0.1) ?? "#e6e6e6", mixColors("#000000", "#ffffff", 0.15) ?? "#d9d9d9");
  }
  if (pattern.name === "horizontal lines gray") {
    return renderHorizontalBandPattern(id, mixColors("#000000", "#ffffff", 0.3) ?? "#b3b3b3", mixColors("#000000", "#ffffff", 0.35) ?? "#a6a6a6");
  }
  if (pattern.name === "horizontal lines dark gray") {
    return renderHorizontalBandPattern(id, mixColors("#000000", "#ffffff", 0.9) ?? "#1a1a1a", mixColors("#000000", "#ffffff", 0.85) ?? "#262626");
  }
  if (pattern.name === "horizontal lines light blue") {
    return renderHorizontalBandPattern(id, mixColors("#0000ff", "#ffffff", 0.1) ?? "#e6e6ff", mixColors("#0000ff", "#ffffff", 0.15) ?? "#d9d9ff");
  }
  if (pattern.name === "horizontal lines dark blue") {
    return renderHorizontalBandPattern(id, mixColors("#0000ff", "#ffffff", 0.9) ?? "#1a1aff", mixColors("#0000ff", "#ffffff", 0.85) ?? "#2626ff");
  }
  if (pattern.name === "crosshatch dots gray") {
    const background = mixColors("#000000", "#ffffff", 0.2) ?? "#cccccc";
    const light = mixColors("#000000", "#ffffff", 0.1) ?? "#e6e6e6";
    const dark = mixColors("#000000", "#ffffff", 0.7) ?? "#4d4d4d";
    return renderCrosshatchDotsPattern(id, background, light, dark);
  }
  if (pattern.name === "crosshatch dots light steel blue") {
    const steelBlue = "#afc3dd";
    const darkSteelBlue = mixColors("#000000", steelBlue, 0.5) ?? "#58626f";
    const light = mixColors(darkSteelBlue, "#ffffff", 0.1) ?? "#efeff2";
    const dark = mixColors(darkSteelBlue, "#ffffff", 0.7) ?? "#8a8f9b";
    return renderCrosshatchDotsPattern(id, steelBlue, light, dark);
  }

  return renderPatternElement(id, 0, 0, 3, 3, `<circle cx="1.5" cy="1.5" r="0.5" fill="${escapeAttr(strokeColor)}" />`);
}

function renderMetaPatternDefinition(
  id: string,
  pattern: Exclude<ResolvedPattern, { kind: "legacy" }>,
  patternColor: string
): string {
  const transform = buildPatternTransform(pattern.xshift, pattern.yshift, pattern.angle);
  if (pattern.kind === "meta-lines") {
    const halfDistance = pattern.distance / 2;
    return renderPatternElement(
      id,
      -halfDistance,
      -halfDistance,
      pattern.distance,
      pattern.distance,
      `<path d="M ${fmt(-halfDistance)} 0 L ${fmt(halfDistance)} 0" stroke="${escapeAttr(patternColor)}" stroke-width="${fmt(
        pattern.lineWidth
      )}" fill="none" />`,
      transform
    );
  }

  if (pattern.kind === "meta-hatch") {
    const halfDistance = pattern.distance / 2;
    return renderPatternElement(
      id,
      -halfDistance,
      -halfDistance,
      pattern.distance,
      pattern.distance,
      `<path d="M ${fmt(-halfDistance)} 0 L ${fmt(halfDistance)} 0 M 0 ${fmt(-halfDistance)} L 0 ${fmt(halfDistance)}" ` +
        `stroke="${escapeAttr(patternColor)}" stroke-width="${fmt(pattern.lineWidth)}" fill="none" />`,
      transform
    );
  }

  if (pattern.kind === "meta-dots") {
    const halfDistance = pattern.distance / 2;
    return renderPatternElement(
      id,
      -halfDistance,
      -halfDistance,
      pattern.distance,
      pattern.distance,
      `<circle cx="0" cy="0" r="${fmt(pattern.radius)}" fill="${escapeAttr(patternColor)}" />`,
      transform
    );
  }

  const halfDistance = pattern.distance / 2;
  const starPath = buildStarPath(pattern.radius, pattern.points);
  return renderPatternElement(
    id,
    -halfDistance,
    -halfDistance,
    pattern.distance,
    pattern.distance,
    `<path d="${escapeAttr(starPath)}" fill="${escapeAttr(patternColor)}" />`,
    transform
  );
}

function renderHorizontalBandPattern(id: string, firstColor: string, secondColor: string): string {
  return renderPatternElement(
    id,
    0,
    0,
    100,
    4,
    `<rect x="0" y="0" width="100" height="2.5" fill="${escapeAttr(firstColor)}" />` +
      `<rect x="0" y="2" width="100" height="2.5" fill="${escapeAttr(secondColor)}" />`
  );
}

function renderCrosshatchDotsPattern(id: string, background: string, lightDots: string, darkDots: string): string {
  return renderPatternElement(
    id,
    0,
    0,
    8,
    8,
    `<rect x="0" y="0" width="8" height="8" fill="${escapeAttr(background)}" />` +
      `<circle cx="2" cy="1.75" r="1" fill="${escapeAttr(lightDots)}" />` +
      `<circle cx="6" cy="5.75" r="1" fill="${escapeAttr(lightDots)}" />` +
      `<circle cx="2" cy="2.25" r="1" fill="${escapeAttr(darkDots)}" />` +
      `<circle cx="6" cy="6.25" r="1" fill="${escapeAttr(darkDots)}" />`
  );
}

function renderPatternElement(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  body: string,
  patternTransform?: string | null
): string {
  const transformParts: string[] = [];
  const effectiveGlobalPhase = currentPatternGlobalYPhase - y;
  if (Math.abs(effectiveGlobalPhase) > 1e-6) {
    // Keep pattern coordinates in the same affine y frame as toSvgPoint: y_svg = C - y.
    transformParts.push(`translate(0 ${fmt(effectiveGlobalPhase)})`);
  }
  if (patternTransform && patternTransform.trim().length > 0) {
    transformParts.push(patternTransform.trim());
  }
  const transformAttr = transformParts.length > 0 ? ` patternTransform="${escapeAttr(transformParts.join(" "))}"` : "";
  const offsetBody =
    Math.abs(x) > 1e-6 || Math.abs(y) > 1e-6 ? `<g transform="translate(${fmt(-x)} ${fmt(-y)})">${body}</g>` : body;
  return (
    `<pattern id="${escapeAttr(id)}" patternUnits="userSpaceOnUse" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(
      height
    )}"${transformAttr}>` +
    offsetBody +
    `</pattern>`
  );
}

function buildPatternTransform(xshift: number, yshift: number, angle: number): string | null {
  const transforms: string[] = [];
  if (Math.abs(xshift) > 1e-6 || Math.abs(yshift) > 1e-6) {
    transforms.push(`translate(${fmt(xshift)} ${fmt(-yshift)})`);
  }
  if (Math.abs(angle) > 1e-6) {
    transforms.push(`rotate(${fmt(-angle)})`);
  }
  return transforms.length > 0 ? transforms.join(" ") : null;
}

function buildStarPath(radius: number, points: number): string {
  const outer = polarPoint(90, radius);
  const commands: string[] = [`M ${fmt(outer.x)} ${fmt(outer.y)}`];
  const step = 180 / points;
  for (let i = 1; i <= points; i += 1) {
    const inner = polarPoint(90 + 2 * i * step - step, radius * 0.5);
    const outerPoint = polarPoint(90 + 2 * i * step, radius);
    commands.push(`L ${fmt(inner.x)} ${fmt(inner.y)}`);
    commands.push(`L ${fmt(outerPoint.x)} ${fmt(outerPoint.y)}`);
  }
  commands.push("Z");
  return commands.join(" ");
}

function polygonPathFromPolarAngles(centerX: number, centerY: number, radius: number, angles: number[]): string {
  if (angles.length === 0) {
    return "";
  }
  const points = angles.map((angle) => {
    const point = polarPoint(angle, radius);
    return {
      x: centerX + point.x,
      y: centerY + point.y
    };
  });
  const [first, ...rest] = points;
  if (!first) {
    return "";
  }
  return `M ${fmt(first.x)} ${fmt(first.y)} ${rest.map((point) => `L ${fmt(point.x)} ${fmt(point.y)}`).join(" ")} Z`;
}

function polarPoint(angleDeg: number, radius: number): { x: number; y: number } {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: radius * Math.cos(radians),
    y: -radius * Math.sin(radians)
  };
}

function mixColors(first: string, second: string, ratioFirst: number): string | null {
  const c1 = toRgb(first);
  const c2 = toRgb(second);
  if (!c1 || !c2) {
    return null;
  }

  const t = clamp01(ratioFirst);
  return rgbToHex({
    r: Math.round(c1.r * t + c2.r * (1 - t)),
    g: Math.round(c1.g * t + c2.g * (1 - t)),
    b: Math.round(c1.b * t + c2.b * (1 - t))
  });
}

function toRgb(color: string): { r: number; g: number; b: number } | null {
  const normalized = color.trim().toLowerCase();
  if (normalized in COLOR_HEX) {
    return hexToRgb(COLOR_HEX[normalized as keyof typeof COLOR_HEX]);
  }
  if (/^#[0-9a-f]{3}$/i.test(normalized) || /^#[0-9a-f]{6}$/i.test(normalized)) {
    return hexToRgb(normalized);
  }
  return null;
}

function styleAttributes(
  style: ResolvedStyle | ShadowRenderableStyle,
  isText = false,
  overrides: { stroke?: string | null; fill?: string | null; lineWidth?: number } = {}
): string[] {
  const attrs: string[] = [];
  if (isText) {
    const textStyle = style as ResolvedStyle;
    const textColor = textStyle.textColor ?? "#000000";
    attrs.push(`fill="${escapeAttr(textColor)}"`);
    attrs.push(`fill-opacity="${fmt(textStyle.textOpacity ?? textStyle.strokeOpacity)}"`);
    if (textStyle.fontFamily === "sans") {
      attrs.push(`font-family="CMU Sans Serif, Latin Modern Sans, Helvetica, Arial, sans-serif"`);
    } else if (textStyle.fontFamily === "monospace") {
      attrs.push(`font-family="Latin Modern Mono, CMU Typewriter Text, Courier New, monospace"`);
    } else {
      attrs.push(`font-family="CMU Serif, Latin Modern Roman, Times New Roman, serif"`);
    }
    attrs.push(`font-size="${fmt(textStyle.fontSize)}"`);
    if (textStyle.fontWeight === "bold") {
      attrs.push(`font-weight="700"`);
    }
    if (textStyle.fontStyle === "italic") {
      attrs.push(`font-style="italic"`);
    }
    attrs.push(`text-anchor="${textAnchorForAlign(textStyle.textAlign)}"`);
    attrs.push(`dominant-baseline="middle"`);
    attrs.push(`xml:space="preserve"`);
    return attrs;
  }

  attrs.push(`stroke="${escapeAttr(overrides.stroke ?? style.stroke ?? "none")}"`);
  attrs.push(`fill="${escapeAttr(overrides.fill ?? (style.fill && style.fill !== "none" ? style.fill : "none"))}"`);
  if (style.fillRule === "evenodd") {
    attrs.push(`fill-rule="evenodd"`);
  }
  attrs.push(`stroke-width="${fmt(overrides.lineWidth ?? style.lineWidth)}"`);
  attrs.push(`stroke-linecap="${style.lineCap}"`);
  attrs.push(`stroke-linejoin="${style.lineJoin}"`);
  attrs.push(`stroke-opacity="${fmt(style.strokeOpacity)}"`);
  attrs.push(`fill-opacity="${fmt(style.fillOpacity)}"`);
  if (style.dashArray && style.dashArray.length > 0) {
    attrs.push(`stroke-dasharray="${style.dashArray.map((entry) => fmt(entry)).join(" ")}"`);
    if (Math.abs(style.dashOffset) > 1e-6) {
      attrs.push(`stroke-dashoffset="${fmt(style.dashOffset)}"`);
    }
  }
  return attrs;
}

function shouldEmitDoubleStroke(style: {
  stroke: string | null;
  doubleStroke: boolean;
  doubleDistance: number;
}): boolean {
  return style.doubleStroke && style.stroke != null && style.stroke !== "none" && style.doubleDistance > 0;
}

function toSvgPoint(point: { x: number; y: number }, viewBox: { y: number; height: number }): { x: number; y: number } {
  return {
    x: point.x,
    y: viewBox.y + viewBox.height - (point.y - viewBox.y)
  };
}

function fmt(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace(/^#/, "");
  const value = normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized;
  const parsed = Number.parseInt(value, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255
  };
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  return (
    "#" +
    [rgb.r, rgb.g, rgb.b]
      .map((component) => Math.max(0, Math.min(255, component)))
      .map((component) => component.toString(16).padStart(2, "0"))
      .join("")
  );
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

function textAnchorForAlign(
  align: "left" | "flush left" | "right" | "flush right" | "center" | "flush center" | "justify" | "none" | undefined
): "start" | "middle" | "end" {
  if (!align) {
    return "middle";
  }
  if (align === "left" || align === "flush left" || align === "justify") {
    return "start";
  }
  if (align === "right" || align === "flush right") {
    return "end";
  }
  return "middle";
}

function alignedTextAnchorX(
  centerX: number,
  blockWidth: number,
  align: "left" | "flush left" | "right" | "flush right" | "center" | "flush center" | "justify" | "none" | undefined
): number {
  if (!Number.isFinite(blockWidth) || blockWidth <= 0) {
    return centerX;
  }
  if (align === "left" || align === "flush left" || align === "justify") {
    return centerX - blockWidth / 2;
  }
  if (align === "right" || align === "flush right") {
    return centerX + blockWidth / 2;
  }
  return centerX;
}

function estimateTextBlockWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  if (maxChars <= 0) {
    return 0;
  }
  return maxChars * fontSize * 0.7;
}

function encodeTextBody(text: string, x: number, y: number): string {
  const lines = text.split("\n");
  if (lines.length <= 1) {
    return escapeText(text);
  }

  const lineHeightEm = 1.15;
  const startOffsetEm = -((lines.length - 1) * lineHeightEm) / 2;
  return lines
    .map((line, index) => {
      if (index === 0) {
        return `<tspan x="${fmt(x)}" y="${fmt(y)}" dy="${fmt(startOffsetEm)}em">${escapeText(line)}</tspan>`;
      }
      return `<tspan x="${fmt(x)}" dy="${fmt(lineHeightEm)}em">${escapeText(line)}</tspan>`;
    })
    .join("");
}

function hasDrawablePathCommands(commands: ScenePathCommand[]): boolean {
  return commands.some((command) => command.kind === "L" || command.kind === "C" || command.kind === "A");
}

function createSvgModelReuseContext(
  reuse: EmitSvgOptions["reuse"] | undefined,
  viewBox: SvgRenderModel["viewBox"]
): SvgModelReuseContext | null {
  if (!reuse?.previousModel || !reuse.affectedSourceIds || reuse.affectedSourceIds.length === 0) {
    return null;
  }
  if (!hasReusableModelInvariants(reuse.previousModel)) {
    return null;
  }
  if (!sameViewBox(reuse.previousModel.viewBox, viewBox)) {
    return null;
  }

  const previousPartsByElementId = new Map<string, SvgRenderPart[]>();
  for (const part of reuse.previousModel.parts) {
    if (!part.elementId) {
      return null;
    }
    const existing = previousPartsByElementId.get(part.elementId);
    if (existing) {
      existing.push(part);
    } else {
      previousPartsByElementId.set(part.elementId, [part]);
    }
  }

  return {
    affectedSourceIds: new Set(reuse.affectedSourceIds),
    previousPartsByElementId
  };
}

function tryReuseElementParts(
  modelBuilder: ReturnType<typeof createSvgModelBuilder>,
  context: SvgModelReuseContext,
  element: SceneElement
): boolean {
  if (context.affectedSourceIds.has(element.sourceId)) {
    return false;
  }
  const reusableParts = context.previousPartsByElementId.get(element.id);
  if (!reusableParts || reusableParts.length === 0) {
    return false;
  }
  for (const part of reusableParts) {
    if (part.sourceId !== element.sourceId || part.elementId !== element.id) {
      return false;
    }
  }
  for (const part of reusableParts) {
    modelBuilder.addExistingPart(part);
  }
  return true;
}

function hasReusableModelInvariants(model: SvgRenderModel): boolean {
  const partIds = new Set<string>();
  for (let index = 0; index < model.parts.length; index += 1) {
    const part = model.parts[index];
    if (!part) {
      return false;
    }
    if (part.order !== index) {
      return false;
    }
    if (partIds.has(part.partId)) {
      return false;
    }
    partIds.add(part.partId);
  }
  return true;
}

function sameViewBox(left: SvgRenderModel["viewBox"], right: SvgRenderModel["viewBox"]): boolean {
  return (
    Math.abs(left.x - right.x) <= 1e-9 &&
    Math.abs(left.y - right.y) <= 1e-9 &&
    Math.abs(left.width - right.width) <= 1e-9 &&
    Math.abs(left.height - right.height) <= 1e-9
  );
}
