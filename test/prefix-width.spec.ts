import { describe, expect, it } from "vitest";

import {
  finalizePrefixWidthTable,
  extendTeXControlWordPrefixEnd,
  findNearestPrefixIndexFromTable,
  readPrefixUnitsFromTable,
  scanTeXPrefixState,
  stabilizePrefixForMeasurement
} from "../packages/core/src/text/prefix-width.js";
import {
  finalizePrefixWidthTable as finalizeMathPrefixWidthTable,
  stabilizePrefixForMeasurement as stabilizeMathPrefixForMeasurement
} from "../packages/core/src/text/knuth-plass/editor/mathPrefix.js";

describe("prefix width helpers", () => {
  it("tracks \\[ ... \\] as math mode and stabilizes by closing \\]", () => {
    const open = scanTeXPrefixState("Cost: \\[x+1");
    expect(open.inMath).toBe(true);
    expect(open.mathMode).toBe("bracket");

    const stabilized = stabilizePrefixForMeasurement("Cost: \\[x+1");
    expect(stabilized.endsWith("\\]")).toBe(true);
  });

  it("tracks $$ ... $$ as math mode and stabilizes with $$", () => {
    const open = scanTeXPrefixState("Cost: $$x+1");
    expect(open.inMath).toBe(true);
    expect(open.mathMode).toBe("dollar-double");

    const stabilized = stabilizePrefixForMeasurement("Cost: $$x+1");
    expect(stabilized.endsWith("$$")).toBe(true);
  });

  it("interpolates unknown measurements and preserves monotonic order", () => {
    const table = [0, 90, Number.NaN, Number.NaN, 210, Number.NaN, 320];
    const finalized = finalizePrefixWidthTable(table, 320);

    expect(finalized[2]).toBe(130);
    expect(finalized[3]).toBe(170);
    expect(finalized[5]).toBe(265);
    for (let index = 1; index < finalized.length; index += 1) {
      expect(finalized[index]).toBeGreaterThanOrEqual(finalized[index - 1] ?? 0);
    }
  });

  it("falls back to proportional mapping when no table is present", () => {
    expect(readPrefixUnitsFromTable(3, 6, 120, null)).toBe(60);
    expect(findNearestPrefixIndexFromTable(55, 6, 120, null)).toBe(3);
  });

  it("uses nearest measured prefix when a table is provided", () => {
    const table = [0, 10, 22, 35, 50];
    expect(findNearestPrefixIndexFromTable(21, 4, 50, table)).toBe(2);
    expect(findNearestPrefixIndexFromTable(48, 4, 50, table)).toBe(4);
  });

  it("carries the last valid math width forward through invalid prefixes", () => {
    const table = [0, 120, Number.NaN, Number.NaN, 320];
    const finalized = finalizeMathPrefixWidthTable(table, 320);

    expect(finalized[1]).toBe(120);
    expect(finalized[2]).toBe(120);
    expect(finalized[3]).toBe(120);
    expect(finalized[4]).toBe(320);
  });

  it("extends prefixes that end inside a control word to the full command", () => {
    const content = String.raw`A\cap B`;

    expect(extendTeXControlWordPrefixEnd(content, 2)).toBe(5);
    expect(extendTeXControlWordPrefixEnd(content, 3)).toBe(5);
    expect(extendTeXControlWordPrefixEnd(content, 4)).toBe(5);
    expect(extendTeXControlWordPrefixEnd(content, 5)).toBe(5);
    expect(extendTeXControlWordPrefixEnd(content, 6)).toBe(6);
  });

  it("extends fraction prefixes that land inside the command name", () => {
    const content = String.raw`x=\frac{n}{2}`;

    expect(extendTeXControlWordPrefixEnd(content, 3)).toBe(7);
    expect(extendTeXControlWordPrefixEnd(content, 4)).toBe(7);
    expect(extendTeXControlWordPrefixEnd(content, 5)).toBe(7);
    expect(extendTeXControlWordPrefixEnd(content, 6)).toBe(7);
    expect(extendTeXControlWordPrefixEnd(content, 7)).toBe(7);
    expect(extendTeXControlWordPrefixEnd(content, 8)).toBe(8);
  });

  it("leaves incomplete fraction math invalid so width can carry forward", () => {
    expect(stabilizeMathPrefixForMeasurement(String.raw`$\frac{n`)).toBe(String.raw`$\frac{n}$`);
  });
});
