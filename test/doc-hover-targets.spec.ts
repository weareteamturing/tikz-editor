import { describe, expect, it } from "vitest";

import { parseSyntax } from "../packages/core/src/syntax/parse.js";
import { resolveDocHoverTarget } from "../packages/core/src/completion/doc-hover.js";

function resolveAt(sourceWithCursor: string) {
  const marker = "<|>";
  const pos = sourceWithCursor.indexOf(marker);
  if (pos < 0) {
    throw new Error("Missing <|> cursor marker");
  }
  const source = sourceWithCursor.slice(0, pos) + sourceWithCursor.slice(pos + marker.length);
  const tree = parseSyntax(source);
  return resolveDocHoverTarget({ source, tree, pos });
}

describe("resolveDocHoverTarget", () => {
  it("resolves option keys using parser-derived key spans", () => {
    const target = resolveAt(String.raw`\draw[line wi<|>dth=2pt, red] (0,0) -- (1,1);`);
    expect(target).not.toBeNull();
    expect(target?.kind).toBe("option-key");
    expect(target?.query).toBe("line width");
    expect(target?.candidates[0]).toBe("line width");
    expect(target?.candidates).toContain("/tikz/line width");
  });

  it("resolves option values back to their option key", () => {
    const target = resolveAt(String.raw`\draw[line width=2<|>pt] (0,0) -- (1,1);`);
    expect(target).not.toBeNull();
    expect(target?.kind).toBe("option-value");
    expect(target?.query).toBe("line width");
  });

  it("resolves supported commands", () => {
    const target = resolveAt(String.raw`\dr<|>aw (0,0) -- (1,1);`);
    expect(target).not.toBeNull();
    expect(target?.kind).toBe("command");
    expect(target?.query).toBe(String.raw`\draw`);
  });

  it("resolves supported operators", () => {
    const target = resolveAt(String.raw`\draw (0,0) -<|>| (1,1);`);
    expect(target).not.toBeNull();
    expect(target?.kind).toBe("operator");
    expect(target?.query).toBe("-|");
  });

  it("resolves supported keywords", () => {
    const target = resolveAt(String.raw`\draw (0,0) t<|>o (1,1);`);
    expect(target).not.toBeNull();
    expect(target?.kind).toBe("keyword");
    expect(target?.query).toBe("to");
    expect(target?.candidates).toContain("/tikz/to");
  });

  it("returns null in comments", () => {
    const target = resolveAt(String.raw`% \draw[line wi<|>dth=2pt]`);
    expect(target).toBeNull();
  });
});
