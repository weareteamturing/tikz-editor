import type { ScenePathCommand } from "../../semantic/types.js";
import { computeLatexShapeParameters, computeStealthShapeParameters } from "./metrics.js";
import type { ArrowTipMetrics, NormalizedArrowTip } from "./types.js";

export function buildLocalTipPaths(tip: NormalizedArrowTip, metrics: ArrowTipMetrics): ScenePathCommand[][] {
  const rawPaths = buildRawTipPaths(tip);
  const mirrored = tip.reversed ? rawPaths.map((path) => transformPath(path, (x, y) => ({ x: -x, y }))) : rawPaths;
  const lineEndShift = -metrics.lineEnd;
  return mirrored.map((path) => transformPath(path, (x, y) => ({ x: x + lineEndShift, y })));
}

function buildRawTipPaths(tip: NormalizedArrowTip): ScenePathCommand[][] {
  const halfWidth = tip.width / 2;

  if (tip.kind === "cm-rightarrow") {
    const c1x = tip.length * 0.18269;
    const c2x = tip.length * 0.58981;
    const c1y = halfWidth * 0.4;
    const c2y = halfWidth * 0.116666;
    return [
      [
        moveTo(0, halfWidth),
        cubicTo(c1x, c1y, c2x, c2y, tip.length, 0),
        cubicTo(c2x, -c2y, c1x, -c1y, 0, -halfWidth)
      ]
    ];
  }

  if (tip.kind === "bar") {
    return [[moveTo(0, -halfWidth), lineTo(0, halfWidth)]];
  }

  if (tip.kind === "hooks") {
    const controlX = tip.length * 0.45;
    const upper = quadraticAsCubic(moveTo(tip.length, 0), controlX, halfWidth, 0, halfWidth);
    const lower = quadraticAsCubic(moveTo(tip.length, 0), controlX, -halfWidth, 0, -halfWidth);
    return [upper, lower];
  }

  if (tip.kind === "implies") {
    const midX = tip.length * 0.62;
    const innerTailX = tip.length * 0.35;
    const innerMidX = tip.length * 0.727;
    const innerPointX = tip.length * 0.97;
    return [
      [moveTo(0, halfWidth), lineTo(midX, halfWidth), lineTo(tip.length, 0), lineTo(midX, -halfWidth), lineTo(0, -halfWidth), close()],
      [
        moveTo(innerTailX, halfWidth * 0.7),
        lineTo(innerMidX, halfWidth * 0.7),
        lineTo(innerPointX, 0),
        lineTo(innerMidX, -halfWidth * 0.7),
        lineTo(innerTailX, -halfWidth * 0.7),
        close()
      ]
    ];
  }

  if (tip.kind === "stealth") {
    const params = computeStealthShapeParameters(tip);
    const tipX = params.innerLength + params.backMiter;
    const topX = params.backMiter;
    const insetX = params.inset + params.insetMiter;
    const innerHalfWidth = params.innerHalfWidth;
    return [[moveTo(tipX, 0), lineTo(topX, innerHalfWidth), lineTo(insetX, 0), lineTo(topX, -innerHalfWidth), close()]];
  }

  if (tip.kind === "latex") {
    const params = computeLatexShapeParameters(tip);
    const innerLength = params.innerLength;
    const halfBackWidth = params.halfBackWidth;
    return [
      [
        moveTo(innerLength, 0),
        cubicTo(0.877192 * innerLength, 0.077922 * halfBackWidth, 0.337381 * innerLength, 0.51948 * halfBackWidth, 0, halfBackWidth),
        lineTo(0, -halfBackWidth),
        cubicTo(0.337381 * innerLength, -0.51948 * halfBackWidth, 0.877192 * innerLength, -0.077922 * halfBackWidth, innerLength, 0),
        close()
      ]
    ];
  }

  if (tip.kind === "triangle") {
    return [[moveTo(0, halfWidth), lineTo(tip.length, 0), lineTo(0, -halfWidth), close()]];
  }

  if (tip.kind === "to") {
    const notchX = tip.length * 0.24;
    return [[moveTo(0, halfWidth), lineTo(tip.length, 0), lineTo(0, -halfWidth), lineTo(notchX, 0), close()]];
  }

  return [[moveTo(0, halfWidth), lineTo(tip.length, 0), lineTo(0, -halfWidth), lineTo(tip.length * 0.24, 0), close()]];
}

function transformPath(path: ScenePathCommand[], map: (x: number, y: number) => { x: number; y: number }): ScenePathCommand[] {
  return path.map((command) => {
    if (command.kind === "Z") {
      return { kind: "Z" };
    }
    if (command.kind === "M" || command.kind === "L") {
      const point = map(command.to.x, command.to.y);
      return { kind: command.kind, to: point };
    }
    if (command.kind === "C") {
      const c1 = map(command.c1.x, command.c1.y);
      const c2 = map(command.c2.x, command.c2.y);
      const to = map(command.to.x, command.to.y);
      return { kind: "C", c1, c2, to };
    }
    const to = map(command.to.x, command.to.y);
    return {
      kind: "A",
      rx: command.rx,
      ry: command.ry,
      xAxisRotation: command.xAxisRotation,
      largeArc: command.largeArc,
      sweep: command.sweep,
      to
    };
  });
}

function quadraticAsCubic(start: ScenePathCommand, cx: number, cy: number, x: number, y: number): ScenePathCommand[] {
  if (start.kind !== "M") {
    return [start];
  }
  const p0 = start.to;
  const c1 = {
    x: p0.x + (2 / 3) * (cx - p0.x),
    y: p0.y + (2 / 3) * (cy - p0.y)
  };
  const c2 = {
    x: x + (2 / 3) * (cx - x),
    y: y + (2 / 3) * (cy - y)
  };
  return [start, { kind: "C", c1, c2, to: { x, y } }];
}

function moveTo(x: number, y: number): ScenePathCommand {
  return { kind: "M", to: { x, y } };
}

function lineTo(x: number, y: number): ScenePathCommand {
  return { kind: "L", to: { x, y } };
}

function cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): ScenePathCommand {
  return {
    kind: "C",
    c1: { x: c1x, y: c1y },
    c2: { x: c2x, y: c2y },
    to: { x, y }
  };
}

function close(): ScenePathCommand {
  return { kind: "Z" };
}
