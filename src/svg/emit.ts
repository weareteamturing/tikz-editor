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
      const d = encodePathData(element.commands, viewBox);
      if (d.length === 0) {
        diagnostics.push({
          code: "empty-path",
          message: `Skipping path ${element.id} because it has no drawing commands.`
        });
        continue;
      }
      const attrs = styleAttributes(element.style);
      if (element.style.markerStart || element.style.markerEnd) {
        usesArrowMarker = true;
      }
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
      const attrs = styleAttributes(element.style);
      body.push(
        `<circle data-source-id="${escapeAttr(element.sourceId)}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(element.radius)}" ${attrs.join(" ")} />`
      );
      continue;
    }

    if (element.kind === "Ellipse") {
      const center = toSvgPoint(element.center, viewBox);
      const attrs = styleAttributes(element.style);
      body.push(
        `<ellipse data-source-id="${escapeAttr(element.sourceId)}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" rx="${fmt(element.rx)}" ry="${fmt(element.ry)}" ${attrs.join(" ")} />`
      );
      continue;
    }

    const position = toSvgPoint(element.position, viewBox);
    const attrs = styleAttributes(element.style, true);
    body.push(
      `<text data-source-id="${escapeAttr(element.sourceId)}" x="${fmt(position.x)}" y="${fmt(position.y)}" ${attrs.join(" ")}>${escapeText(element.text)}</text>`
    );
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
    opacity: number;
  },
  isText = false
): string[] {
  const attrs: string[] = [];
  if (isText) {
    attrs.push(`fill="${escapeAttr(style.stroke ?? "black")}"`);
    attrs.push(`font-family="JetBrains Mono, Fira Code, Consolas, monospace"`);
    attrs.push(`font-size="10"`);
    attrs.push(`dominant-baseline="middle"`);
    return attrs;
  }

  attrs.push(`stroke="${escapeAttr(style.stroke ?? "none")}"`);
  attrs.push(`fill="${escapeAttr(style.fill ?? "none")}"`);
  attrs.push(`stroke-width="${fmt(style.lineWidth)}"`);
  attrs.push(`opacity="${fmt(style.opacity)}"`);
  attrs.push(`vector-effect="non-scaling-stroke"`);
  return attrs;
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
