import type { WorldPoint } from "../../coords/points.js";
import type { FeatureId } from "../../capabilities/feature-ids.js";

export type FeatureMarkFn = (featureId: FeatureId, status: "supported" | "unsupported") => void;
export type DiagnosticPushFn = (code: string, message: string, spanFrom: number, spanTo: number) => void;
export type ArcParameters = { startAngle: number; endAngle: number; rx: number; ry: number };
export type PlacementSegment =
  | { kind: "line"; from: WorldPoint; to: WorldPoint }
  | { kind: "hv"; operator: "-|" | "|-"; from: WorldPoint; bend: WorldPoint; to: WorldPoint }
  | { kind: "cubic"; from: WorldPoint; c1: WorldPoint; c2: WorldPoint; to: WorldPoint }
  | { kind: "arc"; from: WorldPoint; to: WorldPoint; params: ArcParameters };
