import { describe, expect, it } from "vitest";

import { parseTikz } from "../src/parser/index.js";
import { loadFixture } from "./helpers.js";

describe("parseTikz", () => {
  it("parses minimal tikzpicture into a non-empty IR", () => {
    const source = loadFixture("minimal.tex");
    const result = parseTikz(source);

    expect(result.figure.kind).toBe("Figure");
    expect(result.figure.body.length).toBeGreaterThan(0);
    expect(result.figure.body[0]?.kind).toBe("Path");
  });

  it("parses node text with nested braces", () => {
    const source = `\\begin{tikzpicture}\\draw (0,0) node {A {B} C};\\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.text).toContain("A {B} C");
    }
  });

  it("keeps comments reachable in CST", () => {
    const source = loadFixture("comments.tex");
    const result = parseTikz(source);

    const cursor = result.tree.cursor();
    const comments: string[] = [];
    do {
      if (cursor.type.name === "Comment") {
        comments.push(source.slice(cursor.from, cursor.to));
      }
    } while (cursor.next());

    expect(comments.length).toBeGreaterThan(0);
    expect(comments.some((comment) => comment.includes("keep this comment"))).toBe(true);
    expect(comments.some((comment) => comment.includes("trailing"))).toBe(true);
  });

  it("maps unknown commands to UnknownStatement", () => {
    const source = loadFixture("unknown.tex");
    const result = parseTikz(source);

    expect(result.figure.body).toHaveLength(1);
    expect(result.figure.body[0]?.kind).toBe("UnknownStatement");
  });

  it("returns diagnostics while still producing IR for incomplete input", () => {
    const source = loadFixture("incomplete.tex");
    const result = parseTikz(source);

    expect(result.figure.body.length).toBeGreaterThan(0);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts named and polar coordinates without malformed warnings", () => {
    const source = String.raw`\begin{tikzpicture}
      \draw (origin) -- (30:2cm);
    \end{tikzpicture}`;
    const result = parseTikz(source);

    const malformed = result.diagnostics.filter((diagnostic) => diagnostic.code === "malformed-coordinate");
    expect(malformed).toHaveLength(0);

    const firstPath = result.figure.body.find((statement) => statement.kind === "Path");
    expect(firstPath?.kind).toBe("Path");
    if (firstPath?.kind !== "Path") {
      return;
    }

    const coordinates = firstPath.items.filter((item) => item.kind === "Coordinate");
    expect(coordinates).toHaveLength(2);
    if (coordinates[0]?.kind === "Coordinate") {
      expect(coordinates[0].form).toBe("named");
    }
    if (coordinates[1]?.kind === "Coordinate") {
      expect(coordinates[1].form).toBe("polar");
    }
  });

  it("parses standalone node commands as path statements with node content", () => {
    const source = String.raw`\begin{tikzpicture}
      \node[draw] at (0,0) {Center};
    \end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    expect(statement.command).toBe("node");
    expect(statement.items.some((item) => item.kind === "Node")).toBe(true);
    expect(statement.items.some((item) => item.kind === "Coordinate")).toBe(true);
  });

  it("recognizes node text, 'at', and 'cycle' in a mixed drawing snippet", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[thick, ->] (0,0) -- (2,1);
  \fill[red] (1,1) circle;
  \node[above] at (2,1) {Headd};
  % A comment
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`;
    const result = parseTikz(source);

    const nodeStatement = result.figure.body.find(
      (statement) => statement.kind === "Path" && statement.command === "node"
    );
    expect(nodeStatement?.kind).toBe("Path");
    if (!nodeStatement || nodeStatement.kind !== "Path") {
      return;
    }

    const nodeItem = nodeStatement.items.find((item) => item.kind === "Node");
    expect(nodeItem?.kind).toBe("Node");
    if (nodeItem?.kind === "Node") {
      expect(nodeItem.text).toBe("Headd");
    }

    const hasAtKeyword = nodeStatement.items.some((item) => item.kind === "PathKeyword" && item.keyword === "at");
    expect(hasAtKeyword).toBe(true);

    const drawWithCycle = result.figure.body.find(
      (statement) =>
        statement.kind === "Path" &&
        statement.items.some((item) => item.kind === "PathKeyword" && item.keyword === "cycle")
    );
    expect(drawWithCycle?.kind).toBe("Path");

    const unknownPathTexts: string[] = [];
    result.tree.iterate({
      enter(node) {
        if (node.name === "UnknownPathItem") {
          unknownPathTexts.push(source.slice(node.from, node.to));
        }
      }
    });

    expect(unknownPathTexts).not.toContain("at");
    expect(unknownPathTexts).not.toContain("circle");
    expect(unknownPathTexts).not.toContain("cycle");
    expect(unknownPathTexts).not.toContain("{Headd}");
  });

  it("parses relative and incremental coordinates (+ and ++)", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- ++(1,0) -- +(1,1) -- cycle;
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body.find((item) => item.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const coordinates = statement.items.filter((item) => item.kind === "Coordinate");
    expect(coordinates.length).toBeGreaterThanOrEqual(3);
    expect(coordinates.some((item) => item.kind === "Coordinate" && item.relativePrefix === "++")).toBe(true);
    expect(coordinates.some((item) => item.kind === "Coordinate" && item.relativePrefix === "+")).toBe(true);
  });

  it("parses coordinate-local options like ([xshift=3pt] 1,1)", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- ([xshift=3pt] 1,1) -- +([shift=(135:5pt)] 30:2cm);
\end{tikzpicture}`;
    const result = parseTikz(source);

    const malformed = result.diagnostics.filter((diagnostic) => diagnostic.code === "malformed-coordinate");
    expect(malformed).toHaveLength(0);

    const statement = result.figure.body.find((item) => item.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const shifted = statement.items.find((item) => item.kind === "Coordinate" && item.x === "1" && item.y === "1");
    expect(shifted?.kind).toBe("Coordinate");
    if (shifted?.kind === "Coordinate") {
      expect(shifted.optionsSpan).toBeDefined();
    }
  });

  it("classifies explicit cs and calc coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (canvas cs:x=0cm,y=2mm) -- ($(1,1) + (2,0)$);
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body.find((item) => item.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const forms = statement.items
      .filter((item) => item.kind === "Coordinate")
      .map((item) => (item.kind === "Coordinate" ? item.form : "unknown"));

    expect(forms).toContain("explicit");
    expect(forms).toContain("calc");
  });
});
