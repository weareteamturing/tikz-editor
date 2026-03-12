import { describe, expect, it } from "vitest";

import { deriveSingleSourcePatch } from "../packages/app/src/store/source-patch-diff.js";

describe("deriveSingleSourcePatch", () => {
  it("returns an empty patch list when the source is unchanged", () => {
    expect(deriveSingleSourcePatch("abc", "abc")).toEqual([]);
  });

  it("returns a single contiguous patch for numeric scrubs", () => {
    const previous = String.raw`\draw (0,0) -- (1.0,0);`;
    const next = String.raw`\draw (0,0) -- (1.25,0);`;
    const patches = deriveSingleSourcePatch(
      previous,
      next
    );

    expect(patches).not.toBeNull();
    expect(patches).toHaveLength(1);
    expect(patches?.[0]?.replacement.length).toBeGreaterThan(0);
    expect(applyPatch(previous, patches ?? [])).toBe(next);
  });

  it("returns null when the edit appears to span multiple disjoint hunks", () => {
    const patches = deriveSingleSourcePatch("ab12cd34ef", "abXXcdYYef");

    expect(patches).toBeNull();
  });
});

function applyPatch(source: string, patches: ReadonlyArray<{
  oldSpan: { from: number; to: number };
  replacement: string;
}>): string {
  let cursor = 0;
  let output = "";
  for (const patch of patches) {
    output += source.slice(cursor, patch.oldSpan.from);
    output += patch.replacement;
    cursor = patch.oldSpan.to;
  }
  output += source.slice(cursor);
  return output;
}
