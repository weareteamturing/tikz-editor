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

const cm = (value: number) => value * PT_PER_CM;

describe("element templates", () => {
  it("generates a node snippet at a world-space position", () => {
    const snippet = generateElementSource(
      { kind: "node", text: "Hello" },
      { x: cm(1.5), y: cm(-2) }
    );
    expect(snippet).toBe("\\node at (1.5,-2) {Hello};");
  });

  it("generates a drag-aware arrow line snippet", () => {
    const snippet = generateElementSource(
      { kind: "line", hasArrow: true, to: { x: cm(3), y: cm(4) } },
      { x: cm(1), y: cm(2) }
    );
    expect(snippet).toBe("\\draw[->] (1,2) -- (3,4);");
  });

  it("generates a line snippet from named center anchors", () => {
    const snippet = generateElementSource(
      {
        kind: "line",
        fromAnchor: { nodeName: "A", anchor: "center" },
        toAnchor: { nodeName: "B", anchor: "center" },
        to: { x: cm(3), y: cm(4) }
      },
      { x: cm(1), y: cm(2) }
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
        to: { x: cm(3), y: cm(4) }
      },
      { x: cm(1), y: cm(2) }
    );
    expect(snippet).toBe("\\draw[->] (A.west) -- (B.east);");
  });

  it("generates a circle snippet with explicit cm radius", () => {
    const snippet = generateElementSource(
      { kind: "circle", edge: { x: cm(1.5), y: cm(1) } },
      { x: cm(1), y: cm(1) }
    );
    expect(snippet).toBe("\\draw (1,1) circle (0.5cm);");
  });

  it("generates an ellipse snippet from dragged bounding corners", () => {
    const snippet = generateElementSource(
      { kind: "ellipse", corner: { x: cm(3), y: cm(5) } },
      { x: cm(1), y: cm(1) }
    );
    expect(snippet).toBe("\\draw (2,3) ellipse [x radius=1cm, y radius=2cm];");
  });

  it("generates a cubic bezier snippet with explicit controls", () => {
    const snippet = generateElementSource(
      {
        kind: "bezier",
        to: { x: cm(4), y: cm(2) },
        control1: { x: cm(2), y: cm(3) },
        control2: { x: cm(3), y: cm(1) }
      },
      { x: cm(1), y: cm(2) }
    );
    expect(snippet).toBe("\\draw (1,2) .. controls (2,3) and (3,1) .. (4,2);");
  });

  it("generates a grid snippet from dragged corners", () => {
    const snippet = generateElementSource(
      { kind: "grid", corner: { x: cm(3), y: cm(5) } },
      { x: cm(1), y: cm(2) }
    );
    expect(snippet).toBe("\\draw (1,2) grid (3,5);");
  });

  it("generates a default-sized grid snippet without a drag corner", () => {
    const snippet = generateElementSource(
      { kind: "grid" },
      { x: cm(1), y: cm(2) }
    );
    expect(snippet).toBe("\\draw (1,2) grid (3.2,3.4);");
  });

  it("generates an open multi-segment complex path snippet", () => {
    const snippet = generateComplexPathSource(
      { x: cm(0), y: cm(0) },
      [
        { kind: "line", to: { x: cm(1), y: cm(0) } },
        { kind: "line", to: { x: cm(2), y: cm(1) } }
      ]
    );
    expect(snippet).toBe("\\draw (0,0) -- (1,0) -- (2,1);");
  });

  it("generates a mixed line/bezier complex path snippet", () => {
    const snippet = generateComplexPathSource(
      { x: cm(0), y: cm(0) },
      [
        { kind: "line", to: { x: cm(1), y: cm(0) } },
        {
          kind: "bezier",
          control1: { x: cm(2), y: cm(1) },
          control2: { x: cm(3), y: cm(1) },
          to: { x: cm(4), y: cm(0) }
        }
      ]
    );
    expect(snippet).toBe("\\draw (0,0) -- (1,0) .. controls (2,1) and (3,1) .. (4,0);");
  });

  it("generates a closed complex path snippet with cycle", () => {
    const snippet = generateComplexPathSource(
      { x: cm(0), y: cm(0) },
      [
        { kind: "line", to: { x: cm(1), y: cm(0) } },
        { kind: "line", to: { x: cm(1), y: cm(1) } }
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
      { kind: "line" as const, to: { x: cm(1), y: cm(0) } },
      { kind: "line" as const, to: { x: cm(2), y: cm(0) } }
    ];
    const result = generateComplexPathSegmentSource(segments);
    expect(result).toBe("-- (1,0) -- (2,0)");
  });

  it("reverses line segments", () => {
    const from = { x: cm(0), y: cm(0) };
    const segments = [
      { kind: "line" as const, to: { x: cm(1), y: cm(0) } },
      { kind: "line" as const, to: { x: cm(2), y: cm(0) } }
    ];
    const reversed = reverseComplexPathSegments(from, segments);
    expect(reversed.startWorld).toEqual({ x: cm(2), y: cm(0) });
    expect(reversed.segments).toHaveLength(2);
    expect(reversed.segments[0]).toEqual({ kind: "line", to: { x: cm(1), y: cm(0) } });
    expect(reversed.segments[1]).toEqual({ kind: "line", to: { x: cm(0), y: cm(0) } });
  });

  it("reverses bezier segments with swapped controls", () => {
    const from = { x: cm(0), y: cm(0) };
    const segments = [
      {
        kind: "bezier" as const,
        to: { x: cm(2), y: cm(0) },
        control1: { x: cm(0.5), y: cm(1) },
        control2: { x: cm(1.5), y: cm(1) }
      }
    ];
    const reversed = reverseComplexPathSegments(from, segments);
    expect(reversed.startWorld).toEqual({ x: cm(2), y: cm(0) });
    expect(reversed.segments[0]).toEqual({
      kind: "bezier",
      to: { x: cm(0), y: cm(0) },
      control1: { x: cm(1.5), y: cm(1) },
      control2: { x: cm(0.5), y: cm(1) }
    });
  });

  it("generates prepend source ending with operator", () => {
    const start = { x: cm(-1), y: cm(0) };
    const segments = [
      { kind: "line" as const, to: { x: cm(0), y: cm(0) } }
    ];
    const result = generateComplexPathPrependSource(start, segments);
    expect(result).toBe("(-1,0) --");
  });
});
