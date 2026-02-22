import { parseCoordinateLike, parseLength } from "../coords/parse-length.js";
import { multiplyMatrix, rotationMatrix, scaleMatrix, translationMatrix } from "../transform.js";
import type { DecorationStyle, Matrix2D, Point, ScenePath, ScenePathCommand } from "../types.js";
import { normalizeOptionValue, parseStyleValueAsOptionList } from "../style/option-utils.js";
import {
  commandsToSegments,
  hasDrawablePathCommands,
  sampleFrameFromStartExtrapolated,
  splitPathIntoSubpaths,
  totalSegmentLength,
  type PathSegment,
  sliceSegment
} from "../../geometry/path-sampler.js";

type SampleFrame = {
  point: Point;
  tangent: Point;
  normal: Point;
};

type DecorationTransformSpec = {
  matrix: Matrix2D;
  shiftOnly: boolean;
};

const DEFERRED_DECORATIONS = new Set(["markings", "show path construction", "text along path", "text effects along path"]);

const SUPPORTED_DECORATIONS = new Set([
  "lineto",
  "moveto",
  "curveto",
  "zigzag",
  "straight zigzag",
  "random steps",
  "saw",
  "bent",
  "bumps",
  "coil",
  "snake",
  "ticks",
  "expanding waves",
  "waves",
  "border",
  "brace",
  "crosses",
  "triangles",
  "koch curve type 1",
  "koch curve type 2",
  "koch snowflake",
  "cantor set",
  "footprints",
  "shape backgrounds"
]);

export type DecorationApplyResult =
  | {
      kind: "decorated";
      paths: ScenePath[];
    }
  | {
      kind: "unsupported";
      reason: "deferred" | "unknown";
      name: string;
      paths: ScenePath[];
    };

export function applyDecorationToPath(path: ScenePath, decoration: DecorationStyle, seedRaw: string): DecorationApplyResult {
  const name = canonicalDecorationName(decoration.name);
  if (!name || name === "none") {
    return {
      kind: "decorated",
      paths: [clonePath(path)]
    };
  }

  if (DEFERRED_DECORATIONS.has(name)) {
    return {
      kind: "unsupported",
      reason: "deferred",
      name,
      paths: [clonePath(path)]
    };
  }

  if (!SUPPORTED_DECORATIONS.has(name)) {
    return {
      kind: "unsupported",
      reason: "unknown",
      name,
      paths: [clonePath(path)]
    };
  }

  const decoratedCommands = decorateCommands(path.commands, decoration, seedRaw, name);
  const decoratedPath = clonePath(path);
  decoratedPath.id = `${path.id}:decorated:${sanitizeDecorationName(name)}`;
  decoratedPath.commands = decoratedCommands;
  decoratedPath.style = {
    ...decoratedPath.style,
    decoration: {
      ...decoratedPath.style.decoration,
      enabled: false,
      params: { ...decoratedPath.style.decoration.params }
    },
    decorationPreActions: [],
    decorationPostActions: []
  };

  return {
    kind: "decorated",
    paths: [decoratedPath]
  };
}

function clonePath(path: ScenePath): ScenePath {
  return {
    ...path,
    style: {
      ...path.style,
      decoration: {
        ...path.style.decoration,
        params: { ...path.style.decoration.params }
      },
      decorationPreActions: path.style.decorationPreActions.map((entry) => ({
        ...entry,
        params: { ...entry.params }
      })),
      decorationPostActions: path.style.decorationPostActions.map((entry) => ({
        ...entry,
        params: { ...entry.params }
      }))
    },
    styleChain: path.styleChain.map((entry) => ({ ...entry })),
    commands: path.commands.map((command) => cloneCommand(command))
  };
}

function cloneCommand(command: ScenePathCommand): ScenePathCommand {
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

function decorateCommands(commands: ScenePathCommand[], decoration: DecorationStyle, seedRaw: string, mainName: string): ScenePathCommand[] {
  const transformSpec = parseDecorationTransform(decoration.transformRaw);
  const subpaths = splitPathIntoSubpaths(commands).filter(hasDrawablePathCommands);
  const allCommands: ScenePathCommand[] = [];

  subpaths.forEach((subpath, subpathIndex) => {
    const expandedSubpath = expandSubpathForDecoration(subpath);
    const segments = commandsToSegments(expandedSubpath);
    if (segments.length === 0) {
      return;
    }

    const totalLength = totalSegmentLength(segments);
    const isClosed = isClosedSubpath(subpath);
    const preLength = clampLength(decoration.preLength, 0, totalLength);
    const postLength = clampLength(decoration.postLength, 0, totalLength - preLength);
    const mainStart = preLength;
    const mainEnd = Math.max(mainStart, totalLength - postLength);

    const pieces: Array<{ name: string; start: number; end: number }> = [];
    if (preLength > 1e-6) {
      pieces.push({ name: canonicalDecorationName(decoration.pre) ?? "lineto", start: 0, end: preLength });
    }
    pieces.push({ name: mainName, start: mainStart, end: mainEnd });
    if (postLength > 1e-6) {
      pieces.push({ name: canonicalDecorationName(decoration.post) ?? "lineto", start: mainEnd, end: totalLength });
    }

    for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
      const piece = pieces[pieceIndex];
      const pieceSegments = sliceSegmentsByRange(segments, piece.start, piece.end);
      if (pieceSegments.length === 0) {
        continue;
      }

      const seed = `${seedRaw}:${subpathIndex}:${pieceIndex}:${piece.name}`;
      const polylines = decorateSegments(pieceSegments, piece.name, decoration, transformSpec, seed);
      for (const polyline of polylines) {
        if (polyline.length === 0) {
          continue;
        }
        allCommands.push({ kind: "M", to: polyline[0] });
        for (let index = 1; index < polyline.length; index += 1) {
          allCommands.push({ kind: "L", to: polyline[index] });
        }
        const coversFullSubpath = piece.start <= 1e-6 && Math.abs(piece.end - totalLength) <= 1e-6;
        if (isClosed && coversFullSubpath) {
          allCommands.push({ kind: "Z" });
        }
      }
    }
  });

  if (allCommands.length === 0) {
    return commands.map((command) => cloneCommand(command));
  }
  return allCommands;
}

function decorateSegments(
  segments: PathSegment[],
  name: string,
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  seedRaw: string
): Point[][] {
  const canonical = canonicalDecorationName(name) ?? "lineto";

  switch (canonical) {
    case "moveto":
      return decorateMoveto(segments, decoration, transformSpec);
    case "lineto":
    case "curveto":
      return [decorateLineto(segments, decoration, transformSpec)];
    case "zigzag":
      return [decorateZigzag(segments, decoration, transformSpec)];
    case "straight zigzag":
      return [decorateStraightZigzag(segments, decoration, transformSpec)];
    case "random steps":
      return [decorateRandomSteps(segments, decoration, transformSpec, seedRaw)];
    case "saw":
      return [decorateSaw(segments, decoration, transformSpec)];
    case "bent":
      return [decorateBent(segments, decoration, transformSpec)];
    case "bumps":
      return [decorateBumps(segments, decoration, transformSpec)];
    case "coil":
      return [decorateWave(segments, decoration, transformSpec, "coil")];
    case "snake":
      return [decorateWave(segments, decoration, transformSpec, "snake")];
    case "waves":
      return [decorateWave(segments, decoration, transformSpec, "waves")];
    case "expanding waves":
      return [decorateWave(segments, decoration, transformSpec, "expanding waves")];
    case "ticks":
      return decorateTicksLike(segments, decoration, transformSpec, "ticks");
    case "border":
      return decorateTicksLike(segments, decoration, transformSpec, "border");
    case "crosses":
      return decorateShapeMarks(segments, decoration, transformSpec, "crosses");
    case "triangles":
      return decorateShapeMarks(segments, decoration, transformSpec, "triangles");
    case "footprints":
      return decorateShapeMarks(segments, decoration, transformSpec, "footprints");
    case "shape backgrounds":
      return decorateShapeMarks(segments, decoration, transformSpec, "shape backgrounds");
    case "brace":
      return [decorateBrace(segments, decoration, transformSpec)];
    case "koch curve type 1":
      return applyFractal(segments, decoration, transformSpec, "koch1");
    case "koch curve type 2":
      return applyFractal(segments, decoration, transformSpec, "koch2");
    case "koch snowflake":
      return applyFractal(segments, decoration, transformSpec, "snowflake");
    case "cantor set":
      return applyFractal(segments, decoration, transformSpec, "cantor");
    default:
      return [decorateLineto(segments, decoration, transformSpec)];
  }
}

function decorateLineto(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): Point[] {
  return samplePolyline(segments, Math.max(2, getSegmentLength(decoration) / 2), decoration, transformSpec, () => 0);
}

function decorateMoveto(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): Point[][] {
  const total = totalSegmentLength(segments);
  if (total <= 1e-9) {
    return [];
  }
  const firstFrame = sampleFrameFromStartExtrapolated(segments, 0);
  const endFrame = sampleFrameFromStartExtrapolated(segments, total);
  if (!firstFrame || !endFrame) {
    return [];
  }
  return [[
    pointFromFrame(firstFrame, 0, 0, decoration, transformSpec),
    pointFromFrame(endFrame, 0, 0, decoration, transformSpec)
  ]];
}

function decorateZigzag(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): Point[] {
  const segmentLength = Math.max(0.5, getSegmentLength(decoration));
  const half = segmentLength / 2;
  const total = totalSegmentLength(segments);
  const points: Point[] = [];

  const pushAt = (distance: number, offset: number): void => {
    const frame = sampleFrameFromStartExtrapolated(segments, distance);
    if (!frame) {
      return;
    }
    points.push(pointFromFrame(frame, 0, offset, decoration, transformSpec));
  };

  pushAt(0, 0);
  let index = 1;
  for (let distance = half; distance < total - 1e-6; distance += half, index += 1) {
    const offset = index % 2 === 1 ? getAmplitude(decoration) : -getAmplitude(decoration);
    pushAt(distance, offset);
  }
  pushAt(total, 0);
  return points;
}

function decorateStraightZigzag(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): Point[] {
  const zigzag = decorateZigzag(segments, decoration, transformSpec);
  if (zigzag.length <= 2) {
    return zigzag;
  }

  const filtered: Point[] = [];
  for (let index = 0; index < zigzag.length; index += 1) {
    if (index === 0 || index === zigzag.length - 1 || index % 2 === 1) {
      filtered.push(zigzag[index]);
    }
  }
  return filtered;
}

function decorateRandomSteps(
  segments: PathSegment[],
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  seedRaw: string
): Point[] {
  const random = makeDeterministicRandom(seedRaw);
  const polylines: Point[][] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segmentSeed = `${seedRaw}:segment:${index}`;
    const segmentRandom = index === 0 ? random : makeDeterministicRandom(segmentSeed);
    const segmentPoints = decorateRandomStepsOnSegment(segments[index], decoration, transformSpec, segmentRandom);
    if (segmentPoints.length > 0) {
      polylines.push(segmentPoints);
    }
  }

  return flattenSegmentPolylines(polylines);
}

function decorateRandomStepsOnSegment(
  segment: PathSegment,
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  random: () => number
): Point[] {
  const segmentLength = Math.max(1, getSegmentLength(decoration));
  const amplitude = getAmplitude(decoration);
  const total = segment.length;
  if (total <= 1e-9) {
    return [];
  }

  const points: Point[] = [];
  const startFrame = sampleFrameFromStartExtrapolated([segment], 0);
  if (!startFrame) {
    return points;
  }
  points.push(pointFromFrame(startFrame, 0, 0, decoration, transformSpec));

  for (let stateStart = 0; stateStart + 1.5 * segmentLength <= total + 1e-9; stateStart += segmentLength) {
    const frame = sampleFrameFromStartExtrapolated([segment], stateStart);
    if (!frame) {
      continue;
    }
    const jitterX = random() * amplitude;
    const jitterY = random() * amplitude;
    points.push(pointFromFrame(frame, segmentLength + jitterX, jitterY, decoration, transformSpec));
  }

  const endFrame = sampleFrameFromStartExtrapolated([segment], total);
  if (endFrame) {
    points.push(pointFromFrame(endFrame, 0, 0, decoration, transformSpec));
  }
  return dedupePoints(points);
}

function decorateSaw(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): Point[] {
  const segmentLength = Math.max(0.5, getSegmentLength(decoration));
  const amplitude = getAmplitude(decoration);
  const total = totalSegmentLength(segments);
  const points: Point[] = [];

  const startFrame = sampleFrameFromStartExtrapolated(segments, 0);
  if (!startFrame) {
    return points;
  }
  points.push(pointFromFrame(startFrame, 0, 0, decoration, transformSpec));

  for (let distance = 0; distance < total - 1e-6; distance += segmentLength) {
    const peakDistance = Math.min(total, distance + segmentLength / 2);
    const endDistance = Math.min(total, distance + segmentLength);
    const peakFrame = sampleFrameFromStartExtrapolated(segments, peakDistance);
    const endFrame = sampleFrameFromStartExtrapolated(segments, endDistance);
    if (peakFrame) {
      points.push(pointFromFrame(peakFrame, 0, amplitude, decoration, transformSpec));
    }
    if (endFrame) {
      points.push(pointFromFrame(endFrame, 0, 0, decoration, transformSpec));
    }
  }

  return points;
}

function decorateBent(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): Point[] {
  const total = totalSegmentLength(segments);
  const amplitude = getAmplitude(decoration);
  const aspect = getNumberParam(decoration, "aspect", 0.5);
  const points: Point[] = [];

  const startFrame = sampleFrameFromStartExtrapolated(segments, 0);
  const midFrame = sampleFrameFromStartExtrapolated(segments, clampLength(total * aspect, 0, total));
  const endFrame = sampleFrameFromStartExtrapolated(segments, total);
  if (!startFrame || !midFrame || !endFrame) {
    return decorateLineto(segments, decoration, transformSpec);
  }

  points.push(pointFromFrame(startFrame, 0, 0, decoration, transformSpec));
  points.push(pointFromFrame(midFrame, 0, amplitude, decoration, transformSpec));
  points.push(pointFromFrame(endFrame, 0, 0, decoration, transformSpec));
  return points;
}

function decorateWave(
  segments: PathSegment[],
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  kind: "bumps" | "coil" | "snake" | "waves" | "expanding waves"
): Point[] {
  const total = totalSegmentLength(segments);
  if (total <= 1e-9) {
    return [];
  }

  const segmentLength = Math.max(1, getSegmentLength(decoration));
  const amplitude = kind === "waves" || kind === "expanding waves" ? getStartRadius(decoration) : getAmplitude(decoration);
  const cycles = Math.max(1, total / segmentLength);
  const samples = Math.max(16, Math.ceil(cycles * 12));
  const points: Point[] = [];

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const distance = t * total;
    const frame = sampleFrameFromStartExtrapolated(segments, distance);
    if (!frame) {
      continue;
    }

    let envelope = 1;
    if (kind === "expanding waves") {
      envelope = 0.5 + 0.5 * t;
    }

    let phaseScale = 1;
    if (kind === "coil") {
      phaseScale = 2;
    }

    const phase = t * cycles * Math.PI * 2 * phaseScale;
    let offset = Math.sin(phase) * amplitude * envelope;
    if (kind === "bumps") {
      offset = Math.abs(Math.sin(phase)) * amplitude;
    }
    if (index === 0 || index === samples) {
      offset = 0;
    }

    points.push(pointFromFrame(frame, 0, offset, decoration, transformSpec));
  }

  return points;
}

function decorateBumps(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): Point[] {
  const bumpSegmentLength = Math.max(1, getSegmentLength(decoration));
  const stateWidth = 0.5 * bumpSegmentLength;
  const amplitude = getAmplitude(decoration);
  const polylines: Point[][] = [];

  for (const segment of segments) {
    const total = segment.length;
    if (total <= 1e-9) {
      continue;
    }

    const segmentPolyline: Point[] = [];
    const startFrame = sampleFrameFromStartExtrapolated([segment], 0);
    if (startFrame) {
      segmentPolyline.push(pointFromFrame(startFrame, 0, 0, decoration, transformSpec));
    }

    for (let stateStart = 0; stateStart + 0.51 * bumpSegmentLength <= total + 1e-9; stateStart += stateWidth) {
      const frame = sampleFrameFromStartExtrapolated([segment], stateStart);
      if (!frame) {
        continue;
      }

      const firstCurve = sampleCubic(
        { x: 0, y: 0 },
        { x: 0, y: 0.555 * amplitude },
        { x: 0.11125 * bumpSegmentLength, y: amplitude },
        { x: 0.25 * bumpSegmentLength, y: amplitude },
        6
      );
      const secondCurve = sampleCubic(
        { x: 0.25 * bumpSegmentLength, y: amplitude },
        { x: 0.38875 * bumpSegmentLength, y: amplitude },
        { x: 0.5 * bumpSegmentLength, y: 0.5 * amplitude },
        { x: 0.5 * bumpSegmentLength, y: 0 },
        6
      );

      const localPoints = [...firstCurve, ...secondCurve.slice(1)];
      for (const local of localPoints) {
        segmentPolyline.push(pointFromFrame(frame, local.x, local.y, decoration, transformSpec));
      }
    }

    const endFrame = sampleFrameFromStartExtrapolated([segment], total);
    if (endFrame) {
      segmentPolyline.push(pointFromFrame(endFrame, 0, 0, decoration, transformSpec));
    }

    const deduped = dedupePoints(segmentPolyline);
    if (deduped.length > 0) {
      polylines.push(deduped);
    }
  }

  return flattenSegmentPolylines(polylines);
}

function decorateTicksLike(
  segments: PathSegment[],
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  kind: "ticks" | "border"
): Point[][] {
  const spacing = Math.max(1, getSegmentLength(decoration));
  const total = totalSegmentLength(segments);
  const amplitude = getAmplitude(decoration);
  const angleDegrees = getNumberParam(decoration, "angle", 45);
  const angleRadians = (angleDegrees * Math.PI) / 180;
  const polylines: Point[][] = [];

  for (let distance = 0; distance <= total + 1e-6; distance += spacing) {
    const frame = sampleFrameFromStartExtrapolated(segments, Math.min(distance, total));
    if (!frame) {
      continue;
    }

    if (kind === "ticks") {
      const top = pointFromFrame(frame, 0, amplitude, decoration, transformSpec);
      const bottom = pointFromFrame(frame, 0, -amplitude, decoration, transformSpec);
      polylines.push([top, bottom]);
      continue;
    }

    const endLocalX = Math.cos(angleRadians) * amplitude;
    const endLocalY = Math.sin(angleRadians) * amplitude;
    const start = pointFromFrame(frame, 0, 0, decoration, transformSpec);
    const end = pointFromFrame(frame, endLocalX, endLocalY, decoration, transformSpec);
    polylines.push([start, end]);
  }

  return polylines;
}

function decorateShapeMarks(
  segments: PathSegment[],
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  kind: "crosses" | "triangles" | "footprints" | "shape backgrounds"
): Point[][] {
  const spacing = getShapeSpacing(decoration);
  const total = totalSegmentLength(segments);
  const width = getShapeWidth(decoration);
  const height = getShapeHeight(decoration);
  const shapeName = canonicalDecorationName(decoration.params["shape"] ?? "circle") ?? "circle";
  const followPath = !transformSpec.shiftOnly;
  const polylines: Point[][] = [];

  for (let distance = 0; distance <= total + 1e-6; distance += spacing) {
    const frame = sampleFrameFromStartExtrapolated(segments, Math.min(distance, total));
    if (!frame) {
      continue;
    }

    if (kind === "crosses") {
      polylines.push([
        pointFromFrame(frame, -width / 2, height / 2, decoration, transformSpec, followPath),
        pointFromFrame(frame, width / 2, -height / 2, decoration, transformSpec, followPath)
      ]);
      polylines.push([
        pointFromFrame(frame, -width / 2, -height / 2, decoration, transformSpec, followPath),
        pointFromFrame(frame, width / 2, height / 2, decoration, transformSpec, followPath)
      ]);
      continue;
    }

    if (kind === "triangles") {
      polylines.push([
        pointFromFrame(frame, 0, height / 2, decoration, transformSpec, followPath),
        pointFromFrame(frame, width / 2, -height / 2, decoration, transformSpec, followPath),
        pointFromFrame(frame, -width / 2, -height / 2, decoration, transformSpec, followPath),
        pointFromFrame(frame, 0, height / 2, decoration, transformSpec, followPath)
      ]);
      continue;
    }

    if (kind === "footprints") {
      const toe = pointFromFrame(frame, width / 2, 0, decoration, transformSpec, followPath);
      const heelTop = pointFromFrame(frame, -width / 2, height / 2, decoration, transformSpec, followPath);
      const heelBottom = pointFromFrame(frame, -width / 2, -height / 2, decoration, transformSpec, followPath);
      polylines.push([heelTop, toe, heelBottom]);
      continue;
    }

    const backgroundPolylines = makeShapeBackgroundPolylines(frame, shapeName, width, height, decoration, transformSpec, followPath);
    polylines.push(...backgroundPolylines);
  }

  return polylines;
}

function makeShapeBackgroundPolylines(
  frame: SampleFrame,
  shapeName: string,
  width: number,
  height: number,
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  followPath: boolean
): Point[][] {
  const pointsToPolyline = (entries: Array<{ x: number; y: number }>): Point[] =>
    entries.map((entry) => pointFromFrame(frame, entry.x, entry.y, decoration, transformSpec, followPath));

  if (shapeName === "rectangle") {
    return [
      pointsToPolyline([
        { x: -width / 2, y: -height / 2 },
        { x: width / 2, y: -height / 2 },
        { x: width / 2, y: height / 2 },
        { x: -width / 2, y: height / 2 },
        { x: -width / 2, y: -height / 2 }
      ])
    ];
  }

  if (shapeName === "triangle" || shapeName === "triangles") {
    return [
      pointsToPolyline([
        { x: 0, y: height / 2 },
        { x: width / 2, y: -height / 2 },
        { x: -width / 2, y: -height / 2 },
        { x: 0, y: height / 2 }
      ])
    ];
  }

  // default: approximate circle/ellipse
  const samples = 10;
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index <= samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2;
    points.push({
      x: Math.cos(angle) * width * 0.5,
      y: Math.sin(angle) * height * 0.5
    });
  }
  return [pointsToPolyline(points)];
}

function decorateBrace(segments: PathSegment[], decoration: DecorationStyle, transformSpec: DecorationTransformSpec): Point[] {
  const total = totalSegmentLength(segments);
  if (total <= 1e-9) {
    return [];
  }

  const amplitude = getAmplitude(decoration);
  const aspect = clampLength(getNumberParam(decoration, "aspect", 0.5), 0, 1);
  let yc = aspect * total;
  if (2 * amplitude > yc) {
    yc = 0.5 * yc;
  } else {
    yc = amplitude;
  }

  let xc = aspect * total - total;
  if (-2 * amplitude < xc) {
    xc = -0.5 * xc;
  } else {
    xc = amplitude;
  }

  const localPoints: Array<{ x: number; y: number }> = [];
  localPoints.push(...sampleCubic(
    { x: 0, y: 0 },
    { x: 0.15 * yc, y: 0.3 * amplitude },
    { x: 0.5 * yc, y: 0.5 * amplitude },
    { x: yc, y: 0.5 * amplitude },
    10
  ));
  localPoints.push({ x: aspect * total - yc, y: 0.5 * amplitude });
  localPoints.push(...sampleCubic(
    { x: aspect * total - yc, y: 0.5 * amplitude },
    { x: aspect * total - 0.5 * yc, y: 0.5 * amplitude },
    { x: aspect * total - 0.15 * yc, y: 0.7 * amplitude },
    { x: aspect * total, y: 1 * amplitude },
    10
  ));
  localPoints.push(...sampleCubic(
    { x: aspect * total, y: 1 * amplitude },
    { x: aspect * total + 0.15 * xc, y: 0.7 * amplitude },
    { x: aspect * total + 0.5 * xc, y: 0.5 * amplitude },
    { x: aspect * total + xc, y: 0.5 * amplitude },
    10
  ));
  localPoints.push({ x: total - xc, y: 0.5 * amplitude });
  localPoints.push(...sampleCubic(
    { x: total - xc, y: 0.5 * amplitude },
    { x: total - 0.5 * xc, y: 0.5 * amplitude },
    { x: total - 0.15 * xc, y: 0.3 * amplitude },
    { x: total, y: 0 },
    10
  ));

  const points: Point[] = [];
  for (const local of dedupeLocalPoints(localPoints)) {
    const distance = clampLength(local.x, 0, total);
    const frame = sampleFrameFromStartExtrapolated(segments, distance);
    if (!frame) {
      continue;
    }
    points.push(pointFromFrame(frame, 0, local.y, decoration, transformSpec));
  }

  return points;
}

function applyFractal(
  segments: PathSegment[],
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  variant: "koch1" | "koch2" | "snowflake" | "cantor"
): Point[][] {
  const base = samplePolyline(segments, Math.max(1, getSegmentLength(decoration) / 2), decoration, transformSpec, () => 0);
  if (base.length < 2) {
    return [base];
  }

  if (variant === "cantor") {
    const polylines: Point[][] = [];
    for (let index = 0; index < base.length - 1; index += 1) {
      const from = base[index];
      const to = base[index + 1];
      const p1 = interpolatePoint(from, to, 0);
      const p2 = interpolatePoint(from, to, 1 / 3);
      const p3 = interpolatePoint(from, to, 2 / 3);
      const p4 = interpolatePoint(from, to, 1);
      polylines.push([p1, p2]);
      polylines.push([p3, p4]);
    }
    return polylines;
  }

  const pattern =
    variant === "koch1"
      ? [
          { x: 0, y: 0 },
          { x: 1 / 3, y: 0 },
          { x: 1 / 3, y: 1 / 3 },
          { x: 2 / 3, y: 1 / 3 },
          { x: 2 / 3, y: 0 },
          { x: 1, y: 0 }
        ]
      : variant === "koch2"
        ? [
            { x: 0, y: 0 },
            { x: 1 / 4, y: 0 },
            { x: 1 / 4, y: 1 / 4 },
            { x: 1 / 2, y: 1 / 4 },
            { x: 1 / 2, y: 0 },
            { x: 1 / 2, y: -1 / 4 },
            { x: 3 / 4, y: -1 / 4 },
            { x: 3 / 4, y: 0 },
            { x: 1, y: 0 }
          ]
        : [
            { x: 0, y: 0 },
            { x: 1 / 3, y: 0 },
            { x: 1 / 2, y: Math.sqrt(3) / 6 },
            { x: 2 / 3, y: 0 },
            { x: 1, y: 0 }
          ];

  const out: Point[] = [];
  for (let index = 0; index < base.length - 1; index += 1) {
    const from = base[index];
    const to = base[index + 1];
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    for (let patternIndex = 0; patternIndex < pattern.length; patternIndex += 1) {
      const local = pattern[patternIndex];
      if (index > 0 && patternIndex === 0) {
        continue;
      }
      out.push({
        x: from.x + dx * local.x - dy * local.y,
        y: from.y + dy * local.x + dx * local.y
      });
    }
  }

  return [out];
}

function samplePolyline(
  segments: PathSegment[],
  spacing: number,
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  offsetAtDistance: (distance: number, total: number) => number
): Point[] {
  const total = totalSegmentLength(segments);
  if (total <= 1e-9) {
    return [];
  }

  const points: Point[] = [];
  const effectiveSpacing = Math.max(0.5, spacing);
  for (let distance = 0; distance <= total + 1e-6; distance += effectiveSpacing) {
    const clampedDistance = Math.min(distance, total);
    const frame = sampleFrameFromStartExtrapolated(segments, clampedDistance);
    if (!frame) {
      continue;
    }
    points.push(pointFromFrame(frame, 0, offsetAtDistance(clampedDistance, total), decoration, transformSpec));
  }

  const endFrame = sampleFrameFromStartExtrapolated(segments, total);
  if (endFrame) {
    const endPoint = pointFromFrame(endFrame, 0, offsetAtDistance(total, total), decoration, transformSpec);
    const last = points[points.length - 1];
    if (!last || Math.hypot(last.x - endPoint.x, last.y - endPoint.y) > 1e-9) {
      points.push(endPoint);
    }
  }

  return points;
}

function pointFromFrame(
  frame: SampleFrame,
  localX: number,
  localY: number,
  decoration: DecorationStyle,
  transformSpec: DecorationTransformSpec,
  followPath = true
): Point {
  const raisedY = localY + decoration.raise;
  const mirroredY = decoration.mirror ? -raisedY : raisedY;
  const transformed = applyDecorationMatrix(transformSpec.matrix, {
    x: localX,
    y: mirroredY
  });
  if (!followPath) {
    return {
      x: frame.point.x + transformed.x,
      y: frame.point.y + transformed.y
    };
  }
  return {
    x: frame.point.x + frame.tangent.x * transformed.x + frame.normal.x * transformed.y,
    y: frame.point.y + frame.tangent.y * transformed.x + frame.normal.y * transformed.y
  };
}

function applyDecorationMatrix(matrix: Matrix2D, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f
  };
}

function parseDecorationTransform(raw: string | null): DecorationTransformSpec {
  const identity: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const defaultSpec: DecorationTransformSpec = {
    matrix: identity,
    shiftOnly: false
  };
  if (!raw || raw.trim().length === 0) {
    return defaultSpec;
  }

  const options = parseStyleValueAsOptionList(raw);
  if (!options) {
    return defaultSpec;
  }

  let transform = identity;
  let shiftOnly = false;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key.trim().toLowerCase() === "shift only") {
      shiftOnly = true;
      continue;
    }
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "shift only") {
      const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
      if (normalized.length === 0 || normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
        shiftOnly = true;
      }
      continue;
    }
    if (entry.key === "xshift") {
      const value = parseLength(entry.valueRaw, "pt");
      if (value != null) {
        transform = multiplyMatrix(transform, translationMatrix(value, 0));
      }
      continue;
    }
    if (entry.key === "yshift") {
      const value = parseLength(entry.valueRaw, "pt");
      if (value != null) {
        transform = multiplyMatrix(transform, translationMatrix(0, value));
      }
      continue;
    }
    if (entry.key === "shift") {
      const parsed = parseCoordinateLike(normalizeOptionValue(entry.valueRaw));
      if (!parsed) {
        continue;
      }
      const x = parseLength(parsed.x, "cm");
      const y = parseLength(parsed.y, "cm");
      if (x == null || y == null) {
        continue;
      }
      transform = multiplyMatrix(transform, translationMatrix(x, y));
      continue;
    }
    if (entry.key === "scale") {
      const value = Number(entry.valueRaw);
      if (Number.isFinite(value)) {
        transform = multiplyMatrix(transform, scaleMatrix(value, value));
      }
      continue;
    }
    if (entry.key === "xscale") {
      const value = Number(entry.valueRaw);
      if (Number.isFinite(value)) {
        transform = multiplyMatrix(transform, scaleMatrix(value, 1));
      }
      continue;
    }
    if (entry.key === "yscale") {
      const value = Number(entry.valueRaw);
      if (Number.isFinite(value)) {
        transform = multiplyMatrix(transform, scaleMatrix(1, value));
      }
      continue;
    }
    if (entry.key === "rotate") {
      const value = Number(entry.valueRaw);
      if (Number.isFinite(value)) {
        transform = multiplyMatrix(transform, rotationMatrix(value));
      }
    }
  }

  return {
    matrix: transform,
    shiftOnly
  };
}

function getSegmentLength(decoration: DecorationStyle): number {
  return getLengthParam(decoration, "segment length", 10);
}

function getAmplitude(decoration: DecorationStyle): number {
  return getLengthParam(decoration, "amplitude", 2.5);
}

function getStartRadius(decoration: DecorationStyle): number {
  return getLengthParam(decoration, "start radius", 2.5);
}

function getShapeWidth(decoration: DecorationStyle): number {
  const size = getLengthParam(decoration, "shape size", NaN);
  if (Number.isFinite(size)) {
    return size;
  }
  return getLengthParam(decoration, "shape width", getLengthParam(decoration, "shape start width", 2.5));
}

function getShapeHeight(decoration: DecorationStyle): number {
  const size = getLengthParam(decoration, "shape size", NaN);
  if (Number.isFinite(size)) {
    return size;
  }
  return getLengthParam(decoration, "shape height", getLengthParam(decoration, "shape start height", 2.5));
}

function getShapeSpacing(decoration: DecorationStyle): number {
  const raw = decoration.params["shape sep"];
  if (!raw) {
    return Math.max(1, getSegmentLength(decoration));
  }

  const firstToken = raw.split(",")[0]?.trim() ?? raw;
  const parsed = parseLength(firstToken, "pt");
  if (parsed == null) {
    return Math.max(1, getSegmentLength(decoration));
  }
  return Math.max(1, parsed);
}

function getLengthParam(decoration: DecorationStyle, key: string, fallback: number): number {
  const raw = decoration.params[key];
  if (!raw) {
    return fallback;
  }
  const parsed = parseLength(raw, "pt");
  return parsed == null ? fallback : parsed;
}

function getNumberParam(decoration: DecorationStyle, key: string, fallback: number): number {
  const raw = decoration.params[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(normalizeOptionValue(raw));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sliceSegmentsByRange(segments: PathSegment[], start: number, end: number): PathSegment[] {
  const result: PathSegment[] = [];
  let cursor = 0;

  for (const segment of segments) {
    const segmentStart = cursor;
    const segmentEnd = cursor + segment.length;
    cursor = segmentEnd;

    if (end <= segmentStart) {
      break;
    }
    if (start >= segmentEnd) {
      continue;
    }

    const localStart = Math.max(0, start - segmentStart);
    const localEnd = Math.min(segment.length, end - segmentStart);
    const sliced = sliceSegment(segment, localStart, localEnd);
    if (sliced) {
      result.push(sliced);
    }
  }

  return result;
}

function isClosedSubpath(commands: ScenePathCommand[]): boolean {
  if (commands.length === 0) {
    return false;
  }

  const hasCloseCommand = commands.some((command) => command.kind === "Z");
  if (hasCloseCommand) {
    return true;
  }

  const firstMove = commands.find((command): command is Extract<ScenePathCommand, { kind: "M" }> => command.kind === "M");
  if (!firstMove) {
    return false;
  }

  let lastPoint: Point | null = null;
  for (const command of commands) {
    if (command.kind === "M" || command.kind === "L" || command.kind === "A" || command.kind === "C") {
      lastPoint = command.to;
    }
  }
  if (!lastPoint) {
    return false;
  }

  return Math.hypot(lastPoint.x - firstMove.to.x, lastPoint.y - firstMove.to.y) <= 1e-6;
}

function expandSubpathForDecoration(commands: ScenePathCommand[]): ScenePathCommand[] {
  const expanded: ScenePathCommand[] = [];
  let subpathStart: Point | null = null;
  let currentPoint: Point | null = null;

  for (const command of commands) {
    if (command.kind === "M") {
      expanded.push(cloneCommand(command));
      subpathStart = { ...command.to };
      currentPoint = { ...command.to };
      continue;
    }

    if (command.kind === "Z") {
      if (subpathStart && currentPoint) {
        if (Math.hypot(subpathStart.x - currentPoint.x, subpathStart.y - currentPoint.y) > 1e-6) {
          expanded.push({
            kind: "L",
            to: { ...subpathStart }
          });
        }
        currentPoint = { ...subpathStart };
      }
      continue;
    }

    expanded.push(cloneCommand(command));
    currentPoint = { ...command.to };
  }

  return expanded;
}

function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point, steps: number): Point[] {
  const points: Point[] = [];
  const clampedSteps = Math.max(1, steps);
  for (let index = 0; index <= clampedSteps; index += 1) {
    const t = index / clampedSteps;
    const oneMinusT = 1 - t;
    points.push({
      x:
        oneMinusT * oneMinusT * oneMinusT * p0.x +
        3 * oneMinusT * oneMinusT * t * p1.x +
        3 * oneMinusT * t * t * p2.x +
        t * t * t * p3.x,
      y:
        oneMinusT * oneMinusT * oneMinusT * p0.y +
        3 * oneMinusT * oneMinusT * t * p1.y +
        3 * oneMinusT * t * t * p2.y +
        t * t * t * p3.y
    });
  }
  return points;
}

function dedupeLocalPoints(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const deduped: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 1e-6) {
      deduped.push(point);
    }
  }
  return deduped;
}

function dedupePoints(points: Point[]): Point[] {
  const deduped: Point[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 1e-6) {
      deduped.push(point);
    }
  }
  return deduped;
}

function flattenSegmentPolylines(polylines: Point[][]): Point[] {
  const output: Point[] = [];
  for (const polyline of polylines) {
    if (polyline.length === 0) {
      continue;
    }
    if (output.length === 0) {
      output.push(...polyline);
      continue;
    }
    const first = polyline[0];
    const last = output[output.length - 1];
    if (!last || Math.hypot(last.x - first.x, last.y - first.y) > 1e-6) {
      output.push(first);
    }
    output.push(...polyline.slice(1));
  }
  return output;
}

function canonicalDecorationName(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized.startsWith("name=")) {
    return canonicalDecorationName(normalized.slice(5));
  }
  return normalized.length > 0 ? normalized : null;
}

function sanitizeDecorationName(raw: string): string {
  return raw.replace(/[^a-z0-9]+/gi, "-").replace(/(^-+|-+$)/g, "");
}

function clampLength(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function makeDeterministicRandom(seedRaw: string): () => number {
  let state = 0x811c9dc5;
  for (let index = 0; index < seedRaw.length; index += 1) {
    state ^= seedRaw.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  if (state === 0) {
    state = 0x12345678;
  }

  return () => {
    state = Math.imul(state, 1664525) + 1013904223;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function interpolatePoint(from: Point, to: Point, t: number): Point {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t
  };
}

export function isDecorationDeferred(name: string): boolean {
  return DEFERRED_DECORATIONS.has(canonicalDecorationName(name) ?? "");
}
