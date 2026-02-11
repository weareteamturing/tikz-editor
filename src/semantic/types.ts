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
  lineWidth: number;
  markerStart: string | null;
  markerEnd: string | null;
  opacity: number;
};

export type FeatureUsageState = "unused" | "used-supported" | "used-unsupported";

export type FeatureUsage = Record<string, FeatureUsageState>;

export type EvaluateOptions = {
  defaultLengthUnit?: "cm" | "pt";
};
