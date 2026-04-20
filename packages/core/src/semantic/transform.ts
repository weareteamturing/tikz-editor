import type { WorldTransform } from "../coords/transforms.js";
import type { WorldPoint } from "../coords/points.js";

export function identityMatrix(): WorldTransform {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function multiplyMatrix(left: WorldTransform, right: WorldTransform): WorldTransform {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f
  };
}

export function applyMatrix(matrix: WorldTransform, point: WorldPoint): WorldPoint {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f
  };
}

export function applyMatrixToVector(matrix: Pick<WorldTransform, "a" | "b" | "c" | "d">, point: WorldPoint): WorldPoint {
  return {
    x: matrix.a * point.x + matrix.c * point.y,
    y: matrix.b * point.x + matrix.d * point.y
  };
}

export function translationMatrix(tx: number, ty: number): WorldTransform {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

export function scaleMatrix(sx: number, sy: number): WorldTransform {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

export function rotationMatrix(degrees: number): WorldTransform {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function inverseMatrix(matrix: WorldTransform): WorldTransform | null {
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-12) {
    return null;
  }
  return {
    a: matrix.d / det,
    b: -matrix.b / det,
    c: -matrix.c / det,
    d: matrix.a / det,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / det,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / det
  };
}
