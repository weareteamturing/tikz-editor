import type { OptionListAst } from "../options/types.js";
import type { Point, Matrix2D, ResolvedStyle } from "./types.js";

export type NodeLayerMode = "front" | "behind";

export type NamedNodeGeometry = {
  shape: "rectangle" | "circle" | "ellipse" | "coordinate";
  center: Point;
  anchorHalfWidth: number;
  anchorHalfHeight: number;
  anchorRadius: number;
};

export type SemanticContextFrame = {
  style: ResolvedStyle;
  transform: Matrix2D;
  namePrefix: string;
  nameSuffix: string;
  nodeLayerMode: NodeLayerMode;
  transformShape: boolean;
  everyNodeStyles: OptionListAst[];
  everyRectangleNodeStyles: OptionListAst[];
  everyCircleNodeStyles: OptionListAst[];
};

export type SemanticContext = {
  stack: SemanticContextFrame[];
  namedCoordinates: Map<string, Point>;
  namedNodeGeometries: Map<string, NamedNodeGeometry>;
  currentPoint: Point | null;
  pathStartPoint: Point | null;
};

export function createSemanticContext(initialStyle: ResolvedStyle, initialTransform: Matrix2D): SemanticContext {
  return {
    stack: [
      {
        style: initialStyle,
        transform: initialTransform,
        namePrefix: "",
        nameSuffix: "",
        nodeLayerMode: "front",
        transformShape: false,
        everyNodeStyles: [],
        everyRectangleNodeStyles: [],
        everyCircleNodeStyles: []
      }
    ],
    namedCoordinates: new Map<string, Point>(),
    namedNodeGeometries: new Map<string, NamedNodeGeometry>(),
    currentPoint: null,
    pathStartPoint: null
  };
}

export function currentFrame(context: SemanticContext): SemanticContextFrame {
  return context.stack[context.stack.length - 1];
}

export function pushFrame(context: SemanticContext, frame: SemanticContextFrame): void {
  context.stack.push(frame);
}

export function popFrame(context: SemanticContext): void {
  if (context.stack.length > 1) {
    context.stack.pop();
  }
}
