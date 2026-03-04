import type { ScenePathCommand } from "../../semantic/types.js";

const ROUNDED_CORNERS_DEFAULT_RADIUS = 4;
const ROUNDED_CORNERS_FALLBACK_MAX = 24;
const ROUNDED_CORNERS_MIN = 0.1;

export function computePathRoundedCornersMax(commands: ScenePathCommand[]): number | null {
  const lineBased = computeLineBasedPathRoundedCornersMax(commands);
  if (lineBased != null) {
    return lineBased;
  }
  return computeGenericPathRoundedCornersMax(commands);
}

export function computeLineBasedPathRoundedCornersMax(commands: ScenePathCommand[]): number | null {
  type LineSegment = {
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
    startOffset: number;
    endOffset: number;
  };

  const EPSILON = 1e-9;
  const subpaths: Array<{ lengths: number[]; closed: boolean }> = [];
  let current: { x: number; y: number } | null = null;
  let segments: LineSegment[] = [];

  const flushSubpath = (closed: boolean, closingIndex?: number): void => {
    if (segments.length === 0) {
      segments = [];
      current = null;
      return;
    }

    if (closed && closingIndex != null) {
      const first = segments[0];
      if (first) {
        const startOffset = estimateClosingCornerStartOffset(commands, closingIndex, first.start, first.end);
        if (startOffset > EPSILON && first.startOffset <= EPSILON) {
          first.startOffset = startOffset;
          first.length = pointDistance(first.start, first.end) + first.startOffset + first.endOffset;
        }
      }
    }

    const lengths = segments
      .map((segment) => segment.length)
      .filter((length) => Number.isFinite(length) && length > EPSILON);
    if (lengths.length > 0) {
      subpaths.push({ lengths, closed });
    }

    segments = [];
    current = null;
  };

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    if (command.kind === "M") {
      flushSubpath(false);
      current = command.to;
      continue;
    }

    if (command.kind === "L") {
      if (!current) {
        current = command.to;
        continue;
      }
      const measured = pointDistance(current, command.to);
      const previous = index > 0 ? commands[index - 1] : undefined;
      const next = index + 1 < commands.length ? commands[index + 1] : undefined;
      const startOffset = estimateSegmentStartRoundedOffset(previous, current, command.to);
      const endOffset = estimateSegmentEndRoundedOffset(next, current, command.to);
      const length = measured + startOffset + endOffset;

      if (Number.isFinite(length) && length > EPSILON) {
        segments.push({
          start: current,
          end: command.to,
          length,
          startOffset,
          endOffset
        });
      }
      current = command.to;
      continue;
    }

    if (command.kind === "C" || command.kind === "A") {
      current = command.to;
      continue;
    }

    if (command.kind === "Z") {
      flushSubpath(true, index);
    }
  }
  flushSubpath(false);

  let globalMax: number | null = null;
  for (const subpath of subpaths) {
    const candidate = maxRoundedCornersForSubpath(subpath.lengths, subpath.closed);
    if (candidate == null) {
      continue;
    }
    globalMax = globalMax == null ? candidate : Math.min(globalMax, candidate);
  }

  return globalMax;
}

export function computeGenericPathRoundedCornersMax(commands: ScenePathCommand[]): number | null {
  const subpaths: Array<{ lengths: number[]; closed: boolean }> = [];
  const EPSILON = 1e-9;
  let start: { x: number; y: number } | null = null;
  let current: { x: number; y: number } | null = null;
  let lengths: number[] = [];

  const flushOpenSubpath = (): void => {
    if (lengths.length > 0) {
      subpaths.push({ lengths, closed: false });
    }
    lengths = [];
    start = null;
    current = null;
  };

  for (const command of commands) {
    if (command.kind === "M") {
      flushOpenSubpath();
      start = command.to;
      current = command.to;
      continue;
    }

    if (command.kind === "L" || command.kind === "C" || command.kind === "A") {
      if (current) {
        const length = pointDistance(current, command.to);
        if (Number.isFinite(length) && length > EPSILON) {
          lengths.push(length);
        }
      }
      current = command.to;
      continue;
    }

    if (command.kind === "Z") {
      if (current && start) {
        const closingLength = pointDistance(current, start);
        if (Number.isFinite(closingLength) && closingLength > EPSILON) {
          lengths.push(closingLength);
        }
      }
      if (lengths.length > 0) {
        subpaths.push({ lengths, closed: true });
      }
      lengths = [];
      start = null;
      current = null;
    }
  }
  flushOpenSubpath();

  let globalMax: number | null = null;
  for (const subpath of subpaths) {
    const candidate = maxRoundedCornersForSubpath(subpath.lengths, subpath.closed);
    if (candidate == null) {
      continue;
    }
    globalMax = globalMax == null ? candidate : Math.min(globalMax, candidate);
  }

  return globalMax;
}

export function estimateSegmentStartRoundedOffset(
  previous: ScenePathCommand | undefined,
  start: { x: number; y: number },
  end: { x: number; y: number }
): number {
  if (!previous || previous.kind !== "C") {
    return 0;
  }
  const direction = normalizeVector({ x: end.x - start.x, y: end.y - start.y });
  if (!direction) {
    return 0;
  }
  return estimateRoundedOffsetAlongDirection(
    {
      x: start.x - previous.c2.x,
      y: start.y - previous.c2.y
    },
    direction
  );
}

export function estimateSegmentEndRoundedOffset(
  next: ScenePathCommand | undefined,
  start: { x: number; y: number },
  end: { x: number; y: number }
): number {
  if (!next || next.kind !== "C") {
    return 0;
  }
  const direction = normalizeVector({ x: end.x - start.x, y: end.y - start.y });
  if (!direction) {
    return 0;
  }
  return estimateRoundedOffsetAlongDirection(
    {
      x: next.c1.x - end.x,
      y: next.c1.y - end.y
    },
    direction
  );
}

export function estimateClosingCornerStartOffset(
  commands: readonly ScenePathCommand[],
  closingIndex: number,
  start: { x: number; y: number },
  end: { x: number; y: number }
): number {
  const previous = closingIndex > 0 ? commands[closingIndex - 1] : undefined;
  if (!previous || previous.kind !== "C") {
    return 0;
  }
  if (pointDistance(previous.to, start) > 1e-6) {
    return 0;
  }
  return estimateSegmentStartRoundedOffset(previous, start, end);
}

export function estimateRoundedOffsetAlongDirection(
  vector: { x: number; y: number },
  direction: { x: number; y: number }
): number {
  const KAPPA = 0.5522847;
  const EPSILON = 1e-9;
  const vectorLength = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(vectorLength) || vectorLength <= EPSILON) {
    return 0;
  }

  const parallel = vector.x * direction.x + vector.y * direction.y;
  if (!Number.isFinite(parallel) || parallel <= EPSILON) {
    return 0;
  }

  const alignment = parallel / vectorLength;
  if (!Number.isFinite(alignment) || alignment < 0.9) {
    return 0;
  }

  const offset = parallel / KAPPA;
  if (!Number.isFinite(offset) || offset <= EPSILON) {
    return 0;
  }
  return offset;
}

export function normalizeVector(vector: { x: number; y: number }): { x: number; y: number } | null {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length <= 1e-9) {
    return null;
  }
  return { x: vector.x / length, y: vector.y / length };
}

export function maxRoundedCornersForSubpath(lengths: readonly number[], closed: boolean): number | null {
  if (lengths.length < 2) {
    return null;
  }

  let max = Number.POSITIVE_INFINITY;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (!Number.isFinite(length) || length <= 1e-9) {
      continue;
    }

    const hasCornersOnBothEnds = closed || (index > 0 && index < lengths.length - 1);
    const limit = hasCornersOnBothEnds ? length / 2 : length;
    max = Math.min(max, limit);
  }

  if (!Number.isFinite(max) || max <= 1e-9) {
    return null;
  }

  return max;
}

export function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalizeRoundedCornersMax(value: number | null): number {
  if (!Number.isFinite(value) || value == null) {
    return ROUNDED_CORNERS_FALLBACK_MAX;
  }
  return Math.max(ROUNDED_CORNERS_MIN, Math.round(value * 100) / 100);
}

export function clampRoundedCornersRadius(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return Math.min(ROUNDED_CORNERS_DEFAULT_RADIUS, max);
  }
  return Math.max(ROUNDED_CORNERS_MIN, Math.min(max, value));
}
