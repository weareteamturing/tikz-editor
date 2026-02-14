import type { FeatureId } from "../../capabilities/feature-ids.js";
import type { Point } from "../types.js";

export type FeatureMarkFn = (featureId: FeatureId, status: "supported" | "unsupported") => void;
export type DiagnosticPushFn = (code: string, message: string, spanFrom: number, spanTo: number) => void;
export type ArcParameters = { startAngle: number; endAngle: number; rx: number; ry: number };
export type PlacementSegment =
  | { kind: "line"; from: Point; to: Point }
  | { kind: "hv"; operator: "-|" | "|-"; from: Point; bend: Point; to: Point }
  | { kind: "cubic"; from: Point; c1: Point; c2: Point; to: Point }
  | { kind: "arc"; from: Point; to: Point; params: ArcParameters };
