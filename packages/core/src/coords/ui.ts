import type { Px } from "./scalars.js";
import { pt } from "./scalars.js";

export function pxToPt(value: Px, zoom: number): ReturnType<typeof pt> {
  return pt((value as number) / Math.max(zoom, 1e-6));
}
