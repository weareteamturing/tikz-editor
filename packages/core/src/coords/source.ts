import type { Cm, Pt } from "./scalars.js";
import { cm, pt, scalarValue } from "./scalars.js";

export const PT_PER_CM = pt(28.4527559055);
export const CM_PER_PT = cm(1 / scalarValue(PT_PER_CM));

export function cmToPt(value: Cm | number): Pt {
  return pt(Number(value) * scalarValue(PT_PER_CM));
}

export function ptToCm(value: Pt | number): Cm {
  return cm(Number(value) * scalarValue(CM_PER_PT));
}
