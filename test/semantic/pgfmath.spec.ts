import { describe, expect, it } from "vitest";

import { evaluatePgfMathExpression } from "../../packages/core/src/semantic/pgfmath/evaluator.js";
import { createPgfRandom } from "../../packages/core/src/semantic/pgfmath/rng.js";
import { evaluateSemantic, elementsOfKind } from "./helpers.js";

function evaluateScalar(input: string, seed = 1): number {
  const result = evaluatePgfMathExpression(input, { rng: createPgfRandom(seed) });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return Number.NaN;
  }
  return result.quantity.value;
}

describe("semantic evaluator / pgfmath", () => {
  it("respects unary and exponent precedence", () => {
    expect(evaluateScalar("-2^2")).toBe(-4);
    expect(evaluateScalar("(-2)^2")).toBe(4);
    expect(evaluateScalar("2^3^2")).toBe(512);
  });

  it("supports comparisons, logical operators, and ternary expressions", () => {
    expect(evaluateScalar("1 < 2 ? 7 : 9")).toBe(7);
    expect(evaluateScalar("(1 > 2) || (3 == 3) ? 5 : 6")).toBe(5);
    expect(evaluateScalar("!0 ? 11 : 12")).toBe(11);
  });

  it("supports scalar math functions and constants", () => {
    expect(evaluateScalar("sin(30)")).toBeCloseTo(0.5, 6);
    expect(evaluateScalar("atan2(1,1)")).toBeCloseTo(45, 6);
    expect(evaluateScalar("sqrt(9) + abs(-2) + ln(e)")).toBeCloseTo(6, 6);
    expect(evaluateScalar("min(4,2,8) + max(1,6,3)")).toBe(8);
    expect(evaluateScalar("Mod(-3,5)")).toBe(2);
  });

  it("supports seeded random functions with deterministic sequences", () => {
    const rng = createPgfRandom(1);
    expect(rng.nextRaw()).toBe(69621);
    expect(rng.nextRaw()).toBe(552116347);
    expect(rng.nextRaw()).toBe(1082396834);

    const randomA = evaluatePgfMathExpression("rnd", { rng: createPgfRandom(1) });
    const randomB = evaluatePgfMathExpression("random(1,10)", { rng: createPgfRandom(1) });
    expect(randomA.ok).toBe(true);
    expect(randomB.ok).toBe(true);
    if (randomA.ok && randomB.ok) {
      expect(randomA.quantity.value).toBeCloseTo(0.69621, 6);
      expect(randomB.quantity.value).toBeGreaterThanOrEqual(1);
      expect(randomB.quantity.value).toBeLessThanOrEqual(10);
    }
  });

  it("reports unsupported syntax for quoted expressions", () => {
    const result = evaluatePgfMathExpression("\"foo\"");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported-syntax");
    }
  });

  it("supports pgfmath standalone commands and seeded foreach evaluation", () => {
    const source = String.raw`\begin{tikzpicture}
  \pgfmathsetseed{7};
  \pgfmathparse{1<2 ? 9 : 4};
  \pgfmathsetmacro{\m}{2+3};
  \node at (0,0) {\pgfmathresult/\m};
  \foreach \x [evaluate=\x as \r using random(1,9)] in {1,2,3}
    \node at (\x,1) {\r};
\end{tikzpicture}`;

    const first = evaluateSemantic(source);
    const second = evaluateSemantic(source);
    const textsFirst = elementsOfKind(first.scene.elements, "Text").map((entry) => entry.text);
    const textsSecond = elementsOfKind(second.scene.elements, "Text").map((entry) => entry.text);

    expect(textsFirst).toContain("9/5");
    expect(textsFirst).toEqual(textsSecond);
    expect(first.diagnostics.some((diagnostic) => (diagnostic.code ?? "").startsWith("invalid-pgfmath"))).toBe(false);
  });
});
