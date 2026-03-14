import { afterEach, describe, expect, it, vi } from "vitest";
import { parser } from "../packages/core/src/syntax/grammar/tikz-parser.js";
import * as sourceColorDetection from "../packages/app/src/source-color-detection.js";
import {
  collectProjectNamedColorSwatches,
  resolveProjectNamedColorSwatches
} from "../packages/app/src/project-named-colors.js";

const SOURCE = String.raw`\begin{tikzpicture}
\definecolor{myred}{RGB}{255,0,0}
\colorlet{accent}{myred}
\draw[draw=accent] (0,0) -- (1,1);
\end{tikzpicture}`;

const TREE = parser.parse(SOURCE);

describe("project named colors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the previous swatch computation for identical source", () => {
    const spy = vi.spyOn(sourceColorDetection, "resolveDeclaredColors");

    const first = resolveProjectNamedColorSwatches(SOURCE, TREE);
    const second = resolveProjectNamedColorSwatches(SOURCE, TREE);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    // resolveDeclaredColors may be called once (cached internally) or not at all
    // on the second call since resolveProjectNamedColorSwatches caches by source
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("still exposes the uncached collector for direct use", () => {
    const declaredColors = sourceColorDetection.collectDeclaredColors(SOURCE, TREE);
    const swatches = collectProjectNamedColorSwatches(declaredColors);
    expect(swatches.some((swatch) => swatch.token === "myred")).toBe(true);
  });
});
