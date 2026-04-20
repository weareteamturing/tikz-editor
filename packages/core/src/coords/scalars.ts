type Brand<T, B extends string> = T & { readonly __brand: B };

export type Pt = Brand<number, "Pt">;
export type Cm = Brand<number, "Cm">;
export type Px = Brand<number, "Px">;
export type Deg = Brand<number, "Deg">;

export function pt(value: number): Pt {
  return value as Pt;
}

export function cm(value: number): Cm {
  return value as Cm;
}

export function px(value: number): Px {
  return value as Px;
}

export function deg(value: number): Deg {
  return value as Deg;
}

export function scalarValue(value: Pt | Cm | Px | Deg): number {
  return value as number;
}

export type CoordinateBrand<T extends string> = Brand<number, T>;
