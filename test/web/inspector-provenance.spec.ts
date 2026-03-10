import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";
import { getInspectorDescriptor } from "../../packages/core/src/edit/inspector.js";
import { buildStylesCascadeModel } from "../../packages/core/src/edit/styles-cascade.js";
import {
  buildInspectorPropertyProvenanceMap,
  buildMultiInspectorModel,
  buildMultiInspectorPropertyProvenanceMap
} from "../../packages/app/src/ui/inspector-panel/panel-helpers.js";
import type { SceneElement } from "../../packages/core/src/semantic/types.js";

function textElements(source: string): SceneElement[] {
  const rendered = renderTikzToSvg(source);
  return rendered.semantic.scene.elements
    .filter((entry): entry is SceneElement => entry.kind === "Text")
    .sort((left, right) => left.sourceRef.sourceSpan.from - right.sourceRef.sourceSpan.from);
}

describe("inspector property provenance", () => {
  it("marks single-selection inherited values with source label", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;
    const [element] = textElements(source);
    expect(element).toBeDefined();
    if (!element) return;

    const descriptor = getInspectorDescriptor(element, { source });
    const model = buildStylesCascadeModel(element, { source }, descriptor);
    const provenance = buildInspectorPropertyProvenanceMap(model);

    expect(provenance["fill-color"]).toEqual({
      kind: "inherited",
      sourceLabel: "every node",
      tooltip: "set by every node"
    });
    expect(provenance["stroke-color"]).toBeUndefined();
  });

  it("marks default-only values as TikZ default", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const path = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(path).toBeDefined();
    if (!path) return;

    const descriptor = getInspectorDescriptor(path, { source });
    const model = buildStylesCascadeModel(path, { source }, descriptor);
    const provenance = buildInspectorPropertyProvenanceMap(model);

    expect(provenance["line-width"]).toEqual({
      kind: "default",
      tooltip: "TikZ default"
    });
  });

  it("keeps multi-select provenance only when all selected elements agree", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=green!20}]
  \node[draw] at (0,0) {A};
  \node[draw] at (1,0) {B};
\end{tikzpicture}`;
    const elements = textElements(source);
    expect(elements).toHaveLength(2);
    if (elements.length !== 2) return;

    const descriptors = elements.map((element) => getInspectorDescriptor(element, { source }));
    const perElement = elements.map((element, index) =>
      buildInspectorPropertyProvenanceMap(buildStylesCascadeModel(element, { source }, descriptors[index]))
    );
    const multi = buildMultiInspectorModel(descriptors, elements.length);
    const provenance = buildMultiInspectorPropertyProvenanceMap(multi, perElement, elements.length);

    expect(provenance["fill-color"]).toEqual({
      kind: "inherited",
      sourceLabel: "every node",
      tooltip: "set by every node"
    });
  });

  it("hides multi-select provenance when source labels differ", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=red},every circle node/.style={fill=red}]
  \node[draw,circle] at (0,0) {A};
  \node[draw,rectangle] at (1,0) {B};
\end{tikzpicture}`;
    const elements = textElements(source);
    expect(elements).toHaveLength(2);
    if (elements.length !== 2) return;

    const descriptors = elements.map((element) => getInspectorDescriptor(element, { source }));
    const perElement = elements.map((element, index) =>
      buildInspectorPropertyProvenanceMap(buildStylesCascadeModel(element, { source }, descriptors[index]))
    );
    const multi = buildMultiInspectorModel(descriptors, elements.length);
    const provenance = buildMultiInspectorPropertyProvenanceMap(multi, perElement, elements.length);

    expect(provenance["fill-color"]).toBeUndefined();
  });

  it("hides multi-select provenance for mixed values", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=red}]
  \node[draw] at (0,0) {A};
  \node[draw,fill=blue] at (1,0) {B};
\end{tikzpicture}`;
    const elements = textElements(source);
    expect(elements).toHaveLength(2);
    if (elements.length !== 2) return;

    const descriptors = elements.map((element) => getInspectorDescriptor(element, { source }));
    const perElement = elements.map((element, index) =>
      buildInspectorPropertyProvenanceMap(buildStylesCascadeModel(element, { source }, descriptors[index]))
    );
    const multi = buildMultiInspectorModel(descriptors, elements.length);
    const fillColor = multi.sections
      .flatMap((section) => section.properties)
      .find((property) => property.id === "fill-color");
    expect(fillColor).toBeDefined();
    expect(fillColor && "mixed" in fillColor ? fillColor.mixed : false).toBe(true);

    const provenance = buildMultiInspectorPropertyProvenanceMap(multi, perElement, elements.length);
    expect(provenance["fill-color"]).toBeUndefined();
  });
});
