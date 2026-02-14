import { describe, expect, it } from "vitest";

import { normalizeColor } from "../src/semantic/style/colors.js";

describe("color normalization", () => {
  it("supports chained xcolor mixes left-to-right", () => {
    expect(normalizeColor("black!10!white!92!red")).toBe("#e8d3d3");
  });

  it("defaults omitted mix targets to white at each step", () => {
    expect(normalizeColor("black!10!white!92")).toBe("#e8e8e8");
  });

  it("parses chained mixes with whitespace and case differences", () => {
    expect(normalizeColor(" BLACK ! 10 ! WHITE ! 92 ! RED ")).toBe("#e8d3d3");
  });

  it("falls back to the raw value for unsupported mix colors", () => {
    expect(normalizeColor("black!10!chartreuse!92!red")).toBe("black!10!chartreuse!92!red");
  });
});
