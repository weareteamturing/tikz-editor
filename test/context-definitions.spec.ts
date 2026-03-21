import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { parseLength } from "../packages/core/src/semantic/coords/parse-length.js";
import { collectContextDefinitions } from "../packages/core/src/transform/cst-to-ast.js";

describe("context definitions", () => {
  it("resolves macro scope across grouped figure environments", () => {
    const source = String.raw`\def\coorddist{0.18}
\begin{figure}
\def\coorddist{0.2}
\begin{tikzpicture}
  \draw (\coorddist,0) -- (\coorddist,1);
\end{tikzpicture}
\end{figure}
\begin{tikzpicture}
  \draw (\coorddist,0) -- (\coorddist,1);
\end{tikzpicture}`;
    const inventory = parseTikz(source, { recover: true });
    const firstFigureId = inventory.figures[0]?.id;
    const secondFigureId = inventory.figures[1]?.id;

    expect(firstFigureId).toBeDefined();
    expect(secondFigureId).toBeDefined();
    if (!firstFigureId || !secondFigureId) {
      return;
    }

    const first = parseTikz(source, {
      recover: true,
      activeFigureId: firstFigureId,
      includeContextDefinitions: true
    });
    const second = parseTikz(source, {
      recover: true,
      activeFigureId: secondFigureId,
      includeContextDefinitions: true
    });

    const firstCoordDefs = first.figure.body.flatMap((statement) =>
      statement.kind === "MacroDefinition" && statement.nameRaw === "\\coorddist" ? [statement] : []
    );
    const secondCoordDefs = second.figure.body.flatMap((statement) =>
      statement.kind === "MacroDefinition" && statement.nameRaw === "\\coorddist" ? [statement] : []
    );

    expect(firstCoordDefs.at(-1)?.valueRaw.trim()).toBe("0.2");
    expect(secondCoordDefs.at(-1)?.valueRaw.trim()).toBe("0.18");

    const firstEvaluated = evaluateTikzFigure(first.figure, source);
    const secondEvaluated = evaluateTikzFigure(second.figure, source);
    const firstPath = firstEvaluated.scene.elements.find((element) => element.kind === "Path");
    const secondPath = secondEvaluated.scene.elements.find((element) => element.kind === "Path");
    const expectedFirstX = parseLength("0.2", "cm");
    const expectedSecondX = parseLength("0.18", "cm");

    expect(expectedFirstX).not.toBeNull();
    expect(expectedSecondX).not.toBeNull();
    expect(firstPath?.kind).toBe("Path");
    expect(secondPath?.kind).toBe("Path");
    if (firstPath?.kind !== "Path" || secondPath?.kind !== "Path" || expectedFirstX == null || expectedSecondX == null) {
      return;
    }

    const firstMove = firstPath.commands.find((command) => command.kind === "M");
    const secondMove = secondPath.commands.find((command) => command.kind === "M");
    expect(firstMove?.kind).toBe("M");
    expect(secondMove?.kind).toBe("M");
    if (firstMove?.kind !== "M" || secondMove?.kind !== "M") {
      return;
    }

    expect(firstMove.to.x).toBeCloseTo(expectedFirstX, 4);
    expect(secondMove.to.x).toBeCloseTo(expectedSecondX, 4);
  });

  it("does not leak grouped and begingroup macro definitions", () => {
    const definitions = collectContextDefinitions(String.raw`\def\coorddist{0.18}
{
  \def\coorddist{0.2}
}
\begingroup
  % this closing brace should be ignored: }
  \def\coorddist{0.3\}}
\endgroup`);
    const coordDefs = definitions.flatMap((statement) =>
      statement.kind === "MacroDefinition" && statement.nameRaw === "\\coorddist" ? [statement] : []
    );
    expect(coordDefs).toHaveLength(1);
    expect(coordDefs[0]?.valueRaw.trim()).toBe("0.18");
  });

  it("treats begin/end environments as grouping boundaries for context defs", () => {
    const definitions = collectContextDefinitions(String.raw`\def\coorddist{0.18}
\begin{anything}
  \def\coorddist{0.2}
\end{anything}`);
    const coordDefs = definitions.flatMap((statement) =>
      statement.kind === "MacroDefinition" && statement.nameRaw === "\\coorddist" ? [statement] : []
    );
    expect(coordDefs).toHaveLength(1);
    expect(coordDefs[0]?.valueRaw.trim()).toBe("0.18");
  });

  it("does not promote dormant macro definitions from command bodies", () => {
    const definitions = collectContextDefinitions(String.raw`\newcommand{\foo}{\def\x{1}}
\def\y{2}`);

    expect(
      definitions.some(
        (statement) => statement.kind === "MacroCommandDefinition" && statement.nameRaw === "\\foo"
      )
    ).toBe(true);
    expect(definitions.some((statement) => statement.kind === "MacroDefinition" && statement.nameRaw === "\\y")).toBe(
      true
    );
    expect(
      definitions.some((statement) => statement.kind === "MacroDefinition" && statement.nameRaw === "\\x")
    ).toBe(false);
  });

  it("collects typed context statements like colorlet and style definitions", () => {
    const definitions = collectContextDefinitions(String.raw`\colorlet{alternativebarcolor}{black!15}
\tikzset{my style/.style={fill=alternativebarcolor}}
\definecolor{brand}{HTML}{1A2B3C}
\pgfkeys{/tikz/.cd, draw=brand}
\usetikzlibrary{patterns}`);

    expect(definitions.some((statement) => statement.kind === "Colorlet")).toBe(true);
    expect(definitions.some((statement) => statement.kind === "DefineColor")).toBe(true);
    expect(definitions.some((statement) => statement.kind === "TikzSet")).toBe(true);
    expect(definitions.some((statement) => statement.kind === "Pgfkeys")).toBe(true);
    expect(definitions.some((statement) => statement.kind === "TikzLibrary")).toBe(true);
  });
});
