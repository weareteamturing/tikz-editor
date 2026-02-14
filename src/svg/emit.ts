import type { ArrowMarker, ArrowTip, SceneElement, SceneFigure, ScenePath, ScenePathCommand } from "../semantic/types.js";
import { computeViewBox } from "./viewbox.js";
import type { EmitSvgOptions, EmitSvgResult } from "./types.js";

export function emitSvg(scene: SceneFigure, opts: EmitSvgOptions = {}): EmitSvgResult {
  const padding = opts.padding ?? 12;
  const viewBox = computeViewBox(scene, padding);

  const diagnostics: EmitSvgResult["diagnostics"] = [];
  const body: string[] = [];
  const markerIdBySignature = new Map<string, string>();
  const markerDefById = new Map<string, string>();

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
      for (const part of parts) {
        const d = encodePathData(part.commands, viewBox);
        if (d.length === 0) {
          continue;
        }

        if (shouldEmitDoubleStroke(element.style)) {
          const outerAttrs = styleAttributes(element.style, false, {
            lineWidth: element.style.lineWidth * 2 + element.style.doubleDistance
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

        const attrs = styleAttributes(element.style);
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
    const textBlockWidth = element.textBlockWidth ?? estimateTextBlockWidth(element.text, element.style.fontSize);
    const textX = alignedTextAnchorX(position.x, textBlockWidth, element.style.textAlign);
    const attrs = styleAttributes(element.style, true);
    const textBody = encodeTextBody(element.text, textX, position.y);
    body.push(`<text data-source-id="${escapeAttr(element.sourceId)}" x="${fmt(textX)}" y="${fmt(position.y)}" ${attrs.join(" ")}>${textBody}</text>`);
  }

  const defsParts = [...markerDefById.values()];
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
    tip.color == null &&
    tip.fill == null &&
    Math.abs(tip.length - 8) <= 1e-6 &&
    Math.abs(tip.width - 6) <= 1e-6 &&
    tip.lineWidth == null
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
    tip.color == null &&
    tip.fill === "none" &&
    Math.abs(tip.length - 4) <= 1e-6 &&
    Math.abs(tip.width - 8) <= 1e-6 &&
    tip.lineWidth == null
  );
}

type PathRenderPart = {
  commands: ScenePathCommand[];
  markerStartId: string | null;
  markerEndId: string | null;
};

function buildPathRenderParts(path: ScenePath, ensureMarkerDefinition: (marker: ArrowMarker) => string): PathRenderPart[] {
  const subpaths = splitPathIntoSubpaths(path.commands);
  if (subpaths.length === 0) {
    return [];
  }

  const markerAttrs = resolvePathMarkers(path, subpaths, ensureMarkerDefinition);
  if (!markerAttrs.startId && !markerAttrs.endId) {
    return [{ commands: path.commands, markerStartId: null, markerEndId: null }];
  }

  const leadingSubpaths = subpaths.slice(0, -1);
  const leadingCommands = flattenSubpaths(leadingSubpaths);
  const lastSubpath = subpaths[subpaths.length - 1] ?? [];
  const shortenedLastSubpath = shortenSubpathForMarkers(lastSubpath, path.style.markerStart, path.style.markerEnd);

  const parts: PathRenderPart[] = [];
  if (leadingCommands.length > 0 && hasDrawablePathCommands(leadingCommands)) {
    parts.push({
      commands: leadingCommands,
      markerStartId: null,
      markerEndId: null
    });
  }
  parts.push({
    commands: shortenedLastSubpath,
    markerStartId: markerAttrs.startId,
    markerEndId: markerAttrs.endId
  });
  return parts;
}

function resolvePathMarkers(
  path: ScenePath,
  subpaths: ScenePathCommand[][],
  ensureMarkerDefinition: (marker: ArrowMarker) => string
): { startId: string | null; endId: string | null } {
  if (!shouldEmitPathMarkers(path, subpaths)) {
    return { startId: null, endId: null };
  }

  return {
    startId: path.style.markerStart ? ensureMarkerDefinition(path.style.markerStart) : null,
    endId: path.style.markerEnd ? ensureMarkerDefinition(path.style.markerEnd) : null
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
    const requested = markerShorteningLength(markerStart);
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
  let length = 0;
  for (const tip of marker.tips) {
    length += Math.max(1, tip.length);
  }
  if (marker.tips.length > 1) {
    length += (marker.tips.length - 1) * 0.8;
  }
  return length;
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

  const delta = Math.min(requested, tangentLength * 0.45);
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

  const delta = Math.min(requested, tangentLength * 0.45);
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
  let offset = 0;
  let minX = 0;
  let maxX = 0;
  let maxHalfWidth = 1;

  for (const tip of marker.tips) {
    const normalized = normalizeArrowTip(tip);
    const tipX = -offset;
    const baseX = tipX - normalized.length;
    minX = Math.min(minX, baseX - 1);
    maxX = Math.max(maxX, tipX + 1);
    maxHalfWidth = Math.max(maxHalfWidth, normalized.width / 2 + 1);
    shapes.push(renderArrowTipShape(normalized, baseX, tipX));
    offset += normalized.length + 0.8;
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
    width: Math.max(1, tip.width)
  };
}

function renderArrowTipShape(tip: ArrowTip, baseX: number, tipX: number): string {
  const halfWidth = tip.width / 2;
  const color = tip.color ?? "context-stroke";
  const strokeLinejoin = tip.round ? "round" : "miter";
  const strokeLinecap = tip.round ? "round" : "butt";
  const strokeWidth = tip.lineWidth ?? (tip.open || tip.kind === "bar" || tip.kind === "hooks" ? 1 : 0);
  const fill = tip.fill ?? (tip.open || tip.kind === "bar" || tip.kind === "hooks" ? "none" : color);
  const stroke = strokeWidth > 0 ? color : "none";

  if (tip.kind === "bar") {
    const x = (tipX + baseX) / 2;
    return (
      `<path d="M ${fmt(x)} ${fmt(-halfWidth)} L ${fmt(x)} ${fmt(halfWidth)}" ` +
      `fill="none" stroke="${escapeAttr(color)}" stroke-width="${fmt(strokeWidth > 0 ? strokeWidth : 1.6)}" ` +
      `stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
    );
  }

  if (tip.kind === "hooks") {
    const controlX = tipX - tip.length * 0.55;
    return (
      `<path d="M ${fmt(tipX)} 0 Q ${fmt(controlX)} ${fmt(-halfWidth)} ${fmt(baseX)} ${fmt(-halfWidth)} ` +
      `M ${fmt(tipX)} 0 Q ${fmt(controlX)} ${fmt(halfWidth)} ${fmt(baseX)} ${fmt(halfWidth)}" ` +
      `fill="none" stroke="${escapeAttr(color)}" stroke-width="${fmt(strokeWidth > 0 ? strokeWidth : 1.1)}" ` +
      `stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
    );
  }

  if (tip.kind === "implies") {
    const midX = tipX - tip.length * 0.38;
    return (
      `<path d="M ${fmt(baseX)} ${fmt(-halfWidth)} L ${fmt(midX)} ${fmt(-halfWidth)} L ${fmt(tipX)} 0 L ${fmt(midX)} ${fmt(halfWidth)} L ${fmt(baseX)} ${fmt(halfWidth)} z" ` +
      `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />` +
      `<path d="M ${fmt(baseX + tip.length * 0.35)} ${fmt(-halfWidth * 0.7)} L ${fmt(midX + tip.length * 0.35)} ${fmt(-halfWidth * 0.7)} L ${fmt(tipX + tip.length * 0.35)} 0 L ${fmt(midX + tip.length * 0.35)} ${fmt(halfWidth * 0.7)} L ${fmt(baseX + tip.length * 0.35)} ${fmt(halfWidth * 0.7)} z" ` +
      `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
    );
  }

  if (tip.kind === "stealth") {
    const insetX = baseX + tip.length * 0.3;
    return (
      `<path d="M ${fmt(baseX)} ${fmt(-halfWidth)} L ${fmt(tipX)} 0 L ${fmt(baseX)} ${fmt(halfWidth)} L ${fmt(insetX)} 0 z" ` +
      `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
    );
  }

  if (tip.kind === "latex") {
    const neckX = baseX + tip.length * 0.12;
    return (
      `<path d="M ${fmt(neckX)} ${fmt(-halfWidth)} L ${fmt(tipX)} 0 L ${fmt(neckX)} ${fmt(halfWidth)} z" ` +
      `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
    );
  }

  if (tip.kind === "triangle") {
    return (
      `<path d="M ${fmt(baseX)} ${fmt(-halfWidth)} L ${fmt(tipX)} 0 L ${fmt(baseX)} ${fmt(halfWidth)} z" ` +
      `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
    );
  }

  const notchX = baseX + tip.length * 0.24;
  return (
    `<path d="M ${fmt(baseX)} ${fmt(-halfWidth)} L ${fmt(tipX)} 0 L ${fmt(baseX)} ${fmt(halfWidth)} L ${fmt(notchX)} 0 z" ` +
    `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="${strokeLinecap}" stroke-linejoin="${strokeLinejoin}" />`
  );
}

function styleAttributes(
  style: {
    stroke: string | null;
    fill: string | null;
    fillRule: "nonzero" | "evenodd";
    lineWidth: number;
    dashArray: number[] | null;
    dashOffset: number;
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
    const textColor = style.textColor ?? "#000000";
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
  attrs.push(`opacity="${fmt(style.opacity)}"`);
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
