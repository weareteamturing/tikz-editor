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

  it("parses inline tikz commands into path statements", () => {
    const source = String.raw`\tikz \draw (0,0) -- (1,1);`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    expect(result.figure.body).toHaveLength(1);
    expect(result.figure.body[0]?.kind).toBe("Path");
    if (result.figure.body[0]?.kind === "Path") {
      expect(result.figure.body[0].command).toBe("draw");
    }
  });

  it("parses inline tikz options and braced bodies", () => {
    const source = String.raw`\tikz[rotate=30]{\draw[step=1mm] (0,0) grid (2,2);};`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    expect(result.figure.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "rotate")).toBe(true);
    expect(result.figure.body.some((statement) => statement.kind === "Path")).toBe(true);
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

  it("accepts comments inside option lists", () => {
    const source = String.raw`\begin{tikzpicture}
  [fill=yellow!80!black, % only sets the color
   every path/.style={draw}]  % all paths are drawn
  \fill (0,0) rectangle +(1,1);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "missing-option-close")).toBe(false);
  });

  it("maps unknown commands to UnknownStatement", () => {
    const source = loadFixture("unknown.tex");
    const result = parseTikz(source);

    expect(result.figure.body).toHaveLength(1);
    expect(result.figure.body[0]?.kind).toBe("UnknownStatement");
  });

  it("parses standalone font-size commands without swallowing following path statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \huge
  \node (x) at (0,0) {X};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body.length).toBe(2);
    expect(result.figure.body[0]?.kind).toBe("UnknownStatement");
    expect(result.figure.body[1]?.kind).toBe("Path");
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

  it("parses standalone node commands that use node contents without trailing braces", () => {
    const source = String.raw`\begin{tikzpicture}
      \node[name=title,alias=headline,node contents=Hello,at={(1,2)}];
    \end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.text).toBe("Hello");
      expect(node.textSource).toBe("option");
      expect(node.name).toBe("title");
      expect(node.aliases).toEqual(["headline"]);
      expect(node.atRaw).toBe("(1,2)");
    }
  });

  it("captures inline node placement coordinates in path syntax", () => {
    const source = String.raw`\begin{tikzpicture}
      \draw (0,0) node[draw] at (1,0) {A};
    \end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.atRaw).toBe("(1,0)");
      expect(node.text).toBe("A");
      expect(node.textSource).toBe("group");
    }
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

  it("parses node names with options and text in path syntax", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node(a) [draw] {A}  (1,1) node(b) [draw] {B};
  \draw (a.north) |- (b.west);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);

    const firstPath = result.figure.body[0];
    expect(firstPath?.kind).toBe("Path");
    if (!firstPath || firstPath.kind !== "Path") {
      return;
    }

    const nodeTexts = firstPath.items
      .filter((item) => item.kind === "Node")
      .map((item) => (item.kind === "Node" ? item.text : ""));
    expect(nodeTexts).toEqual(["A", "B"]);

    const unknownPathTexts: string[] = [];
    result.tree.iterate({
      enter(node) {
        if (node.name === "UnknownPathItem") {
          unknownPathTexts.push(source.slice(node.from, node.to));
        }
      }
    });

    expect(unknownPathTexts).not.toContain("{A}");
    expect(unknownPathTexts).not.toContain("{B}");
  });

  it("covers core path operations up to parabola/sine/cosine without unknown fallbacks", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -| (1,1) |- (0,1) -- cycle;
  \draw (0,0) .. controls (1,1) and (2,1) .. (3,0);
  \draw (0,0) rectangle (1,1);
  \draw (0,0) circle [radius=1cm];
  \draw (0,0) ellipse [x radius=1cm, y radius=.5cm];
  \draw (0,0) arc[start angle=0, end angle=90, radius=1cm];
  \draw (0,0) grid [step=1] (2,2);
  \draw (0,0) parabola bend (1,1) (2,0);
  \draw (0,0) sin (1,1) cos (2,0);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);

    const keywords = result.figure.body
      .filter((statement) => statement.kind === "Path")
      .flatMap((statement) =>
        statement.kind === "Path"
          ? statement.items
              .filter((item) => item.kind === "PathKeyword")
              .map((item) => (item.kind === "PathKeyword" ? item.keyword : ""))
          : []
      );

    expect(keywords).toEqual(
      expect.arrayContaining(["cycle", "controls", "and", "rectangle", "circle", "ellipse", "arc", "grid", "parabola", "bend", "sin", "cos"])
    );

    const unknown = result.figure.body
      .filter((statement) => statement.kind === "Path")
      .flatMap((statement) =>
        statement.kind === "Path"
          ? statement.items.filter((item) => item.kind === "UnknownPathItem").map((item) => (item.kind === "UnknownPathItem" ? item.raw.trim() : ""))
          : []
      );

    expect(unknown).toHaveLength(0);
  });

  it("parses to, svg, let, and coordinate operations with typed IR items", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) to [edge label=x, edge label'=y] node [above] {t} (3,2);
  \filldraw [fill=red!20] (0,1) svg[scale=2] {h 10 v 10 h -10} -- cycle;
  \path let \p1 = (1,1), \p2 = (2,0) in (0,0) -- (\p2);
  \path coordinate (p1) at (1,0) coordinate (p2) at (2,1);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);

    const items = result.figure.body
      .filter((statement) => statement.kind === "Path")
      .flatMap((statement) => (statement.kind === "Path" ? statement.items : []));

    expect(items.some((item) => item.kind === "ToOperation")).toBe(true);
    expect(items.some((item) => item.kind === "SvgOperation")).toBe(true);
    expect(items.some((item) => item.kind === "LetOperation")).toBe(true);
    expect(items.filter((item) => item.kind === "CoordinateOperation").length).toBeGreaterThanOrEqual(2);

    const svg = items.find((item) => item.kind === "SvgOperation");
    expect(svg?.kind).toBe("SvgOperation");
    if (svg?.kind === "SvgOperation") {
      expect(svg.dataRaw).toBe("{h 10 v 10 h -10}");
    }
  });

  it("recognizes action command aliases as path commands", () => {
    const source = String.raw`\begin{tikzpicture}
  \pattern (0,0) circle (1ex);
  \shadedraw (0,0) circle (1ex);
  \useasboundingbox (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = parseTikz(source);

    const commands = result.figure.body
      .filter((statement) => statement.kind === "Path")
      .map((statement) => (statement.kind === "Path" ? statement.command : "path"));

    expect(commands).toEqual(expect.arrayContaining(["pattern", "shadedraw", "useasboundingbox"]));
  });

  it("parses scope and foreach constructs used in actions examples without hard errors", () => {
    const source = String.raw`\begin{tikzpicture}[|-|, dash pattern=on 4pt off 2pt]
  \begin{scope}[line width=1pt]
    \draw[line cap=round] (0,1 ) -- +(1,0);
    \draw[line cap=butt]  (0,.5) -- +(1,0);
  \end{scope}
  \foreach \lw in {0.5,1,1.5,2,2.5}
    \draw[line width=\lw pt,double] (\lw,0) -- ++(4mm,0);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    expect(result.figure.options?.entries.length).toBeGreaterThan(0);

    const scope = result.figure.body.find((statement) => statement.kind === "Scope");
    expect(scope?.kind).toBe("Scope");
    if (scope?.kind === "Scope") {
      expect(scope.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "line width")).toBe(true);
      expect(scope.body.some((statement) => statement.kind === "Path")).toBe(true);
    }

    const foreach = result.figure.body.find((statement) => statement.kind === "Foreach");
    expect(foreach?.kind).toBe("Foreach");
    if (foreach?.kind === "Foreach") {
      expect(foreach.prefixRaw).toContain("\\lw");
      expect(foreach.bodyRaw.length).toBeGreaterThan(0);
      expect(foreach.variablesRaw).toContain("\\lw");
      expect(foreach.listRaw).toContain("0.5");
    }
  });

  it("parses path foreach operations as typed path items", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2} { -- (\x,0) };
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body.find((entry) => entry.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const foreachItem = statement.items.find((item) => item.kind === "PathForeach");
    expect(foreachItem?.kind).toBe("PathForeach");
    if (foreachItem?.kind === "PathForeach") {
      expect(foreachItem.variablesRaw).toContain("\\x");
      expect(foreachItem.listRaw).toContain("1,2");
      expect(foreachItem.bodyRaw).toContain("--");
    }
  });

  it("parses node foreach clauses and keeps a foreach-free node template", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) -- (2,0) node foreach \p in {0.25,0.75} [pos=\p] {\p};
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body.find((entry) => entry.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.foreachClauses).toHaveLength(1);
      expect(node.foreachClauses?.[0]?.variablesRaw).toContain("\\p");
      expect(node.foreachClauses?.[0]?.listRaw).toContain("0.25");
      expect(node.templateRaw.includes("foreach")).toBe(false);
    }
  });

  it("supports node text validator hooks and reports TeX validation diagnostics", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node {ok} -- (1,0) node {bad};
\end{tikzpicture}`;
    const result = parseTikz(source, {
      nodeTextValidator: ({ node }) =>
        node.text === "bad"
          ? {
              code: "invalid-node-tex",
              message: "Invalid node TeX."
            }
          : null
    });

    const textDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === "invalid-node-tex");
    expect(textDiagnostics).toHaveLength(1);
    expect(textDiagnostics[0]?.severity).toBe("error");
    expect(textDiagnostics[0]?.message).toBe("Invalid node TeX.");
  });
});
