import { describe, expect, it } from "vitest";

import { parseOptionListRaw, splitTopLevel } from "../src/options/parse.js";

describe("options parser", () => {
  it("splits top-level commas while preserving nested structures", () => {
    const raw = "a={1,2}, b=(3,4), c=[x=1,y=2], d";
    const parts = splitTopLevel(raw, ",").map((part) => part.trim());

    expect(parts).toEqual(["a={1,2}", "b=(3,4)", "c=[x=1,y=2]", "d"]);
  });

  it("parses kv and flag options with spans", () => {
    const parsed = parseOptionListRaw("[thick, red, line width=2pt, fill=blue]", 10);

    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.key === "thick")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.key === "red")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "kv" && entry.key === "line width")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "kv" && entry.key === "fill")).toBe(true);
    expect(parsed.entries.every((entry) => entry.span.from >= 10)).toBe(true);
  });

  it("keeps unknown tokens", () => {
    const parsed = parseOptionListRaw("[foo={a,b}, ???]");

    expect(parsed.entries.some((entry) => entry.kind === "unknown")).toBe(true);
  });
});

