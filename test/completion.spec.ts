import { describe, expect, it } from "vitest";
import { parseTikz } from "../src/parser/index.js";
import { collectSymbols } from "../src/completion/index.js";

describe("collectSymbols", () => {
  it("collects node names, coordinate names, and style names", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{
    box/.style={draw,rounded corners},
    accent/.append style={fill=blue!20}
  }
  \tikzstyle{legacy}=[red]
  \pgfkeys{/tikz/helper/.style={thick}}

  \node (A) at (0,0) {A};
  \path (0,0) node[name=mid,alias=middle] {M}
    coordinate (p1) at (1,0)
    coordinate (p2) at (2,1);
\end{tikzpicture}`;
    const parseResult = parseTikz(source, { recover: true });

    const symbols = collectSymbols({ parseResult });

    expect(symbols.nodeNames).toEqual(expect.arrayContaining(["A", "mid", "middle"]));
    expect(symbols.coordinateNames).toEqual(expect.arrayContaining(["p1", "p2"]));
    expect(symbols.styleNames).toEqual(expect.arrayContaining(["accent", "box", "helper", "legacy"]));
  });

  it("collects node names from to/edge operation node payloads", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) to node (edgeLabel) {E} (1,1);
\end{tikzpicture}`;
    const parseResult = parseTikz(source, { recover: true });

    const symbols = collectSymbols({ parseResult });
    expect(symbols.nodeNames).toContain("edgeLabel");
  });

  it("returns empty collections without a parse result", () => {
    expect(collectSymbols({ parseResult: null })).toEqual({
      nodeNames: [],
      styleNames: [],
      coordinateNames: []
    });
  });
});
