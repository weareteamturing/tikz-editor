declare const coordBrand: unique symbol;

type Point2D<Unit, Space extends string> = Readonly<{
  x: Unit;
  y: Unit;
  [coordBrand]?: `point:${Space}`;
}>;

type Vector2D<Unit, Space extends string> = Readonly<{
  x: Unit;
  y: Unit;
  [coordBrand]?: `vector:${Space}`;
}>;

type Bounds2D<Unit, Space extends string> = Readonly<{
  minX: Unit;
  minY: Unit;
  maxX: Unit;
  maxY: Unit;
  [coordBrand]?: `bounds:${Space}`;
}>;

export type SourceCmPoint = Point2D<number, "source-cm">;
export type FrameLocalPoint = Point2D<number, "frame-local">;
export type WorldPoint = Point2D<number, "world">;
export type AnchorLocalPoint = Point2D<number, "anchor-local">;
export type ArrowLocalPoint = Point2D<number, "arrow-local">;
export type SvgPoint = Point2D<number, "svg">;
export type ViewportPoint = Point2D<number, "viewport">;
export type ClientPoint = Point2D<number, "client">;
export type TextRectLocalPoint = Point2D<number, "text-rect-local">;
export type TextareaLocalPoint = Point2D<number, "textarea-local">;

export type FrameLocalVector = Vector2D<number, "frame-local">;
export type WorldVector = Vector2D<number, "world">;
export type SvgVector = Vector2D<number, "svg">;
export type ViewportVector = Vector2D<number, "viewport">;
export type ClientVector = Vector2D<number, "client">;

export type WorldBounds = Bounds2D<number, "world">;
export type SvgBounds = Bounds2D<number, "svg">;
export type ViewportBounds = Bounds2D<number, "viewport">;
export type ClientBounds = Bounds2D<number, "client">;

function createPoint<TPoint>(x: TPoint extends { x: infer TX } ? TX : never, y: TPoint extends { y: infer TY } ? TY : never): TPoint {
  return { x, y } as TPoint;
}

function createVector<TVector>(
  x: TVector extends { x: infer TX } ? TX : never,
  y: TVector extends { y: infer TY } ? TY : never
): TVector {
  return { x, y } as TVector;
}

function createBounds<TBounds>(
  minX: TBounds extends { minX: infer TX } ? TX : never,
  minY: TBounds extends { minY: infer TY } ? TY : never,
  maxX: TBounds extends { maxX: infer TMaxX } ? TMaxX : never,
  maxY: TBounds extends { maxY: infer TMaxY } ? TMaxY : never
): TBounds {
  return { minX, minY, maxX, maxY } as TBounds;
}

export function sourceCmPoint(x: number, y: number): SourceCmPoint {
  return createPoint<SourceCmPoint>(x, y);
}

export function frameLocalPoint(x: number, y: number): FrameLocalPoint {
  return createPoint<FrameLocalPoint>(x, y);
}

export function worldPoint(x: number, y: number): WorldPoint {
  return createPoint<WorldPoint>(x, y);
}

export function anchorLocalPoint(x: number, y: number): AnchorLocalPoint {
  return createPoint<AnchorLocalPoint>(x, y);
}

export function arrowLocalPoint(x: number, y: number): ArrowLocalPoint {
  return createPoint<ArrowLocalPoint>(x, y);
}

export function svgPoint(x: number, y: number): SvgPoint {
  return createPoint<SvgPoint>(x, y);
}

export function viewportPoint(x: number, y: number): ViewportPoint {
  return createPoint<ViewportPoint>(x, y);
}

export function clientPoint(x: number, y: number): ClientPoint {
  return createPoint<ClientPoint>(x, y);
}

export function textRectLocalPoint(x: number, y: number): TextRectLocalPoint {
  return createPoint<TextRectLocalPoint>(x, y);
}

export function textareaLocalPoint(x: number, y: number): TextareaLocalPoint {
  return createPoint<TextareaLocalPoint>(x, y);
}

export function frameLocalVector(x: number, y: number): FrameLocalVector {
  return createVector<FrameLocalVector>(x, y);
}

export function worldVector(x: number, y: number): WorldVector {
  return createVector<WorldVector>(x, y);
}

export function svgVector(x: number, y: number): SvgVector {
  return createVector<SvgVector>(x, y);
}

export function viewportVector(x: number, y: number): ViewportVector {
  return createVector<ViewportVector>(x, y);
}

export function clientVector(x: number, y: number): ClientVector {
  return createVector<ClientVector>(x, y);
}

export function worldBounds(minX: number, minY: number, maxX: number, maxY: number): WorldBounds {
  return createBounds<WorldBounds>(minX, minY, maxX, maxY);
}

export function svgBounds(minX: number, minY: number, maxX: number, maxY: number): SvgBounds {
  return createBounds<SvgBounds>(minX, minY, maxX, maxY);
}

export function viewportBounds(minX: number, minY: number, maxX: number, maxY: number): ViewportBounds {
  return createBounds<ViewportBounds>(minX, minY, maxX, maxY);
}

export function clientBounds(minX: number, minY: number, maxX: number, maxY: number): ClientBounds {
  return createBounds<ClientBounds>(minX, minY, maxX, maxY);
}
