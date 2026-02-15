import { describe, expect, it } from "vitest";

import { normalizeColor } from "../src/semantic/style/colors.js";
import { COLOR_HEX, NAMED_COLORS } from "../src/semantic/style/constants.js";

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

  it("matches xcolor always-available named-color set exactly", () => {
    const expected = [
      "black",
      "darkgray",
      "gray",
      "lightgray",
      "white",
      "red",
      "green",
      "blue",
      "cyan",
      "magenta",
      "yellow",
      "lime",
      "olive",
      "orange",
      "pink",
      "teal",
      "violet",
      "purple",
      "brown"
    ];

    expect(Array.from(NAMED_COLORS).sort()).toEqual([...expected].sort());
    expect(Object.keys(COLOR_HEX).sort()).toEqual([...expected].sort());
  });

  it("uses xcolor always-available named-color RGB definitions", () => {
    expect(COLOR_HEX.black).toBe("#000000");
    expect(COLOR_HEX.darkgray).toBe("#404040");
    expect(COLOR_HEX.gray).toBe("#808080");
    expect(COLOR_HEX.lightgray).toBe("#bfbfbf");
    expect(COLOR_HEX.white).toBe("#ffffff");
    expect(COLOR_HEX.red).toBe("#ff0000");
    expect(COLOR_HEX.green).toBe("#00ff00");
    expect(COLOR_HEX.blue).toBe("#0000ff");
    expect(COLOR_HEX.cyan).toBe("#00ffff");
    expect(COLOR_HEX.magenta).toBe("#ff00ff");
    expect(COLOR_HEX.yellow).toBe("#ffff00");
    expect(COLOR_HEX.lime).toBe("#bfff00");
    expect(COLOR_HEX.olive).toBe("#808000");
    expect(COLOR_HEX.orange).toBe("#ff8000");
    expect(COLOR_HEX.pink).toBe("#ffbfbf");
    expect(COLOR_HEX.teal).toBe("#008080");
    expect(COLOR_HEX.violet).toBe("#800080");
    expect(COLOR_HEX.purple).toBe("#bf0040");
    expect(COLOR_HEX.brown).toBe("#bf8040");
  });
});
