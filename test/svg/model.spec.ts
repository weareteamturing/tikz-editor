import { describe, expect, it } from "vitest";

import { parseTikz } from "../../src/parser/index.js";
import { evaluateTikzFigure } from "../../src/semantic/evaluate.js";
import { emitSvg, emitSvgModel } from "../../src/svg/emit.js";
import { serializeSvgModel } from "../../src/svg/model.js";

describe("svg render model", () => {
  it("is deterministic for equivalent scene input", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,0) circle [radius=3pt];
  \node at (0.5,0.5) {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);

    const first = emitSvgModel(semantic.scene, { padding: 8 });
    const second = emitSvgModel(semantic.scene, { padding: 8 });

    expect(first).toEqual(second);
    const partIds = first.parts.map((part) => part.partId);
    expect(new Set(partIds).size).toBe(partIds.length);
    expect(first.parts.every((part, index) => part.order === index)).toBe(true);
  });

  it("serializes to the same svg output as emitSvg compatibility wrapper", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->] (0,0) -- (2,1);
  \node at (1,0.5) {Hello};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);

    const model = emitSvgModel(semantic.scene, { padding: 10 });
    const emitted = emitSvg(semantic.scene, { padding: 10 });

    expect(serializeSvgModel(model, true)).toBe(emitted.svg);
    expect(emitted.model).toEqual(model);
    expect(emitted.diagnostics).toEqual(model.diagnostics);
  });

  it("matches full emission when reusing unaffected source parts", () => {
    const previousSource = String.raw`\begin{tikzpicture}
  \draw (-3,1) -- (3,1);
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const nextSource = String.raw`\begin{tikzpicture}
  \draw (-3,1) -- (3,1);
  \draw (0.2,0) -- (1.2,0);
\end{tikzpicture}`;

    const previousParsed = parseTikz(previousSource);
    const previousSemantic = evaluateTikzFigure(previousParsed.figure, previousSource);
    const nextParsed = parseTikz(nextSource);
    const nextSemantic = evaluateTikzFigure(nextParsed.figure, nextSource);

    const previousModel = emitSvgModel(previousSemantic.scene, { padding: 8 });
    const fullNextModel = emitSvgModel(nextSemantic.scene, { padding: 8 });
    const movedSourceId = previousSemantic.scene.elements[1]?.sourceId;
    expect(movedSourceId).toBeDefined();

    const incrementalNextModel = emitSvgModel(nextSemantic.scene, {
      padding: 8,
      reuse: {
        previousModel,
        affectedSourceIds: movedSourceId ? [movedSourceId] : []
      }
    });

    expect(incrementalNextModel).toEqual(fullNextModel);
  });

  it("falls back to full emission when viewBox changes under reuse hints", () => {
    const previousSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;
    const nextSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (5,0);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const previousParsed = parseTikz(previousSource);
    const previousSemantic = evaluateTikzFigure(previousParsed.figure, previousSource);
    const nextParsed = parseTikz(nextSource);
    const nextSemantic = evaluateTikzFigure(nextParsed.figure, nextSource);

    const previousModel = emitSvgModel(previousSemantic.scene, { padding: 8 });
    const fullNextModel = emitSvgModel(nextSemantic.scene, { padding: 8 });
    const movedSourceId = previousSemantic.scene.elements[0]?.sourceId;
    expect(movedSourceId).toBeDefined();
    expect(fullNextModel.viewBox).not.toEqual(previousModel.viewBox);

    const incrementalNextModel = emitSvgModel(nextSemantic.scene, {
      padding: 8,
      reuse: {
        previousModel,
        affectedSourceIds: movedSourceId ? [movedSourceId] : []
      }
    });

    expect(incrementalNextModel).toEqual(fullNextModel);
  });
});
