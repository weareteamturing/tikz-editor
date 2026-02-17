import { describe, expect, it } from "vitest";

import { parseTikz } from "../src/parser/index.js";
import { evaluateTikzFigure } from "../src/semantic/evaluate.js";
import { emitSvg } from "../src/svg/emit.js";

function renderSvg(source: string): string {
  const parsed = parseTikz(source);
  const semantic = evaluateTikzFigure(parsed.figure, source);
  return emitSvg(semantic.scene).svg;
}

function extractShaftLineEndpoints(svg: string, sourceId: string): { startX: number; endX: number } | null {
  const escapedSourceId = sourceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = svg.match(new RegExp(`data-source-id="${escapedSourceId}" d="M ([0-9.\\-]+) [0-9.\\-]+ L ([0-9.\\-]+) [0-9.\\-]+"`));
  if (!match) {
    return null;
  }
  return {
    startX: Number(match[1]),
    endX: Number(match[2])
  };
}

describe("svg arrow geometry", () => {
  it("emits explicit tip path metadata and does not emit SVG markers", () => {
    const source = String.raw`\begin{tikzpicture}[>=Stealth]
  \draw[arrows={-Latex[open,length=10pt,color=blue]}] (0,0) -- (2,0);
  \draw[>->] (0,1) -- (2,1);
\end{tikzpicture}`;
    const svg = renderSvg(source);

    expect(svg).toContain('data-arrow-tip-kind="latex"');
    expect(svg).toContain('data-arrow-tip-kind="stealth"');
    expect(svg).toContain('data-arrow-side="start"');
    expect(svg).toContain('data-arrow-side="end"');
    expect(svg).toContain('data-arrow-index="0"');
    expect(svg).toContain('data-arrow-bend="false"');
    expect(svg).not.toContain("<marker");
    expect(svg).not.toContain("marker-start=");
    expect(svg).not.toContain("marker-end=");
  });

  it("shortens end shafts further when dot separators force after-line-end accumulation", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[-{Stealth[length=4pt] Stealth[length=4pt]}] (0,0) -- (2,0);
  \draw[-{Stealth[length=4pt] . Stealth[length=4pt]}] (0,1) -- (2,1);
\end{tikzpicture}`;
    const svg = renderSvg(source);

    const plain = extractShaftLineEndpoints(svg, "path:0");
    const dotted = extractShaftLineEndpoints(svg, "path:1");
    expect(plain).not.toBeNull();
    expect(dotted).not.toBeNull();
    if (!plain || !dotted) {
      return;
    }

    expect(dotted.endX).toBeLessThan(plain.endX - 0.3);

    const dottedTips = svg.match(/data-source-id="path:1" data-arrow-tip-kind="stealth"/g) ?? [];
    expect(dottedTips.length).toBe(2);
  });

  it("uses curved geometry for Latex tips and keeps open tips unfilled", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[-{Latex[open,length=8pt,width=6pt]}] (0,0) -- (2,0);
\end{tikzpicture}`;
    const svg = renderSvg(source);

    const tagMatch = svg.match(/<path data-source-id="path:0" data-arrow-tip-kind="latex"[^>]+>/);
    expect(tagMatch).not.toBeNull();
    const tag = tagMatch?.[0] ?? "";
    expect(tag).toContain('fill="none"');
    expect(tag.includes('stroke="black"') || tag.includes('stroke="#000000"')).toBe(true);
    expect(tag).toContain(' d="M ');
    expect(tag).toContain(" C ");
  });

  it("emits bend metadata and distinct bend/non-bend tip paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[-{Stealth[bend]}] (0,0) .. controls (1,1) and (2,1) .. (3,0);
  \draw[-{Stealth}] (0,-1) .. controls (1,0) and (2,0) .. (3,-1);
\end{tikzpicture}`;
    const svg = renderSvg(source);

    expect(svg).toContain('data-source-id="path:0" data-arrow-tip-kind="stealth" data-arrow-side="end" data-arrow-index="0" data-arrow-bend="true"');
    expect(svg).toContain('data-source-id="path:1" data-arrow-tip-kind="stealth" data-arrow-side="end" data-arrow-index="0" data-arrow-bend="false"');
  });

  it("emits geometry metadata for additional arrows.meta tip families", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[-{Kite[] Square[] Circle[] Rays[n=6]}] (0,0) -- (2,0);
  \draw[-{Bracket[] Parenthesis[]}] (0,1) -- (2,1);
\end{tikzpicture}`;
    const svg = renderSvg(source);

    expect(svg).toContain('data-arrow-tip-kind="kite"');
    expect(svg).toContain('data-arrow-tip-kind="square"');
    expect(svg).toContain('data-arrow-tip-kind="circle"');
    expect(svg).toContain('data-arrow-tip-kind="rays"');
    expect(svg).toContain('data-arrow-tip-kind="tee-barb"');
    expect(svg).toContain('data-arrow-tip-kind="arc-barb"');
  });
});
