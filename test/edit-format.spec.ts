import { describe, expect, it } from "vitest";

import { formatNumber } from "../packages/core/src/edit/format.js";

describe("formatNumber", () => {
  it("defaults to compact two-decimal formatting", () => {
    expect(formatNumber(12.345)).toBe("12.35");
    expect(formatNumber(12.3)).toBe("12.3");
    expect(formatNumber(-0.004)).toBe("0");
  });

  it("supports interaction-specific fractional precision", () => {
    expect(formatNumber(90.8, { fractionDigits: 0 })).toBe("91");
    expect(formatNumber(120.2, { fractionDigits: 0 })).toBe("120");
    expect(formatNumber(-0.1, { fractionDigits: 0 })).toBe("0");
  });
});
