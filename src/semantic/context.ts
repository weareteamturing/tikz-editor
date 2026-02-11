import type { Point, Matrix2D, ResolvedStyle } from "./types.js";

export type SemanticContextFrame = {
  style: ResolvedStyle;
  transform: Matrix2D;
};

export type SemanticContext = {
  stack: SemanticContextFrame[];
  namedCoordinates: Map<string, Point>;
  currentPoint: Point | null;
  pathStartPoint: Point | null;
};

export function createSemanticContext(initialStyle: ResolvedStyle, initialTransform: Matrix2D): SemanticContext {
  return {
    stack: [{ style: initialStyle, transform: initialTransform }],
    namedCoordinates: new Map<string, Point>(),
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

