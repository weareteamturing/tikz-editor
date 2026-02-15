import type { Span } from "../ast/types.js";
import type { OptionListAst } from "../options/types.js";
import type { NodeTextEngine, NodeTextRenderInfo } from "../text/types.js";
import type { MacroOriginFrame } from "../macros/index.js";

export const SHADOW_INHERIT_STROKE = "__tikz-shadow-inherit-stroke__";
export const SHADOW_INHERIT_FILL = "__tikz-shadow-inherit-fill__";

export type Point = {
  x: number;
  y: number;
};

export type ArrowTipKind = "to" | "cm-rightarrow" | "stealth" | "latex" | "triangle" | "bar" | "hooks" | "implies";

export type ArrowTip = {
  kind: ArrowTipKind;
  open: boolean;
  round: boolean;
  color: string | null;
  fill: string | null;
  length: number;
  width: number;
  lineWidth: number | null;
};

export type ArrowMarker = {
  tips: ArrowTip[];
};

export type TipsMode = "true" | "proper" | "on draw" | "on proper draw" | "never";

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type Matrix2D = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export type SceneFigure = {
  kind: "SceneFigure";
  span: Span;
  elements: SceneElement[];
  bounds?: Bounds;
};

export type SceneElement = ScenePath | SceneCircle | SceneEllipse | SceneText;

export type ScenePathCommand =
  | { kind: "M"; to: Point }
  | { kind: "L"; to: Point }
  | { kind: "C"; c1: Point; c2: Point; to: Point }
  | { kind: "A"; rx: number; ry: number; xAxisRotation: number; largeArc: boolean; sweep: boolean; to: Point }
  | { kind: "Z" };

export type ScenePath = {
  kind: "Path";
  id: string;
  sourceId: string;
  sourceSpan: Span;
  origin?: SceneElementOrigin;
  style: ResolvedStyle;
  commands: ScenePathCommand[];
};

export type SceneCircle = {
  kind: "Circle";
  id: string;
  sourceId: string;
  sourceSpan: Span;
  origin?: SceneElementOrigin;
  style: ResolvedStyle;
  center: Point;
  radius: number;
};

export type SceneEllipse = {
  kind: "Ellipse";
  id: string;
  sourceId: string;
  sourceSpan: Span;
  origin?: SceneElementOrigin;
  style: ResolvedStyle;
  center: Point;
  rx: number;
  ry: number;
  rotation?: number;
};

export type SceneText = {
  kind: "Text";
  id: string;
  sourceId: string;
  sourceSpan: Span;
  origin?: SceneElementOrigin;
  style: ResolvedStyle;
  position: Point;
  text: string;
  textBlockWidth?: number;
  textBlockHeight?: number;
  textRenderInfo?: NodeTextRenderInfo;
};

export type ForeachOriginFrame = {
  loopId: string;
  loopSpan: Span;
  iterationIndex: number;
  bindings: Record<string, string>;
};

export type SceneElementOrigin = {
  foreachStack: ForeachOriginFrame[];
  macroStack?: MacroOriginFrame[];
};

export type ShadowFadeKind = "none" | "circle-fuzzy-edge-15";

export type ShadowPaintStyle = {
  stroke: string | null;
  fill: string | null;
  fillRule: "nonzero" | "evenodd";
  doubleStroke: boolean;
  doubleDistance: number;
  lineWidth: number;
  dashArray: number[] | null;
  dashOffset: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
  opacity: number;
  strokeOpacity: number;
  fillOpacity: number;
  shadeEnabled: boolean;
  shading: string;
  shadingAngle: number;
  axisTopColor: string;
  axisMiddleColor: string;
  axisBottomColor: string;
  radialInnerColor: string;
  radialOuterColor: string;
  ballColor: string;
  bilinearLowerLeft: string;
  bilinearLowerRight: string;
  bilinearUpperLeft: string;
  bilinearUpperRight: string;
};

export type ShadowLayer = {
  scale: number;
  xshift: number;
  yshift: number;
  fade: ShadowFadeKind;
  style: ShadowPaintStyle;
};

export type ResolvedStyle = {
  stroke: string | null;
  fill: string | null;
  fillRule: "nonzero" | "evenodd";
  textColor: string | null;
  textOpacity: number;
  fontSize: number;
  fontStyle: "normal" | "italic";
  fontWeight: "normal" | "bold";
  fontFamily: "serif" | "sans" | "monospace";
  doubleStroke: boolean;
  doubleDistance: number;
  textAlign: "left" | "flush left" | "right" | "flush right" | "center" | "flush center" | "justify" | "none";
  // Whether draw mode was explicitly enabled via options (for example `draw`).
  drawExplicit: boolean;
  radius: number | null;
  xRadius: number | null;
  yRadius: number | null;
  roundedCorners: number | null;
  lineWidth: number;
  dashArray: number[] | null;
  dashOffset: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
  markerStart: ArrowMarker | null;
  markerEnd: ArrowMarker | null;
  arrowShorthandStart: ArrowMarker;
  arrowShorthandEnd: ArrowMarker;
  tipsMode: TipsMode;
  opacity: number;
  strokeOpacity: number;
  fillOpacity: number;
  shadeEnabled: boolean;
  shading: string;
  shadingAngle: number;
  axisTopColor: string;
  axisMiddleColor: string;
  axisBottomColor: string;
  radialInnerColor: string;
  radialOuterColor: string;
  ballColor: string;
  bilinearLowerLeft: string;
  bilinearLowerRight: string;
  bilinearUpperLeft: string;
  bilinearUpperRight: string;
  shadowScale: number;
  shadowXShift: number;
  shadowYShift: number;
  shadowFade: ShadowFadeKind;
  everyShadowStyles: OptionListAst[];
  shadowLayers: ShadowLayer[];
};

export type FeatureUsageState = "unused" | "used-supported" | "used-unsupported";

export type FeatureUsage = Record<string, FeatureUsageState>;

export type EvaluateOptions = {
  defaultLengthUnit?: "cm" | "pt";
  maxForeachExpansions?: number;
  textEngine?: NodeTextEngine | null;
};
