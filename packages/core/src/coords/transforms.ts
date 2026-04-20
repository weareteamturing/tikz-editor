export type FrameTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export type WorldTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export type SvgTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export type AnchorTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

type AnyTransform = FrameTransform | WorldTransform | SvgTransform | AnchorTransform;

export function unsafeTransform<TTransform extends AnyTransform>(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number
): TTransform {
  return { a, b, c, d, e, f } as TTransform;
}
