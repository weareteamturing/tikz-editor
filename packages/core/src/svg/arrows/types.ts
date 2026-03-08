import type { ArrowTip, Point, ScenePath, ScenePathCommand } from "../../semantic/types.js";

export type { Frame } from "../../geometry/path-sampler.js";

export type ArrowSide = "start" | "end";

export type NormalizedArrowTip = ArrowTip & {
  length: number;
  width: number;
  sep: number;
  lineWidth: number;
  afterLineEnd: boolean;
};

export type ArrowTipMetrics = {
  tipEnd: number;
  backEnd: number;
  lineEnd: number;
  visualTipEnd: number;
  visualBackEnd: number;
  sep: number;
};

export type ArrowTipPlan = {
  side: ArrowSide;
  index: number;
  tip: NormalizedArrowTip;
  metrics: ArrowTipMetrics;
  offset: number;
  bend: boolean;
};

export type ArrowShorteningResult = {
  lineEndShortening: number;
  totalLength: number;
  plans: ArrowTipPlan[];
};

export type RenderedArrowTipPath = {
  commands: ScenePathCommand[];
  side: ArrowSide;
  index: number;
  bend: boolean;
  tipKind: ArrowTip["kind"];
  stroke: string;
  fill: string;
  strokeWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
};

export type RenderedArrowPath = {
  shaftCommands: ScenePathCommand[];
  tipPaths: RenderedArrowTipPath[];
};

export type ArrowRenderInput = {
  path: ScenePath;
};
