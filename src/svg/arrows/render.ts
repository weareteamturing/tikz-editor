import type { ArrowMarker, ScenePath, ScenePathCommand } from "../../semantic/types.js";
import { buildArrowTipMetrics, computeArrowShortening, normalizeArrowTip } from "./metrics.js";
import {
  clonePathCommand,
  commandsToSegments,
  flattenSubpaths,
  hasDrawablePathCommands,
  perpendicular,
  sampleFrameFromEndExtrapolated,
  sampleFrameFromStartExtrapolated,
  scaleVector,
  splitPathIntoSubpaths
} from "./path-sampler.js";
import { placeLocalPathsBent, placeLocalPathsRigid } from "./place.js";
import { buildLocalTipPaths } from "./shapes.js";
import { shortenOpenSubpath } from "./shorten.js";
import type { ArrowSide, Frame, NormalizedArrowTip, RenderedArrowPath, RenderedArrowTipPath } from "./types.js";

const DEFAULT_ARROW_COLOR = "#000000";

export function renderPathWithArrows(path: ScenePath): RenderedArrowPath {
  const clonedCommands = path.commands.map((command) => clonePathCommand(command));
  const subpaths = splitPathIntoSubpaths(path.commands);
  if (subpaths.length === 0) {
    return { shaftCommands: clonedCommands, tipPaths: [] };
  }

  const markerColor = resolveMarkerColor(path);
  const startTips = normalizeMarkerTips(path.style.markerStart, path.style.lineWidth, markerColor);
  const endTips = normalizeMarkerTips(path.style.markerEnd, path.style.lineWidth, markerColor);
  if (!shouldEmitPathTips(path, subpaths, startTips.length > 0 || endTips.length > 0)) {
    return { shaftCommands: clonedCommands, tipPaths: [] };
  }

  const lastSubpath = subpaths[subpaths.length - 1] ?? [];
  if (!hasDrawablePathCommands(lastSubpath)) {
    return { shaftCommands: clonedCommands, tipPaths: [] };
  }

  const startShortening = computeArrowShortening("start", startTips, path.style.lineWidth);
  const endShortening = computeArrowShortening("end", endTips, path.style.lineWidth);
  const shortenedLastSubpath = shortenOpenSubpath(lastSubpath, startShortening.lineEndShortening, endShortening.lineEndShortening);

  const shaftSubpaths = [...subpaths.slice(0, -1).map((subpath) => subpath.map((command) => clonePathCommand(command)))];
  shaftSubpaths.push(shortenedLastSubpath.commands.map((command) => clonePathCommand(command)));
  const shaftCommands = flattenSubpaths(shaftSubpaths);

  const tipPaths: RenderedArrowTipPath[] = [];
  const originalSegments = commandsToSegments(lastSubpath);
  const shortenedSegments = commandsToSegments(shortenedLastSubpath.commands);
  if (originalSegments.length === 0 || shortenedSegments.length === 0) {
    return { shaftCommands, tipPaths };
  }

  const startFrameForward = sampleFrameFromStartExtrapolated(shortenedSegments, 0);
  const endFrameForward = sampleFrameFromEndExtrapolated(shortenedSegments, 0);
  if (!startFrameForward || !endFrameForward) {
    return { shaftCommands, tipPaths };
  }

  tipPaths.push(
    ...renderSideTips({
      side: "start",
      plans: startShortening.plans,
      markerColor,
      contextLineWidth: path.style.lineWidth,
      frameForwardAtLineEnd: startFrameForward,
      originalSegments,
      requestedShortening: startShortening.lineEndShortening,
      appliedShortening: shortenedLastSubpath.appliedStartShortening
    })
  );
  tipPaths.push(
    ...renderSideTips({
      side: "end",
      plans: endShortening.plans,
      markerColor,
      contextLineWidth: path.style.lineWidth,
      frameForwardAtLineEnd: endFrameForward,
      originalSegments,
      requestedShortening: endShortening.lineEndShortening,
      appliedShortening: shortenedLastSubpath.appliedEndShortening
    })
  );

  return { shaftCommands, tipPaths };
}

function renderSideTips(args: {
  side: ArrowSide;
  plans: ReturnType<typeof computeArrowShortening>["plans"];
  markerColor: string;
  contextLineWidth: number;
  frameForwardAtLineEnd: Frame;
  originalSegments: ReturnType<typeof commandsToSegments>;
  requestedShortening: number;
  appliedShortening: number;
}): RenderedArrowTipPath[] {
  if (args.plans.length === 0) {
    return [];
  }

  const sideFrame = orientFrameForSide(args.frameForwardAtLineEnd, args.side);
  const shorteningDelta = args.appliedShortening - args.requestedShortening;
  const rendered: RenderedArrowTipPath[] = [];

  for (const plan of args.plans) {
    const normalized = {
      ...plan.tip,
      color: plan.tip.color ?? args.markerColor
    };
    const metrics = buildArrowTipMetrics(normalized, args.contextLineWidth);
    const localPaths = buildLocalTipPaths(normalized, metrics);
    const offset = plan.offset + shorteningDelta;

    const placedPaths = plan.bend
      ? placeLocalPathsBent(localPaths, offset, (xOffset) => frameAlongPathForSide(args.side, args.originalSegments, args.appliedShortening, xOffset))
      : placeLocalPathsRigid(localPaths, sideFrame, offset);

    const paint = resolveTipPaint(normalized, args.contextLineWidth, args.markerColor);
    for (const commands of placedPaths) {
      rendered.push({
        commands,
        side: args.side,
        index: plan.index,
        bend: plan.bend,
        tipKind: normalized.kind,
        stroke: paint.stroke,
        fill: paint.fill,
        strokeWidth: paint.strokeWidth,
        lineCap: paint.lineCap,
        lineJoin: paint.lineJoin
      });
    }
  }

  return rendered;
}

function frameAlongPathForSide(
  side: ArrowSide,
  originalSegments: ReturnType<typeof commandsToSegments>,
  appliedShortening: number,
  xOffset: number
): Frame {
  const distance = appliedShortening - xOffset;
  const forwardFrame =
    side === "start"
      ? sampleFrameFromStartExtrapolated(originalSegments, distance)
      : sampleFrameFromEndExtrapolated(originalSegments, distance);
  if (!forwardFrame) {
    return {
      point: { x: 0, y: 0 },
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: 1 }
    };
  }
  return orientFrameForSide(forwardFrame, side);
}

function orientFrameForSide(frameForward: Frame, side: ArrowSide): Frame {
  if (side === "end") {
    return frameForward;
  }
  const tangent = scaleVector(frameForward.tangent, -1);
  return {
    point: frameForward.point,
    tangent,
    normal: perpendicular(tangent)
  };
}

function normalizeMarkerTips(marker: ArrowMarker | null, contextLineWidth: number, fallbackColor: string): NormalizedArrowTip[] {
  if (!marker || marker.tips.length === 0) {
    return [];
  }
  return marker.tips.map((tip) => normalizeArrowTip(tip, contextLineWidth, fallbackColor));
}

function resolveMarkerColor(path: ScenePath): string {
  const stroke = path.style.stroke;
  if (stroke && stroke !== "none") {
    return stroke;
  }
  return DEFAULT_ARROW_COLOR;
}

function resolveTipPaint(
  tip: NormalizedArrowTip,
  contextLineWidth: number,
  markerColor: string
): {
  stroke: string;
  fill: string;
  strokeWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
} {
  const color = tip.color ?? markerColor;
  const strokeOnlyKinds = new Set([
    "bar",
    "hooks",
    "cm-rightarrow",
    "straight-barb",
    "arc-barb",
    "tee-barb",
    "rays"
  ]);
  const fillDefault = tip.open || strokeOnlyKinds.has(tip.kind) ? "none" : color;
  const fill = tip.fill ?? fillDefault;

  const explicitStrokeOnly = strokeOnlyKinds.has(tip.kind);
  const shouldStroke = explicitStrokeOnly || tip.open || tip.lineWidth > 0;
  const stroke = shouldStroke ? color : "none";
  const fallbackWidth = Number.isFinite(contextLineWidth) && contextLineWidth > 0 ? contextLineWidth : 0.4;
  const strokeWidth = stroke === "none" ? 0 : Math.max(tip.lineWidth, fallbackWidth);

  const rounded = tip.round || tip.kind === "cm-rightarrow" || tip.kind === "hooks" || tip.kind === "circle" || tip.kind === "round-cap";
  return {
    stroke,
    fill,
    strokeWidth,
    lineCap: rounded ? "round" : "butt",
    lineJoin: rounded ? "round" : "miter"
  };
}

function shouldEmitPathTips(path: ScenePath, subpaths: ScenePathCommand[][], hasAnyTip: boolean): boolean {
  if (!hasAnyTip) {
    return false;
  }

  if (path.style.tipsMode === "never") {
    return false;
  }

  if (subpaths.length === 0) {
    return false;
  }

  const lastSubpath = subpaths[subpaths.length - 1] ?? [];
  if (lastSubpath.some((command) => command.kind === "Z")) {
    return false;
  }

  const hasDrawableLastSubpath = hasDrawablePathCommands(lastSubpath);
  if (!hasDrawableLastSubpath && (path.style.tipsMode === "proper" || path.style.tipsMode === "on proper draw")) {
    return false;
  }

  const drawEnabled = path.style.drawExplicit || (path.style.stroke != null && path.style.stroke !== "none");
  if ((path.style.tipsMode === "on draw" || path.style.tipsMode === "on proper draw") && !drawEnabled) {
    return false;
  }

  return true;
}
