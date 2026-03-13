import { afterEach, describe, expect, it, vi } from "vitest";
import * as tikzParserModule from "../packages/core/src/syntax/grammar/tikz-parser.js";
import {
  collectProjectNamedColorSwatches,
  resolveProjectNamedColorSwatches
} from "../packages/app/src/project-named-colors.js";

const SOURCE = String.raw`\begin{tikzpicture}
\definecolor{myred}{RGB}{255,0,0}
\colorlet{accent}{myred}
\draw[draw=accent] (0,0) -- (1,1);
\end{tikzpicture}`;

describe("project named colors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the previous swatch computation for identical source", () => {
    const parseSpy = vi.spyOn(tikzParserModule.parser, "parse");

    const first = resolveProjectNamedColorSwatches(SOURCE);
    const second = resolveProjectNamedColorSwatches(SOURCE);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it("still exposes the uncached collector for direct use", () => {
    const swatches = collectProjectNamedColorSwatches(SOURCE);
    expect(swatches.some((swatch) => swatch.token === "myred")).toBe(true);
  });
});
