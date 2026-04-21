import { describe, expect, it } from "vitest";
import {
  generateComplexPathSource,
  generateComplexPathSegmentSource,
  generateComplexPathPrependSource,
  generateElementSource,
  insertElementIntoSource,
  reverseComplexPathSegments
} from "../packages/core/src/edit/element-templates.js";
import { PT_PER_CM } from "../packages/core/src/edit/format.js";
import { wp } from "./coords-helpers.js";

const cm = (value: number) => value * PT_PER_CM;

describe("element templates", () => {
  it("generates a node snippet at a world-space position", () => {
    const snippet = generateElementSource(
      { kind: "node", text: "Hello" },
      wp(cm(1.5), cm(-2))
    );
    expect(snippet).toBe("\\node at (1.5,-2) {Hello};");
  });

  it("preserves TeX braces in node text", () => {
    const snippet = generateElementSource(
      { kind: "node", text: "$\\frac{a}{b}=x$" },
      wp(cm(0), cm(0))
    );
    expect(snippet).toBe("\\node at (0,0) {$\\frac{a}{b}=x$};");
  });

  it("generates a shaped node snippet with explicit dragged minimum dimensions", () => {
    const snippet = generateElementSource(
      {
        kind: "node",
        shape: "diamond",
        text: "",
        minimumWidthPt: cm(3),
        minimumHeightPt: cm(2)
      },
      wp(cm(2), cm(3))
    );
    expect(snippet).toBe("\\node[draw, shape=diamond, minimum width=3cm, minimum height=2cm] at (2,3) {};");
  });

  it("generates a matrix-of-nodes snippet with default labels", () => {
    const snippet = generateElementSource(
      { kind: "matrix", rows: 2, columns: 2 },
      wp(cm(1), cm(2))
    );
    expect(snippet).toBe("\\matrix [matrix of nodes] at (1,2) {\n  A & B \\\\\n  C & D \\\\\n};");
  });

  it("generates matrix labels beyond Z", () => {
    const snippet = generateElementSource(
      { kind: "matrix", rows: 3, columns: 10 },
      wp(cm(0), cm(0))
    );
    expect(snippet).toContain("Y & Z & AA & AB & AC & AD");
  });

  it("omits minimum height when a shaped drag draft only resolves width", () => {
    const snippet = generateElementSource(
      {
        kind: "node",
        shape: "circle",
        text: "",
        minimumWidthPt: cm(3)
      },
      wp(cm(2), cm(3))
    );
    expect(snippet).toBe("\\node[draw, shape=circle, minimum width=3cm] at (2,3) {};");
  });

  it("generates a drag-aware arrow line snippet", () => {
    const snippet = generateElementSource(
      { kind: "line", hasArrow: true, to: wp(cm(3), cm(4)) },
      wp(cm(1), cm(2))
    );
    expect(snippet).toBe("\\draw[->] (1,2) -- (3,4);");
  });

  it("generates a line snippet from named center anchors", () => {
    const snippet = generateElementSource(
      {
        kind: "line",
        fromAnchor: { nodeName: "A", anchor: "center" },
        toAnchor: { nodeName: "B", anchor: "center" },
        to: wp(cm(3), cm(4))
      },
      wp(cm(1), cm(2))
    );
    expect(snippet).toBe("\\draw (A) -- (B);");
  });

  it("generates an arrow snippet with non-center named anchors", () => {
    const snippet = generateElementSource(
      {
        kind: "line",
        hasArrow: true,
        fromAnchor: { nodeName: "A", anchor: "west" },
        toAnchor: { nodeName: "B", anchor: "east" },
        to: wp(cm(3), cm(4))
      },
      wp(cm(1), cm(2))
    );
    expect(snippet).toBe("\\draw[->] (A.west) -- (B.east);");
  });

  it("generates a circle snippet with explicit cm radius", () => {
    const snippet = generateElementSource(
      { kind: "circle", edge: wp(cm(1.5), cm(1)) },
      wp(cm(1), cm(1))
    );
    expect(snippet).toBe("\\draw (1,1) circle (0.5cm);");
  });

  it("generates an ellipse snippet from dragged bounding corners", () => {
    const snippet = generateElementSource(
      { kind: "ellipse", corner: wp(cm(3), cm(5)) },
      wp(cm(1), cm(1))
    );
    expect(snippet).toBe("\\draw (2,3) ellipse [x radius=1cm, y radius=2cm];");
  });

  it("generates a cubic bezier snippet with explicit controls", () => {
    const snippet = generateElementSource(
      {
        kind: "bezier",
        to: wp(cm(4), cm(2)),
        control1: wp(cm(2), cm(3)),
        control2: wp(cm(3), cm(1))
      },
      wp(cm(1), cm(2))
    );
    expect(snippet).toBe("\\draw (1,2) .. controls (2,3) and (3,1) .. (4,2);");
  });

  it("generates a grid snippet from dragged corners", () => {
    const snippet = generateElementSource(
      { kind: "grid", corner: wp(cm(3), cm(5)) },
      wp(cm(1), cm(2))
    );
    expect(snippet).toBe("\\draw (1,2) grid (3,5);");
  });

  it("generates a default-sized grid snippet without a drag corner", () => {
    const snippet = generateElementSource(
      { kind: "grid" },
      wp(cm(1), cm(2))
    );
    expect(snippet).toBe("\\draw (1,2) grid (3.2,3.4);");
  });

  it("generates an open multi-segment complex path snippet", () => {
    const snippet = generateComplexPathSource(
      wp(cm(0), cm(0)),
      [
        { kind: "line", to: wp(cm(1), cm(0)) },
        { kind: "line", to: wp(cm(2), cm(1)) }
      ]
    );
    expect(snippet).toBe("\\draw (0,0) -- (1,0) -- (2,1);");
  });

  it("generates a mixed line/bezier complex path snippet", () => {
    const snippet = generateComplexPathSource(
      wp(cm(0), cm(0)),
      [
        { kind: "line", to: wp(cm(1), cm(0)) },
        {
          kind: "bezier",
          control1: wp(cm(2), cm(1)),
          control2: wp(cm(3), cm(1)),
          to: wp(cm(4), cm(0))
        }
      ]
    );
    expect(snippet).toBe("\\draw (0,0) -- (1,0) .. controls (2,1) and (3,1) .. (4,0);");
  });

  it("generates a complex path snippet with named anchor endpoints", () => {
    const snippet = generateComplexPathSource(
      wp(cm(0), cm(0)),
      [
        { kind: "line", to: wp(cm(1), cm(0)), toAnchor: { nodeName: "B", anchor: "east" } },
        {
          kind: "bezier",
          control1: wp(cm(2), cm(1)),
          control2: wp(cm(3), cm(1)),
          to: wp(cm(4), cm(0)),
          toAnchor: { nodeName: "C", anchor: "north" }
        }
      ],
      { startAnchor: { nodeName: "A", anchor: "west" } }
    );
    expect(snippet).toBe("\\draw (A.west) -- (B.east) .. controls (2,1) and (3,1) .. (C.north);");
  });

  it("generates a closed complex path snippet with cycle", () => {
    const snippet = generateComplexPathSource(
      wp(cm(0), cm(0)),
      [
        { kind: "line", to: wp(cm(1), cm(0)) },
        { kind: "line", to: wp(cm(1), cm(1)) }
      ],
      { closed: true }
    );
    expect(snippet).toBe("\\draw (0,0) -- (1,0) -- (1,1) -- cycle;");
  });
});

describe("insertElementIntoSource", () => {
  it("inserts a snippet before \\end{tikzpicture} using body indentation", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const next = insertElementIntoSource(source, "\\node at (2,2) {A};");

    expect(next).toBe(String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \node at (2,2) {A};
\end{tikzpicture}`);
  });

  it("appends when source has no tikzpicture environment", () => {
    const source = "\\draw (0,0) -- (1,0);";
    const next = insertElementIntoSource(source, "\\node at (0,0) {n};");
    expect(next).toBe("\\draw (0,0) -- (1,0);\n\\node at (0,0) {n};");
  });

  it("generates segment-only source without draw prefix", () => {
    const segments = [
      { kind: "line" as const, to: wp(cm(1), cm(0)) },
      { kind: "line" as const, to: wp(cm(2), cm(0)) }
    ];
    const result = generateComplexPathSegmentSource(segments);
    expect(result).toBe("-- (1,0) -- (2,0)");
  });

  it("generates segment-only source with anchor references", () => {
    const segments = [
      { kind: "line" as const, to: wp(cm(1), cm(0)), toAnchor: { nodeName: "B", anchor: "east" } },
      { kind: "line" as const, to: wp(cm(2), cm(0)) }
    ];
    const result = generateComplexPathSegmentSource(segments);
    expect(result).toBe("-- (B.east) -- (2,0)");
  });

  it("reverses line segments", () => {
    const from = wp(cm(0), cm(0));
    const segments = [
      { kind: "line" as const, to: wp(cm(1), cm(0)) },
      { kind: "line" as const, to: wp(cm(2), cm(0)) }
    ];
    const reversed = reverseComplexPathSegments(from, segments);
    expect(reversed.startWorld).toEqual(wp(cm(2), cm(0)));
    expect(reversed.segments).toHaveLength(2);
    expect(reversed.segments[0]).toEqual({ kind: "line", to: wp(cm(1), cm(0)) });
    expect(reversed.segments[1]).toEqual({ kind: "line", to: wp(cm(0), cm(0)) });
  });

  it("reverses anchor references together with endpoints", () => {
    const from = wp(cm(0), cm(0));
    const segments = [
      { kind: "line" as const, to: wp(cm(1), cm(0)), toAnchor: { nodeName: "B", anchor: "east" } },
      { kind: "line" as const, to: wp(cm(2), cm(0)), toAnchor: { nodeName: "C", anchor: "north" } }
    ];
    const reversed = reverseComplexPathSegments(from, segments, { nodeName: "A", anchor: "west" });
    expect(reversed.startWorld).toEqual(wp(cm(2), cm(0)));
    expect(reversed.startAnchor).toEqual({ nodeName: "C", anchor: "north" });
    expect(reversed.segments).toEqual([
      { kind: "line", to: wp(cm(1), cm(0)), toAnchor: { nodeName: "B", anchor: "east" } },
      { kind: "line", to: wp(cm(0), cm(0)), toAnchor: { nodeName: "A", anchor: "west" } }
    ]);
  });

  it("reverses bezier segments with swapped controls", () => {
    const from = wp(cm(0), cm(0));
    const segments = [
      {
        kind: "bezier" as const,
        to: wp(cm(2), cm(0)),
        control1: wp(cm(0.5), cm(1)),
        control2: wp(cm(1.5), cm(1))
      }
    ];
    const reversed = reverseComplexPathSegments(from, segments);
    expect(reversed.startWorld).toEqual(wp(cm(2), cm(0)));
    expect(reversed.segments[0]).toEqual({
      kind: "bezier",
      to: wp(cm(0), cm(0)),
      control1: wp(cm(1.5), cm(1)),
      control2: wp(cm(0.5), cm(1))
    });
  });

  it("generates prepend source ending with operator", () => {
    const start = wp(cm(-1), cm(0));
    const segments = [
      { kind: "line" as const, to: wp(cm(0), cm(0)) }
    ];
    const result = generateComplexPathPrependSource(start, segments);
    expect(result).toBe("(-1,0) --");
  });

  it("generates prepend source with an anchored start", () => {
    const start = wp(cm(-1), cm(0));
    const segments = [
      { kind: "line" as const, to: wp(cm(0), cm(0)), toAnchor: { nodeName: "A", anchor: "west" } }
    ];
    const result = generateComplexPathPrependSource(start, segments, { nodeName: "C", anchor: "north" });
    expect(result).toBe("(C.north) --");
  });
});
