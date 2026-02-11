import type { Span } from "../ast/types.js";

export type Point = {
  x: number;
  y: number;
};

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
  style: ResolvedStyle;
  commands: ScenePathCommand[];
};

export type SceneCircle = {
  kind: "Circle";
  id: string;
  sourceId: string;
  sourceSpan: Span;
  style: ResolvedStyle;
  center: Point;
  radius: number;
};

export type SceneEllipse = {
  kind: "Ellipse";
  id: string;
  sourceId: string;
  sourceSpan: Span;
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
  style: ResolvedStyle;
  position: Point;
  text: string;
};

export type ResolvedStyle = {
  stroke: string | null;
  fill: string | null;
  textColor: string | null;
  textOpacity: number;
  fontSize: number;
  fontStyle: "normal" | "italic";
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
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
  markerStart: string | null;
  markerEnd: string | null;
  opacity: number;
  strokeOpacity: number;
  fillOpacity: number;
};

export type FeatureUsageState = "unused" | "used-supported" | "used-unsupported";

export type FeatureUsage = Record<string, FeatureUsageState>;

export type EvaluateOptions = {
  defaultLengthUnit?: "cm" | "pt";
};
