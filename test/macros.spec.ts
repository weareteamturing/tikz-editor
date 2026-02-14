import { describe, expect, it } from "vitest";

import {
  DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
  expandMacroBindings,
  type MacroBinding,
  type MacroExpansionTraceEvent,
  type MacroOriginFrame
} from "../src/macros/index.js";

function makeOrigin(
  macroName: string,
  definitionId: string,
  commandRaw: MacroOriginFrame["commandRaw"] = "\\newcommand"
): MacroOriginFrame {
  return {
    macroName,
    definitionId,
    definitionSpan: { from: 0, to: 1 },
    commandRaw
  };
}

function textBinding(
  value: string,
  macroName: string,
  definitionId: string,
  commandRaw: MacroOriginFrame["commandRaw"] = "\\def"
): MacroBinding {
  return {
    kind: "text",
    value,
    provenance: [makeOrigin(macroName, definitionId, commandRaw)]
  };
}

function callableBinding(body: string, parameterCount: number, macroName: string, definitionId: string): MacroBinding {
  return {
    kind: "callable",
    body,
    parameterCount,
    provenance: [makeOrigin(macroName, definitionId, "\\newcommand")]
  };
}

describe("macro expansion", () => {
  it("expands fixed-arity macros with braced arguments", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\pair", callableBinding("#1/#2", 2, "\\pair", "macro:pair")]
    ]);

    const expanded = expandMacroBindings(String.raw`\pair{A}{B}`, bindings);
    expect(expanded).toBe("A/B");
  });

  it("accepts single-token arguments for fixed-arity macros", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\pair", callableBinding("#1/#2", 2, "\\pair", "macro:pair")]
    ]);

    const expanded = expandMacroBindings(String.raw`\pair A B`, bindings);
    expect(expanded).toBe("A/B");
  });

  it("preserves TeX control sequence boundaries around replacements", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\x", textBinding("abc", "\\x", "macro:x")]
    ]);

    const expanded = expandMacroBindings(String.raw`\mathstrut\x`, bindings);
    expect(expanded).toBe(String.raw`\mathstrut{}abc`);
  });

  it("captures provenance in expansion trace events", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\pair", callableBinding("#1/#2", 2, "\\pair", "macro:pair")]
    ]);
    const trace: MacroExpansionTraceEvent[] = [];

    const expanded = expandMacroBindings(String.raw`\pair{A}{B}`, bindings, { trace });
    expect(expanded).toBe("A/B");
    expect(trace.length).toBeGreaterThan(0);
    expect(trace[0]?.macroName).toBe("\\pair");
    expect(trace[0]?.provenance[0]?.definitionId).toBe("macro:pair");
  });

  it("enforces the default recursion depth limit of 100 expansions", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\loop", textBinding(String.raw`\loop x`, "\\loop", "macro:loop")]
    ]);

    const expanded = expandMacroBindings(String.raw`\loop`, bindings);
    const growthCount = (expanded.match(/ x/g) ?? []).length;

    expect(growthCount).toBe(DEFAULT_MACRO_EXPANSION_MAX_DEPTH);
    expect(expanded.startsWith(String.raw`\loop`)).toBe(true);
  });

  it("supports optional first arguments with defaults", () => {
    const bindings = new Map<string, MacroBinding>([
      [
        "\\pair",
        {
          kind: "callable",
          body: "#1/#2",
          parameterCount: 2,
          optionalFirstArgDefault: "left",
          provenance: [makeOrigin("\\pair", "macro:pair", "\\newcommand")]
        }
      ]
    ]);

    const defaulted = expandMacroBindings(String.raw`\pair{R}`, bindings);
    const explicit = expandMacroBindings(String.raw`\pair[right]{R}`, bindings);
    expect(defaulted).toBe("left/R");
    expect(explicit).toBe("right/R");
  });
});
