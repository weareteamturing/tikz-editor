import { describe, expect, it } from "vitest";
import { collectProjectNamedColorSwatches } from "../../packages/app/src/project-named-colors";

describe("project named colors", () => {
  it("collects \\colorlet and \\definecolor in declaration order", () => {
    const source = `
\\colorlet{accent}{blue}
\\definecolor{brand}{rgb}{1,0.5,0}
\\colorlet{highlight}{blue!50}
`;

    expect(collectProjectNamedColorSwatches(source)).toEqual([
      { token: "accent", cssColor: "#0000ff" },
      { token: "brand", cssColor: "#ff8000" },
      { token: "highlight", cssColor: "#8080ff" }
    ]);
  });

  it("filters collisions with basic colors and keeps the latest value for duplicate custom names", () => {
    const source = `
\\definecolor{red}{HTML}{010203}
\\definecolor{custom}{HTML}{010203}
\\colorlet{custom}{green}
`;

    expect(collectProjectNamedColorSwatches(source)).toEqual([
      { token: "custom", cssColor: "#00ff00" }
    ]);
  });

  it("omits unresolved or malformed declarations", () => {
    const source = `
\\definecolor{broken}{rgb}{oops}
\\colorlet{missing}{unknown}
\\definecolor{ok}{HTML}{112233}
`;

    expect(collectProjectNamedColorSwatches(source)).toEqual([
      { token: "ok", cssColor: "#112233" }
    ]);
  });
});
