import { describe, expect, it } from "vitest";

import {
  finalizePrefixWidthTable,
  findNearestPrefixIndexFromTable,
  readPrefixUnitsFromTable,
  scanTeXPrefixState,
  stabilizePrefixForMeasurement
} from "../packages/core/src/text/prefix-width.js";

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
});
