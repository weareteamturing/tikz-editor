export type SourceCmPoint = {
  x: number;
  y: number;
};

export type FrameLocalPoint = {
  x: number;
  y: number;
};

export type WorldPoint = {
  x: number;
  y: number;
};

export type AnchorLocalPoint = {
  x: number;
  y: number;
};

export type ArrowLocalPoint = {
  x: number;
  y: number;
};

export type SvgPoint = {
  x: number;
  y: number;
};

export type ViewportPoint = {
  x: number;
  y: number;
};

export type ClientPoint = {
  x: number;
  y: number;
};

export type TextRectLocalPoint = {
  x: number;
  y: number;
};

export type TextareaLocalPoint = {
  x: number;
  y: number;
};

export type WorldBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type SvgBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type ViewportBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type ClientBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type AnyPoint =
  | SourceCmPoint
  | FrameLocalPoint
  | WorldPoint
  | AnchorLocalPoint
  | ArrowLocalPoint
  | SvgPoint
  | ViewportPoint
  | ClientPoint
  | TextRectLocalPoint
  | TextareaLocalPoint;

type AnyBounds = WorldBounds | SvgBounds | ViewportBounds | ClientBounds;

export function unsafePoint<TPoint extends AnyPoint>(x: number, y: number): TPoint {
  return { x, y } as TPoint;
}

export function unsafeBounds<TBounds extends AnyBounds>(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): TBounds {
  return { minX, minY, maxX, maxY } as TBounds;
}
