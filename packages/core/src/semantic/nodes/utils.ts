import type { ArcParameters } from "../path/types.js";
import type { WorldPoint } from "../../coords/points.js";
import { normalizeOptionValue, isWrappedBySingleBracePair } from "../shared/option-value.js";

export { normalizeOptionValue, isWrappedBySingleBracePair };

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function interpolate(from: WorldPoint, to: WorldPoint, t: number): WorldPoint {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t
  };
}

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function arcCenter(from: WorldPoint, params: ArcParameters): WorldPoint {
  const startRadians = toRadians(params.startAngle);
  return {
    x: from.x - params.rx * Math.cos(startRadians),
    y: from.y - params.ry * Math.sin(startRadians)
  };
}
