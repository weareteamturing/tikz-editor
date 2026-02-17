import type {
  ArrowMarker,
  ArrowTip,
  ResolvedStyle,
  SceneElement,
  SceneFigure,
  ScenePath,
  ScenePathCommand,
  ShadowLayer
} from "../semantic/types.js";
import { COLOR_HEX } from "../semantic/style/constants.js";
import { SHADOW_INHERIT_FILL, SHADOW_INHERIT_STROKE } from "../semantic/types.js";
import { computeViewBox } from "./viewbox.js";
import type { EmitSvgOptions, EmitSvgResult } from "./types.js";

type ShadowRenderableStyle = Pick<
  ResolvedStyle,
  | "stroke"
  | "fill"
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

type ElementBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function emitSvg(scene: SceneFigure, opts: EmitSvgOptions = {}): EmitSvgResult {
  const padding = opts.padding ?? 12;
  const viewBox = computeViewBox(scene, padding);

  const diagnostics: EmitSvgResult["diagnostics"] = [];
  const body: string[] = [];
  const markerIdBySignature = new Map<string, string>();
  const markerDefById = new Map<string, string>();
  const gradientIdBySignature = new Map<string, string>();
  const gradientDefById = new Map<string, string>();
  const shadowMaskDefById = new Map<string, string>();
  const unsupportedShadingNames = new Set<string>();

  const ensureMarkerDefinition = (marker: ArrowMarker): string => {
    const signature = markerSignature(marker);
    const existing = markerIdBySignature.get(signature);
    if (existing) {
      return existing;
    }

    const preferredId = preferredMarkerId(marker);
    const id = preferredId && !markerDefById.has(preferredId) ? preferredId : `tikz-marker-${markerIdBySignature.size + 1}`;
    markerIdBySignature.set(signature, id);
    markerDefById.set(id, renderMarkerDefinition(id, marker));
    return id;
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

  for (const element of scene.elements) {
    if (element.kind === "Path") {
      if (!hasDrawablePathCommands(element.commands)) {
        diagnostics.push({
          code: "empty-path",
          message: `Skipping path ${element.id} because it has no drawable segments.`
        });
        continue;
      }

      const parts = buildPathRenderParts(element, ensureMarkerDefinition);
      const pathBounds = computePathBounds(element.commands, viewBox);
      for (const part of parts) {
        const d = encodePathData(part.commands, viewBox);
        if (d.length === 0) {
          continue;
        }

        if (part.markerOnly) {
          const markerAttrs = styleAttributes(element.style, false, {
            stroke: "none",
            fill: "none"
          });
          if (part.markerStartId) {
            markerAttrs.push(`marker-start="url(#${part.markerStartId})"`);
          }
          if (part.markerEndId) {
            markerAttrs.push(`marker-end="url(#${part.markerEndId})"`);
          }
          body.push(`<path data-source-id="${escapeAttr(element.sourceId)}" d="${escapeAttr(d)}" ${markerAttrs.join(" ")} />`);
          continue;
        }

        emitShadowPathPart({
          body,
          sourceId: element.sourceId,
          d,
          bounds: pathBounds,
          shadowLayers: element.style.shadowLayers,
          baseStyle: element.style,
          resolveShadingFill,
          ensureCircularShadowMaskDefinition
        });

        if (shouldEmitDoubleStroke(element.style)) {
          const outerFill = resolveShadingFill(element.style, element.sourceId);
          const outerAttrs = styleAttributes(element.style, false, {
            lineWidth: element.style.lineWidth * 2 + element.style.doubleDistance,
            fill: outerFill ?? undefined
          });
          if (part.markerStartId) {
            outerAttrs.push(`marker-start="url(#${part.markerStartId})"`);
          }
          if (part.markerEndId) {
            outerAttrs.push(`marker-end="url(#${part.markerEndId})"`);
          }
          body.push(`<path data-source-id="${escapeAttr(element.sourceId)}" d="${escapeAttr(d)}" ${outerAttrs.join(" ")} />`);
          const innerAttrs = styleAttributes(element.style, false, {
            stroke: "#ffffff",
            fill: "none",
            lineWidth: element.style.doubleDistance
          });
          body.push(`<path data-source-id="${escapeAttr(element.sourceId)}" d="${escapeAttr(d)}" ${innerAttrs.join(" ")} />`);
          continue;
        }

        const shadingFill = resolveShadingFill(element.style, element.sourceId);
        const attrs = styleAttributes(element.style, false, {
          fill: shadingFill ?? undefined
        });
        if (part.markerStartId) {
          attrs.push(`marker-start="url(#${part.markerStartId})"`);
        }
        if (part.markerEndId) {
          attrs.push(`marker-end="url(#${part.markerEndId})"`);
        }
        body.push(`<path data-source-id="${escapeAttr(element.sourceId)}" d="${escapeAttr(d)}" ${attrs.join(" ")} />`);
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
        body,
        sourceId: element.sourceId,
        cx: center.x,
        cy: center.y,
        radius: element.radius,
        bounds: circleBounds,
        shadowLayers: element.style.shadowLayers,
        baseStyle: element.style,
        resolveShadingFill,
        ensureCircularShadowMaskDefinition
      });
      if (shouldEmitDoubleStroke(element.style)) {
        const outerFill = resolveShadingFill(element.style, element.sourceId);
        const outerAttrs = styleAttributes(element.style, false, {
          lineWidth: element.style.lineWidth * 2 + element.style.doubleDistance,
          fill: outerFill ?? undefined
        });
        body.push(
          `<circle data-source-id="${escapeAttr(element.sourceId)}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(element.radius)}" ${outerAttrs.join(" ")} />`
        );
        const innerAttrs = styleAttributes(element.style, false, {
          stroke: "#ffffff",
          fill: "none",
          lineWidth: element.style.doubleDistance
        });
        body.push(
          `<circle data-source-id="${escapeAttr(element.sourceId)}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(element.radius)}" ${innerAttrs.join(" ")} />`
        );
      } else {
        const shadingFill = resolveShadingFill(element.style, element.sourceId);
        const attrs = styleAttributes(element.style, false, {
          fill: shadingFill ?? undefined
        });
        body.push(
          `<circle data-source-id="${escapeAttr(element.sourceId)}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(element.radius)}" ${attrs.join(" ")} />`
        );
      }
      continue;
    }

    if (element.kind === "Ellipse") {
      const center = toSvgPoint(element.center, viewBox);
      const ellipseBounds = computeEllipseBounds(center.x, center.y, element.rx, element.ry, element.rotation ?? 0);
      emitShadowEllipse({
        body,
        sourceId: element.sourceId,
        cx: center.x,
        cy: center.y,
        rx: element.rx,
        ry: element.ry,
        rotation: element.rotation ?? 0,
        bounds: ellipseBounds,
        shadowLayers: element.style.shadowLayers,
        baseStyle: element.style,
        resolveShadingFill,
        ensureCircularShadowMaskDefinition
      });
      if (shouldEmitDoubleStroke(element.style)) {
        const outerFill = resolveShadingFill(element.style, element.sourceId);
        const outerAttrs = styleAttributes(element.style, false, {
          lineWidth: element.style.lineWidth * 2 + element.style.doubleDistance,
          fill: outerFill ?? undefined
        });
        if (element.rotation && Math.abs(element.rotation) > 1e-6) {
          outerAttrs.push(`transform="rotate(${fmt(-element.rotation)} ${fmt(center.x)} ${fmt(center.y)})"`);
        }
        body.push(
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
        body.push(
          `<ellipse data-source-id="${escapeAttr(element.sourceId)}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" rx="${fmt(element.rx)}" ry="${fmt(element.ry)}" ${innerAttrs.join(" ")} />`
        );
      } else {
        const shadingFill = resolveShadingFill(element.style, element.sourceId);
        const attrs = styleAttributes(element.style, false, {
          fill: shadingFill ?? undefined
        });
        if (element.rotation && Math.abs(element.rotation) > 1e-6) {
          attrs.push(`transform="rotate(${fmt(-element.rotation)} ${fmt(center.x)} ${fmt(center.y)})"`);
        }
        body.push(
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
          body.push(`<g transform="rotate(${fmt(-rotation)} ${fmt(position.x)} ${fmt(position.y)})">${renderedSvg}</g>`);
        } else {
          body.push(renderedSvg);
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
    body.push(`<text data-source-id="${escapeAttr(element.sourceId)}" x="${fmt(textX)}" y="${fmt(position.y)}" ${attrs.join(" ")}>${textBody}</text>`);
  }

  const defsParts = [...markerDefById.values(), ...gradientDefById.values(), ...shadowMaskDefById.values()];
  const defs = defsParts.length > 0 ? `<defs>${defsParts.join("")}</defs>` : "";

  const xmlns = opts.includeXmlns === false ? "" : ` xmlns="http://www.w3.org/2000/svg"`;
  const svg =
    `<svg${xmlns} viewBox="${fmt(viewBox.x)} ${fmt(viewBox.y)} ${fmt(viewBox.width)} ${fmt(viewBox.height)}" role="img" aria-label="TikZ SVG preview">` +
    defs +
    body.join("") +
    `</svg>`;

  return { svg, viewBox, diagnostics };
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
  body: string[];
  sourceId: string;
  d: string;
  bounds: ElementBounds | null;
  shadowLayers: ShadowLayer[];
  baseStyle: ResolvedStyle;
  resolveShadingFill: (style: ShadowRenderableStyle, sourceId: string) => string | null;
  ensureCircularShadowMaskDefinition: () => string;
}): void {
  for (let index = 0; index < args.shadowLayers.length; index += 1) {
    const layer = args.shadowLayers[index];
    const layerStyle = resolveShadowLayerStyle(layer.style as ShadowRenderableStyle, args.baseStyle);
    const groupTransform = shadowTransformMatrix(layer, args.bounds);
    const maskId = layer.fade === "circle-fuzzy-edge-15" ? args.ensureCircularShadowMaskDefinition() : null;
    const shapes: string[] = [];

    if (shouldEmitDoubleStroke(layerStyle)) {
      const outerFill = args.resolveShadingFill(layerStyle, args.sourceId);
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
      const shadingFill = args.resolveShadingFill(layerStyle, args.sourceId);
      const attrs = styleAttributes(layerStyle, false, {
        fill: shadingFill ?? undefined
      });
      shapes.push(`<path data-source-id="${escapeAttr(args.sourceId)}" d="${escapeAttr(args.d)}" ${attrs.join(" ")} />`);
    }

    const groupAttrs = shadowGroupAttributes(args.sourceId, index + 1, layer, groupTransform, maskId);
    args.body.push(`<g ${groupAttrs.join(" ")}>${shapes.join("")}</g>`);
  }
}

function emitShadowCircle(args: {
  body: string[];
  sourceId: string;
  cx: number;
  cy: number;
  radius: number;
  bounds: ElementBounds | null;
  shadowLayers: ShadowLayer[];
  baseStyle: ResolvedStyle;
  resolveShadingFill: (style: ShadowRenderableStyle, sourceId: string) => string | null;
  ensureCircularShadowMaskDefinition: () => string;
}): void {
  for (let index = 0; index < args.shadowLayers.length; index += 1) {
    const layer = args.shadowLayers[index];
    const layerStyle = resolveShadowLayerStyle(layer.style as ShadowRenderableStyle, args.baseStyle);
    const groupTransform = shadowTransformMatrix(layer, args.bounds);
    const maskId = layer.fade === "circle-fuzzy-edge-15" ? args.ensureCircularShadowMaskDefinition() : null;
    const shapes: string[] = [];

    if (shouldEmitDoubleStroke(layerStyle)) {
      const outerFill = args.resolveShadingFill(layerStyle, args.sourceId);
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
      const shadingFill = args.resolveShadingFill(layerStyle, args.sourceId);
      const attrs = styleAttributes(layerStyle, false, {
        fill: shadingFill ?? undefined
      });
      shapes.push(
        `<circle data-source-id="${escapeAttr(args.sourceId)}" cx="${fmt(args.cx)}" cy="${fmt(args.cy)}" r="${fmt(args.radius)}" ${attrs.join(" ")} />`
      );
    }

    const groupAttrs = shadowGroupAttributes(args.sourceId, index + 1, layer, groupTransform, maskId);
    args.body.push(`<g ${groupAttrs.join(" ")}>${shapes.join("")}</g>`);
  }
}

function emitShadowEllipse(args: {
  body: string[];
  sourceId: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;
  bounds: ElementBounds | null;
  shadowLayers: ShadowLayer[];
  baseStyle: ResolvedStyle;
  resolveShadingFill: (style: ShadowRenderableStyle, sourceId: string) => string | null;
  ensureCircularShadowMaskDefinition: () => string;
}): void {
  for (let index = 0; index < args.shadowLayers.length; index += 1) {
    const layer = args.shadowLayers[index];
    const layerStyle = resolveShadowLayerStyle(layer.style as ShadowRenderableStyle, args.baseStyle);
    const groupTransform = shadowTransformMatrix(layer, args.bounds);
    const maskId = layer.fade === "circle-fuzzy-edge-15" ? args.ensureCircularShadowMaskDefinition() : null;
    const shapes: string[] = [];

    if (shouldEmitDoubleStroke(layerStyle)) {
      const outerFill = args.resolveShadingFill(layerStyle, args.sourceId);
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
      const shadingFill = args.resolveShadingFill(layerStyle, args.sourceId);
      const attrs = styleAttributes(layerStyle, false, {
        fill: shadingFill ?? undefined
      });
      if (Math.abs(args.rotation) > 1e-6) {
        attrs.push(`transform="rotate(${fmt(-args.rotation)} ${fmt(args.cx)} ${fmt(args.cy)})"`);
      }
      shapes.push(
        `<ellipse data-source-id="${escapeAttr(args.sourceId)}" cx="${fmt(args.cx)}" cy="${fmt(args.cy)}" rx="${fmt(args.rx)}" ry="${fmt(args.ry)}" ${attrs.join(" ")} />`
      );
    }

    const groupAttrs = shadowGroupAttributes(args.sourceId, index + 1, layer, groupTransform, maskId);
    args.body.push(`<g ${groupAttrs.join(" ")}>${shapes.join("")}</g>`);
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
  return {
    ...layerStyle,
    stroke: layerStyle.stroke === SHADOW_INHERIT_STROKE ? baseStyle.stroke : layerStyle.stroke,
    fill: layerStyle.fill === SHADOW_INHERIT_FILL ? baseStyle.fill : layerStyle.fill
  };
}

function markerSignature(marker: ArrowMarker): string {
  return JSON.stringify(marker);
}

function preferredMarkerId(marker: ArrowMarker): string | null {
  if (isDefaultArrowMarker(marker)) {
    return "tikz-arrow";
  }
  if (isDefaultBarMarker(marker)) {
    return "tikz-bar";
  }
  return null;
}

function isDefaultArrowMarker(marker: ArrowMarker): boolean {
  const tip = marker.tips[0];
  if (!tip || marker.tips.length !== 1) {
    return false;
  }
  return (
    tip.kind === "to" &&
    !tip.open &&
    !tip.round &&
    !tip.reversed &&
    !tip.bend &&
    tip.color == null &&
    tip.fill == null &&
    Math.abs(tip.length - 8) <= 1e-6 &&
    Math.abs(tip.width - 6) <= 1e-6 &&
    Math.abs(tip.sep) <= 1e-6 &&
    tip.lineWidth != null &&
    Math.abs(tip.lineWidth - 0.4) <= 1e-6
  );
}

function isDefaultBarMarker(marker: ArrowMarker): boolean {
  const tip = marker.tips[0];
  if (!tip || marker.tips.length !== 1) {
    return false;
  }
  return (
    tip.kind === "bar" &&
    tip.open &&
    !tip.round &&
    !tip.reversed &&
    !tip.bend &&
    tip.color == null &&
    tip.fill === "none" &&
    Math.abs(tip.length - 4) <= 1e-6 &&
    Math.abs(tip.width - 8) <= 1e-6 &&
    Math.abs(tip.sep) <= 1e-6 &&
    tip.lineWidth != null &&
    Math.abs(tip.lineWidth - 0.4) <= 1e-6
  );
}

type PathRenderPart = {
  commands: ScenePathCommand[];
  markerStartId: string | null;
  markerEndId: string | null;
  markerOnly: boolean;
};

function buildPathRenderParts(path: ScenePath, ensureMarkerDefinition: (marker: ArrowMarker) => string): PathRenderPart[] {
  const subpaths = splitPathIntoSubpaths(path.commands);
  if (subpaths.length === 0) {
    return [];
  }

  const markerStart = path.style.markerStart ? markerWithContextLineWidth(path.style.markerStart, path.style.lineWidth) : null;
  const markerEnd = path.style.markerEnd ? markerWithContextLineWidth(path.style.markerEnd, path.style.lineWidth) : null;
  const markerColor = path.style.stroke && path.style.stroke !== "none" ? path.style.stroke : "#000000";
  const markerStartForPath = markerStart ? markerWithResolvedColors(markerStart, markerColor) : null;
  const markerEndForPath = markerEnd ? markerWithResolvedColors(markerEnd, markerColor) : null;
  const markerAttrs = resolvePathMarkers(path, subpaths, markerStartForPath, markerEndForPath, ensureMarkerDefinition);
  if (!markerAttrs.startId && !markerAttrs.endId) {
    return [{ commands: path.commands, markerStartId: null, markerEndId: null, markerOnly: false }];
  }

  const leadingSubpaths = subpaths.slice(0, -1);
  const leadingCommands = flattenSubpaths(leadingSubpaths);
  const lastSubpath = subpaths[subpaths.length - 1] ?? [];
  const shortenedLastSubpath = shortenSubpathForMarkers(lastSubpath, markerStart, markerEnd);

  const parts: PathRenderPart[] = [];
  if (leadingCommands.length > 0 && hasDrawablePathCommands(leadingCommands)) {
    parts.push({
      commands: leadingCommands,
      markerStartId: null,
      markerEndId: null,
      markerOnly: false
    });
  }
  if (hasDrawablePathCommands(shortenedLastSubpath)) {
    parts.push({
      commands: shortenedLastSubpath,
      markerStartId: null,
      markerEndId: null,
      markerOnly: false
    });
  }
  if (hasDrawablePathCommands(lastSubpath)) {
    parts.push({
      commands: lastSubpath.map(clonePathCommand),
      markerStartId: markerAttrs.startId,
      markerEndId: markerAttrs.endId,
      markerOnly: true
    });
  }
  return parts;
}

function resolvePathMarkers(
  path: ScenePath,
  subpaths: ScenePathCommand[][],
  markerStart: ArrowMarker | null,
  markerEnd: ArrowMarker | null,
  ensureMarkerDefinition: (marker: ArrowMarker) => string
): { startId: string | null; endId: string | null } {
  if (!shouldEmitPathMarkers(path, subpaths)) {
    return { startId: null, endId: null };
  }

  return {
    startId: markerStart ? ensureMarkerDefinition(markerStart) : null,
    endId: markerEnd ? ensureMarkerDefinition(markerEnd) : null
  };
}

function markerWithContextLineWidth(marker: ArrowMarker, lineWidth: number): ArrowMarker {
  const fallback = Number.isFinite(lineWidth) && lineWidth > 0 ? lineWidth : 0.4;
  return {
    tips: marker.tips.map((tip) => {
      if (tip.lineWidth != null) {
        return { ...tip };
      }
      return { ...tip, lineWidth: fallback };
    })
  };
}

function markerWithResolvedColors(marker: ArrowMarker, color: string): ArrowMarker {
  return {
    tips: marker.tips.map((tip) => {
      if (tip.color != null) {
        return { ...tip };
      }
      return { ...tip, color };
    })
  };
}

function shouldEmitPathMarkers(path: ScenePath, subpaths: ScenePathCommand[][]): boolean {
  if (!path.style.markerStart && !path.style.markerEnd) {
    return false;
  }

  if (path.style.tipsMode === "never") {
    return false;
  }

  if (subpaths.length === 0) {
    return false;
  }

  if (subpaths.some((subpath) => subpath.some((command) => command.kind === "Z"))) {
    return false;
  }

  const lastSubpath = subpaths[subpaths.length - 1] ?? [];
  const lastHasDrawableSegment = hasDrawablePathCommands(lastSubpath);
  if (!lastHasDrawableSegment && (path.style.tipsMode === "proper" || path.style.tipsMode === "on proper draw")) {
    return false;
  }

  const drawEnabled = path.style.drawExplicit || (path.style.stroke != null && path.style.stroke !== "none");
  if ((path.style.tipsMode === "on draw" || path.style.tipsMode === "on proper draw") && !drawEnabled) {
    return false;
  }

  return true;
}

function splitPathIntoSubpaths(commands: ScenePathCommand[]): ScenePathCommand[][] {
  const subpaths: ScenePathCommand[][] = [];
  let current: ScenePathCommand[] = [];

  for (const command of commands) {
    if (command.kind === "M" && current.length > 0) {
      subpaths.push(current);
      current = [clonePathCommand(command)];
      continue;
    }
    current.push(clonePathCommand(command));
  }

  if (current.length > 0) {
    subpaths.push(current);
  }

  return subpaths;
}

function flattenSubpaths(subpaths: ScenePathCommand[][]): ScenePathCommand[] {
  const flattened: ScenePathCommand[] = [];
  for (const subpath of subpaths) {
    for (const command of subpath) {
      flattened.push(clonePathCommand(command));
    }
  }
  return flattened;
}

function shortenSubpathForMarkers(
  subpath: ScenePathCommand[],
  markerStart: ArrowMarker | null,
  markerEnd: ArrowMarker | null
): ScenePathCommand[] {
  const commands = subpath.map(clonePathCommand);
  if (commands.length < 2) {
    return commands;
  }

  const firstSegmentIndex = findFirstDrawableCommandIndex(commands);
  const lastSegmentIndex = findLastDrawableCommandIndex(commands);
  if (firstSegmentIndex < 0 || lastSegmentIndex < 0) {
    return commands;
  }

  if (markerStart) {
    const requested = markerStartShorteningLength(markerStart);
    applyStartShortening(commands, firstSegmentIndex, requested);
  }

  if (markerEnd) {
    const requested = markerShorteningLength(markerEnd);
    applyEndShortening(commands, lastSegmentIndex, requested);
  }

  return commands;
}

function markerShorteningLength(marker: ArrowMarker): number {
  if (marker.tips.length === 0) {
    return 0;
  }
  const frontTip = marker.tips[marker.tips.length - 1];
  if (!frontTip) {
    return 0;
  }
  return tipShorteningLength(frontTip, "end") + Math.max(0, frontTip.sep);
}

function markerStartShorteningLength(marker: ArrowMarker): number {
  if (marker.tips.length === 0) {
    return 0;
  }
  const frontTip = marker.tips[marker.tips.length - 1];
  if (!frontTip) {
    return 0;
  }
  return tipShorteningLength(frontTip, "start") + Math.max(0, frontTip.sep);
}

function tipShorteningLength(tip: ArrowTip, side: "start" | "end"): number {
  const effectiveSide = tip.reversed ? (side === "start" ? "end" : "start") : side;
  const canonicalReversed = side === "start" ? !tip.reversed : tip.reversed;
  const length = Math.max(1, tip.length);
  const lineWidth = tip.lineWidth != null && tip.lineWidth > 0 ? tip.lineWidth : 0.4;

  if (tip.kind === "cm-rightarrow") {
    if (effectiveSide === "start") {
      return length;
    }
    return lineWidth;
  }
  if (tip.kind === "hooks" || tip.kind === "bar") {
    return 0;
  }
  if (tip.kind === "stealth") {
    const width = Math.max(1, tip.width);
    const slope = length / Math.max(1e-6, width);
    const frontMiter = 0.5 * Math.sqrt(1 + 4 * slope * slope) * lineWidth;
    if (canonicalReversed) {
      // pgflibraryarrows.meta.code.tex: reversed Stealth line-end (non-harpoon, no inner line).
      return Math.max(0, frontMiter + 0.25 * lineWidth);
    }
    const inset = Math.max(0, tip.inset ?? length * 0.325);
    const insetSlope = inset / Math.max(1e-6, width);
    const insetMiter = 0.5 * Math.sqrt(1 + 4 * insetSlope * insetSlope) * lineWidth;
    const lineEnd = inset + insetMiter;
    return Math.max(0, length - lineEnd);
  }
  if (tip.kind === "latex") {
    if (canonicalReversed) {
      // pgflibraryarrows.meta.code.tex: reversed Latex line-end (single line case).
      const slope = length / Math.max(1e-6, Math.max(1, tip.width));
      const frontMiter = Math.sqrt(1 + 9 * slope * slope) * lineWidth;
      return Math.max(0, 0.5 * frontMiter + 0.5 * lineWidth);
    }
    return Math.max(0, length - 0.5 * lineWidth);
  }
  if (tip.kind === "triangle") {
    return effectiveSide === "start" ? length * 0.2 : length * 0.9;
  }
  if (tip.kind === "implies") {
    return effectiveSide === "start" ? length * 0.25 : length * 0.9;
  }
  if (tip.kind === "to") {
    return effectiveSide === "start" ? length * 0.2 : length * 0.85;
  }

  return effectiveSide === "start" ? length * 0.2 : length * 0.8;
}

function applyStartShortening(commands: ScenePathCommand[], firstSegmentIndex: number, requested: number): void {
  if (requested <= 0 || firstSegmentIndex <= 0) {
    return;
  }

  const segment = commands[firstSegmentIndex];
  if (!segment || !isDrawableCommand(segment)) {
    return;
  }
  const previous = commandPoint(commands[firstSegmentIndex - 1]);
  if (!previous) {
    return;
  }

  const tangent = startTangentForCommand(segment, previous);
  const tangentLength = lengthOfVector(tangent);
  if (tangentLength <= 1e-6) {
    return;
  }

  const delta = Math.min(requested, tangentLength * 0.98);
  if (delta <= 1e-6) {
    return;
  }
  const unit = scaleVector(tangent, 1 / tangentLength);
  const shift = scaleVector(unit, delta);
  const newStart = addPoint(previous, shift);
  const previousCommand = commands[firstSegmentIndex - 1];
  if (previousCommand.kind !== "M" && previousCommand.kind !== "L" && previousCommand.kind !== "C" && previousCommand.kind !== "A") {
    return;
  }
  previousCommand.to = newStart;

  if (segment.kind === "C") {
    segment.c1 = addPoint(segment.c1, shift);
  }
}

function applyEndShortening(commands: ScenePathCommand[], lastSegmentIndex: number, requested: number): void {
  if (requested <= 0 || lastSegmentIndex <= 0) {
    return;
  }

  const segment = commands[lastSegmentIndex];
  if (!segment || !isDrawableCommand(segment)) {
    return;
  }
  const previous = commandPoint(commands[lastSegmentIndex - 1]);
  if (!previous) {
    return;
  }

  const tangent = endTangentForCommand(segment, previous);
  const tangentLength = lengthOfVector(tangent);
  if (tangentLength <= 1e-6) {
    return;
  }

  const delta = Math.min(requested, tangentLength * 0.98);
  if (delta <= 1e-6) {
    return;
  }

  const unit = scaleVector(tangent, 1 / tangentLength);
  const shift = scaleVector(unit, -delta);
  segment.to = addPoint(segment.to, shift);

  if (segment.kind === "C") {
    segment.c2 = addPoint(segment.c2, shift);
  }
}

function findFirstDrawableCommandIndex(commands: ScenePathCommand[]): number {
  for (let index = 0; index < commands.length; index += 1) {
    if (isDrawableCommand(commands[index])) {
      return index;
    }
  }
  return -1;
}

function findLastDrawableCommandIndex(commands: ScenePathCommand[]): number {
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    if (isDrawableCommand(commands[index])) {
      return index;
    }
  }
  return -1;
}

function isDrawableCommand(command: ScenePathCommand | undefined): command is Extract<ScenePathCommand, { kind: "L" | "C" | "A" }> {
  return command?.kind === "L" || command?.kind === "C" || command?.kind === "A";
}

function startTangentForCommand(command: Extract<ScenePathCommand, { kind: "L" | "C" | "A" }>, start: { x: number; y: number }): {
  x: number;
  y: number;
} {
  if (command.kind === "L" || command.kind === "A") {
    return subtractPoint(command.to, start);
  }

  const c1 = subtractPoint(command.c1, start);
  if (lengthOfVector(c1) > 1e-6) {
    return c1;
  }
  const c2 = subtractPoint(command.c2, start);
  if (lengthOfVector(c2) > 1e-6) {
    return c2;
  }
  return subtractPoint(command.to, start);
}

function endTangentForCommand(command: Extract<ScenePathCommand, { kind: "L" | "C" | "A" }>, previous: { x: number; y: number }): {
  x: number;
  y: number;
} {
  if (command.kind === "L" || command.kind === "A") {
    return subtractPoint(command.to, previous);
  }

  const c2 = subtractPoint(command.to, command.c2);
  if (lengthOfVector(c2) > 1e-6) {
    return c2;
  }
  const fallback = subtractPoint(command.to, previous);
  return fallback;
}

function commandPoint(command: ScenePathCommand | undefined): { x: number; y: number } | null {
  if (!command) {
    return null;
  }
  if (command.kind === "M" || command.kind === "L" || command.kind === "C" || command.kind === "A") {
    return command.to;
  }
  return null;
}

function clonePathCommand(command: ScenePathCommand): ScenePathCommand {
  if (command.kind === "M" || command.kind === "L") {
    return { kind: command.kind, to: { ...command.to } };
  }
  if (command.kind === "C") {
    return { kind: "C", c1: { ...command.c1 }, c2: { ...command.c2 }, to: { ...command.to } };
  }
  if (command.kind === "A") {
    return {
      kind: "A",
      rx: command.rx,
      ry: command.ry,
      xAxisRotation: command.xAxisRotation,
      largeArc: command.largeArc,
      sweep: command.sweep,
      to: { ...command.to }
    };
  }
  return { kind: "Z" };
}

function addPoint(left: { x: number; y: number }, right: { x: number; y: number }): { x: number; y: number } {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtractPoint(left: { x: number; y: number }, right: { x: number; y: number }): { x: number; y: number } {
  return { x: left.x - right.x, y: left.y - right.y };
}

function scaleVector(vector: { x: number; y: number }, factor: number): { x: number; y: number } {
  return { x: vector.x * factor, y: vector.y * factor };
}

function lengthOfVector(vector: { x: number; y: number }): number {
  return Math.hypot(vector.x, vector.y);
}

function renderMarkerDefinition(id: string, marker: ArrowMarker): string {
  const shapes: string[] = [];
  const normalizedTips = marker.tips.map(normalizeArrowTip);
  const totalLength = normalizedTips.reduce((sum, tip) => sum + tip.length + tip.sep, 0);
  let cursorX = -totalLength;
  let minX = 0;
  let maxX = 0;
  let maxHalfWidth = 1;

  for (const normalized of normalizedTips) {
    const baseX = cursorX;
    const tipX = baseX + normalized.length;
    minX = Math.min(minX, baseX - 1);
    maxX = Math.max(maxX, tipX + 1);
    maxHalfWidth = Math.max(maxHalfWidth, normalized.width / 2 + 1);
    shapes.push(renderArrowTipShape(normalized, baseX, tipX));
    cursorX = tipX + normalized.sep;
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(2, maxHalfWidth * 2);
  return (
    `<marker id="${escapeAttr(id)}" viewBox="${fmt(minX)} ${fmt(-maxHalfWidth)} ${fmt(width)} ${fmt(height)}" ` +
    `refX="0" refY="0" markerUnits="userSpaceOnUse" markerWidth="${fmt(width)}" markerHeight="${fmt(height)}" orient="auto-start-reverse">` +
    shapes.join("") +
    `</marker>`
  );
}

function normalizeArrowTip(tip: ArrowTip): ArrowTip {
  return {
    ...tip,
    length: Math.max(1, tip.length),
    width: Math.max(1, tip.width),
    sep: Math.max(0, tip.sep)
  };
}

function renderArrowTipShape(tip: ArrowTip, baseX: number, tipX: number): string {
  const halfWidth = tip.width / 2;
  const color = tip.color ?? "context-stroke";
  const strokeLinejoin = tip.round ? "round" : "miter";
  const strokeLinecap = tip.round ? "round" : "butt";
  const strokeWidth = tip.lineWidth ?? 0;
  const fill = tip.fill ?? (tip.open || tip.kind === "bar" || tip.kind === "hooks" ? "none" : color);
  const stroke = strokeWidth > 0 ? color : "none";
  const tailX = tip.reversed ? tipX : baseX;
  const pointX = tip.reversed ? baseX : tipX;
  const span = pointX - tailX;
  const lerpX = (t: number): number => tailX + span * t;
  const atDistance = (distance: number): number => {
    const ratio = distance / Math.max(1e-6, tip.length);
    return tailX + span * ratio;
  };

  if (tip.kind === "cm-rightarrow") {
    const c1x = lerpX(0.18269);
    const c2x = lerpX(0.58981);
    const c1y = halfWidth * 0.4;
    const c2y = halfWidth * 0.116666;
    return (
      `<path d="M ${fmt(tailX)} ${fmt(-halfWidth)} ` +
      `C ${fmt(c1x)} ${fmt(-c1y)} ${fmt(c2x)} ${fmt(-c2y)} ${fmt(pointX)} 0 ` +
      `C ${fmt(c2x)} ${fmt(c2y)} ${fmt(c1x)} ${fmt(c1y)} ${fmt(tailX)} ${fmt(halfWidth)}" ` +
      `fill="none" stroke="${escapeAttr(color)}" stroke-width="${fmt(strokeWidth > 0 ? strokeWidth : 1)}" ` +
      `stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
    );
  }

  if (tip.kind === "bar") {
    const x = (tailX + pointX) / 2;
    return (
      `<path d="M ${fmt(x)} ${fmt(-halfWidth)} L ${fmt(x)} ${fmt(halfWidth)}" ` +
      `fill="none" stroke="${escapeAttr(color)}" stroke-width="${fmt(strokeWidth > 0 ? strokeWidth : 1.6)}" ` +
      `stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
    );
  }

  if (tip.kind === "hooks") {
    const controlX = lerpX(0.45);
    return (
      `<path d="M ${fmt(pointX)} 0 Q ${fmt(controlX)} ${fmt(-halfWidth)} ${fmt(tailX)} ${fmt(-halfWidth)} ` +
      `M ${fmt(pointX)} 0 Q ${fmt(controlX)} ${fmt(halfWidth)} ${fmt(tailX)} ${fmt(halfWidth)}" ` +
      `fill="none" stroke="${escapeAttr(color)}" stroke-width="${fmt(strokeWidth > 0 ? strokeWidth : 1.1)}" ` +
      `stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
    );
  }

  if (tip.kind === "implies") {
    const midX = lerpX(0.62);
    const innerTailX = lerpX(0.35);
    const innerMidX = lerpX(0.727);
    const innerPointX = lerpX(0.97);
    return (
      `<path d="M ${fmt(tailX)} ${fmt(-halfWidth)} L ${fmt(midX)} ${fmt(-halfWidth)} L ${fmt(pointX)} 0 L ${fmt(midX)} ${fmt(halfWidth)} L ${fmt(tailX)} ${fmt(halfWidth)} z" ` +
      `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />` +
      `<path d="M ${fmt(innerTailX)} ${fmt(-halfWidth * 0.7)} L ${fmt(innerMidX)} ${fmt(-halfWidth * 0.7)} L ${fmt(innerPointX)} 0 L ${fmt(innerMidX)} ${fmt(halfWidth * 0.7)} L ${fmt(innerTailX)} ${fmt(halfWidth * 0.7)} z" ` +
      `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
    );
  }

  if (tip.kind === "stealth") {
    const nominalLength = Math.max(1, tip.length);
    const nominalWidth = Math.max(1, tip.width);
    const nominalInset = Math.max(0, tip.inset ?? nominalLength * 0.325);
    const lw = Math.max(0, strokeWidth);

    const frontSlope = nominalLength / Math.max(1e-6, nominalWidth);
    const frontMiter = 0.5 * Math.sqrt(1 + 4 * frontSlope * frontSlope) * lw;

    const halfNominalWidth = 0.5 * nominalWidth;
    const angleTop = Math.atan2(nominalLength, Math.max(1e-6, halfNominalWidth));
    const angleInset = Math.atan2(nominalInset, Math.max(1e-6, halfNominalWidth));
    const halfDelta = 0.5 * (angleTop - angleInset);
    const backMiterLength = 0.5 * (1 / Math.max(1e-6, Math.tan(halfDelta))) * lw;
    const bisector = angleInset + halfDelta;
    const backMiterX = Math.sin(bisector) * backMiterLength;
    const topMiterY = Math.cos(bisector) * backMiterLength;

    const insetSlope = nominalInset / Math.max(1e-6, nominalWidth);
    const insetMiter = 0.5 * Math.sqrt(1 + 4 * insetSlope * insetSlope) * lw;
    const adjustedInset = nominalInset + insetMiter;

    const tipVertexX = atDistance(Math.max(0, nominalLength - frontMiter));
    const topBackX = atDistance(Math.max(0, backMiterX));
    const insetX = atDistance(Math.max(0, adjustedInset));
    const innerHalfWidth = Math.max(0.1, halfNominalWidth - topMiterY);
    return (
      `<path d="M ${fmt(tipVertexX)} 0 L ${fmt(topBackX)} ${fmt(-innerHalfWidth)} L ${fmt(insetX)} 0 L ${fmt(topBackX)} ${fmt(innerHalfWidth)} z" ` +
      `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
    );
  }

  if (tip.kind === "latex") {
    const nominalLength = Math.max(1, tip.length);
    const nominalWidth = Math.max(1, tip.width);
    const lw = Math.max(0, strokeWidth);
    const axisSign = tip.reversed ? -1 : 1;
    const tailShift = axisSign * 0.5 * lw;
    const tail = tailX + tailShift;

    const slope = nominalLength / Math.max(1e-6, nominalWidth);
    const frontMiter = Math.sqrt(1 + 9 * slope * slope) * lw;
    const innerLength = Math.max(0.1, nominalLength - 0.5 * frontMiter - 0.5 * lw);
    const halfBackWidth = nominalWidth / 2;

    const atDistanceFromTail = (distance: number): number => tail + axisSign * distance;
    const tipVertexX = atDistanceFromTail(innerLength);
    const c1x = atDistanceFromTail(0.877192 * innerLength);
    const c2x = atDistanceFromTail(0.337381 * innerLength);
    const c1y = 0.077922 * halfBackWidth;
    const c2y = 0.51948 * halfBackWidth;
    return (
      `<path d="M ${fmt(tipVertexX)} 0 ` +
      `C ${fmt(c1x)} ${fmt(-c1y)} ${fmt(c2x)} ${fmt(-c2y)} ${fmt(tail)} ${fmt(-halfBackWidth)} ` +
      `L ${fmt(tail)} ${fmt(halfBackWidth)} ` +
      `C ${fmt(c2x)} ${fmt(c2y)} ${fmt(c1x)} ${fmt(c1y)} ${fmt(tipVertexX)} 0 z" ` +
      `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
    );
  }

  if (tip.kind === "triangle") {
    return (
      `<path d="M ${fmt(tailX)} ${fmt(-halfWidth)} L ${fmt(pointX)} 0 L ${fmt(tailX)} ${fmt(halfWidth)} z" ` +
      `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
    );
  }

  const notchX = lerpX(0.24);
  return (
    `<path d="M ${fmt(tailX)} ${fmt(-halfWidth)} L ${fmt(pointX)} 0 L ${fmt(tailX)} ${fmt(halfWidth)} L ${fmt(notchX)} 0 z" ` +
    `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
  );
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
