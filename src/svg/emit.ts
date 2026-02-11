import type { SceneElement, SceneFigure, ScenePathCommand } from "../semantic/types.js";
import { computeViewBox } from "./viewbox.js";
import type { EmitSvgOptions, EmitSvgResult } from "./types.js";

export function emitSvg(scene: SceneFigure, opts: EmitSvgOptions = {}): EmitSvgResult {
  const padding = opts.padding ?? 12;
  const viewBox = computeViewBox(scene, padding);

  const diagnostics: EmitSvgResult["diagnostics"] = [];
  const body: string[] = [];
  let usesArrowMarker = false;

  for (const element of scene.elements) {
    if (element.kind === "Path") {
      if (!hasDrawablePathCommands(element.commands)) {
        diagnostics.push({
          code: "empty-path",
          message: `Skipping path ${element.id} because it has no drawable segments.`
        });
        continue;
      }

      const d = encodePathData(element.commands, viewBox);
      if (d.length === 0) {
        diagnostics.push({
          code: "empty-path",
          message: `Skipping path ${element.id} because it has no drawing commands.`
        });
        continue;
      }
      if (element.style.markerStart || element.style.markerEnd) {
        usesArrowMarker = true;
      }
      if (shouldEmitDoubleStroke(element.style)) {
        const outerAttrs = styleAttributes(element.style, false, {
          lineWidth: element.style.lineWidth * 2 + element.style.doubleDistance
        });
        if (element.style.markerStart) {
          outerAttrs.push(`marker-start="url(#tikz-arrow)"`);
        }
        if (element.style.markerEnd) {
          outerAttrs.push(`marker-end="url(#tikz-arrow)"`);
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

      const attrs = styleAttributes(element.style);
      if (element.style.markerStart) {
        attrs.push(`marker-start="url(#tikz-arrow)"`);
      }
      if (element.style.markerEnd) {
        attrs.push(`marker-end="url(#tikz-arrow)"`);
      }
      body.push(`<path data-source-id="${escapeAttr(element.sourceId)}" d="${escapeAttr(d)}" ${attrs.join(" ")} />`);
      continue;
    }

    if (element.kind === "Circle") {
      const center = toSvgPoint(element.center, viewBox);
      if (shouldEmitDoubleStroke(element.style)) {
        const outerAttrs = styleAttributes(element.style, false, {
          lineWidth: element.style.lineWidth * 2 + element.style.doubleDistance
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
        const attrs = styleAttributes(element.style);
        body.push(
          `<circle data-source-id="${escapeAttr(element.sourceId)}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(element.radius)}" ${attrs.join(" ")} />`
        );
      }
      continue;
    }

    if (element.kind === "Ellipse") {
      const center = toSvgPoint(element.center, viewBox);
      if (shouldEmitDoubleStroke(element.style)) {
        const outerAttrs = styleAttributes(element.style, false, {
          lineWidth: element.style.lineWidth * 2 + element.style.doubleDistance
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
        const attrs = styleAttributes(element.style);
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
    const attrs = styleAttributes(element.style, true);
    const textBody = encodeTextBody(element.text, position.x, position.y);
    body.push(`<text data-source-id="${escapeAttr(element.sourceId)}" x="${fmt(position.x)}" y="${fmt(position.y)}" ${attrs.join(" ")}>${textBody}</text>`);
  }

  const defs = usesArrowMarker
    ? `<defs><marker id="tikz-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>`
    : "";

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
        `A ${fmt(command.rx)} ${fmt(command.ry)} ${fmt(command.xAxisRotation)} ${command.largeArc ? 1 : 0} ${sweep} ${fmt(to.x)} ${fmt(to.y)}`
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

function styleAttributes(
  style: {
    stroke: string | null;
    fill: string | null;
    lineWidth: number;
    dashArray: number[] | null;
    lineCap: "butt" | "round" | "square";
    lineJoin: "miter" | "round" | "bevel";
    opacity: number;
    strokeOpacity: number;
    fillOpacity: number;
    fontSize: number;
    fontStyle: "normal" | "italic";
    doubleStroke: boolean;
    doubleDistance: number;
    textColor?: string | null;
    textOpacity?: number;
    textAlign?: "left" | "flush left" | "right" | "flush right" | "center" | "flush center" | "justify" | "none";
  },
  isText = false,
  overrides: { stroke?: string | null; fill?: string | null; lineWidth?: number } = {}
): string[] {
  const attrs: string[] = [];
  if (isText) {
    const textColor = style.textColor ?? style.stroke ?? "#000000";
    attrs.push(`fill="${escapeAttr(textColor)}"`);
    attrs.push(`fill-opacity="${fmt(style.textOpacity ?? style.strokeOpacity)}"`);
    attrs.push(`font-family="CMU Serif, Latin Modern Roman, Times New Roman, serif"`);
    attrs.push(`font-size="${fmt(style.fontSize)}"`);
    if (style.fontStyle === "italic") {
      attrs.push(`font-style="italic"`);
    }
    attrs.push(`text-anchor="${textAnchorForAlign(style.textAlign)}"`);
    attrs.push(`dominant-baseline="middle"`);
    attrs.push(`xml:space="preserve"`);
    return attrs;
  }

  attrs.push(`stroke="${escapeAttr(overrides.stroke ?? style.stroke ?? "none")}"`);
  attrs.push(`fill="${escapeAttr(overrides.fill ?? (style.fill && style.fill !== "none" ? style.fill : "none"))}"`);
  attrs.push(`stroke-width="${fmt(overrides.lineWidth ?? style.lineWidth)}"`);
  attrs.push(`stroke-linecap="${style.lineCap}"`);
  attrs.push(`stroke-linejoin="${style.lineJoin}"`);
  attrs.push(`stroke-opacity="${fmt(style.strokeOpacity)}"`);
  attrs.push(`fill-opacity="${fmt(style.fillOpacity)}"`);
  if (style.dashArray && style.dashArray.length > 0) {
    attrs.push(`stroke-dasharray="${style.dashArray.map((entry) => fmt(entry)).join(" ")}"`);
  }
  attrs.push(`opacity="${fmt(style.opacity)}"`);
  attrs.push(`vector-effect="non-scaling-stroke"`);
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
