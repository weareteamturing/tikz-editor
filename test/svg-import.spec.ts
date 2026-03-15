import { afterEach, describe, expect, it, vi } from "vitest";
import { convertKeynoteClipboardToScopeSnippet } from "../packages/app/src/ui/svg-import.js";

const toTikzFromClipboardMock = vi.hoisted(() => vi.fn<(input: string) => { tikz: string }>());

vi.mock("keynote-clipboard", () => ({
  toTikzFromClipboard: toTikzFromClipboardMock
}));

vi.mock("svg2tikz", () => ({
  svgToTikz: vi.fn<(source: string) => string>()
}));

describe("svg-import keynote helper", () => {
  afterEach(() => {
    toTikzFromClipboardMock.mockReset();
  });

  it("converts keynote clipboard payload to scope snippet", async () => {
    const tikz = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}`;
    toTikzFromClipboardMock.mockReturnValue({ tikz });

    const converted = await convertKeynoteClipboardToScopeSnippet("{\"dummy\":true}");

    expect(converted.kind).toBe("success");
    if (converted.kind !== "success") {
      return;
    }
    expect(converted.tikzSource).toBe(tikz);
    expect(converted.body).toBe("\\draw (0,0) -- (1,1);");
    expect(converted.snippet).toContain("\\begin{scope}");
    expect(converted.snippet).toContain("\\draw (0,0) -- (1,1);");
    expect(converted.snippet).toContain("\\end{scope}");
  });

  it("surfaces keynote conversion errors with a keynote prefix", async () => {
    toTikzFromClipboardMock.mockImplementation(() => {
      throw new Error("bad keynote payload");
    });

    const converted = await convertKeynoteClipboardToScopeSnippet("not json");

    expect(converted).toEqual({
      kind: "failure",
      message: "Keynote import failed: bad keynote payload"
    });
  });
});
