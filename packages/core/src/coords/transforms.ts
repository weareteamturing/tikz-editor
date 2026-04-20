type AffineTransform = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}>;

export type FrameTransform = AffineTransform;
export type WorldToFrameTransform = AffineTransform;
export type WorldTransform = AffineTransform;
export type SvgTransform = AffineTransform;
export type AnchorTransform = AffineTransform;

function createTransform<TTransform>(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number
): TTransform {
  return { a, b, c, d, e, f } as TTransform;
}

export function frameTransform(a: number, b: number, c: number, d: number, e: number, f: number): FrameTransform {
  return createTransform<FrameTransform>(a, b, c, d, e, f);
}

export function worldToFrameTransform(a: number, b: number, c: number, d: number, e: number, f: number): WorldToFrameTransform {
  return createTransform<WorldToFrameTransform>(a, b, c, d, e, f);
}

export function worldTransform(a: number, b: number, c: number, d: number, e: number, f: number): WorldTransform {
  return createTransform<WorldTransform>(a, b, c, d, e, f);
}

export function svgTransform(a: number, b: number, c: number, d: number, e: number, f: number): SvgTransform {
  return createTransform<SvgTransform>(a, b, c, d, e, f);
}

export function anchorTransform(a: number, b: number, c: number, d: number, e: number, f: number): AnchorTransform {
  return createTransform<AnchorTransform>(a, b, c, d, e, f);
}
