import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import {
  buildSharedStylesCascadeModel,
  buildStylesCascadeModel,
  planStylesRenamePropertyActions
} from "../packages/core/src/edit/styles-cascade.js";

function firstPath(source: string) {
  const rendered = renderTikzToSvg(source);
  const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
  if (!element || element.kind !== "Path") {
    throw new Error("Expected a path element");
  }
  return { rendered, element };
}

describe("styles cascade model", () => {
  it("orders sections from most specific to least specific and marks overridden declarations", () => {
    const source = String.raw`\begin{tikzpicture}[accent/.style={draw=red,fill=yellow}]
  \begin{scope}[draw=blue]
    \draw[accent,line width=1pt] (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });

    expect(model.sections.length).toBeGreaterThanOrEqual(3);
    expect(model.sections[0]?.kind).toBe("command");
    expect(model.sections.some((section) => section.kind === "named-style")).toBe(true);
    expect(model.sections.some((section) => section.kind === "scope")).toBe(true);

    const namedStyleSection = model.sections.find((section) => section.kind === "named-style");
    expect(namedStyleSection).toBeDefined();
    const strokeDeclaration = namedStyleSection?.declarations.find((declaration) => declaration.propertyId === "stroke-color");
    expect(strokeDeclaration?.status).toBe("active");

    const scopeSection = model.sections.find((section) => section.kind === "scope");
    expect(scopeSection).toBeDefined();
    const scopeStroke = scopeSection?.declarations.find((declaration) => declaration.propertyId === "stroke-color");
    expect(scopeStroke?.status).toBe("overridden");
  });

  it("treats matching cascades as shareable and different cascades as non-shareable", () => {
    const matchingSource = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
  \draw[draw=red,line width=1pt] (0,1) -- (1,1);
\end{tikzpicture}`;
    const matchingRendered = renderTikzToSvg(matchingSource);
    const matchingPaths = matchingRendered.semantic.scene.elements.filter((entry) => entry.kind === "Path");
    expect(matchingPaths).toHaveLength(2);
    const matchingModels = matchingPaths.map((entry) =>
      buildStylesCascadeModel(entry, { source: matchingSource, editHandles: matchingRendered.semantic.editHandles })
    );
    expect(buildSharedStylesCascadeModel(matchingModels)).not.toBeNull();

    const differentSource = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
  \draw[draw=blue,line width=1pt] (0,1) -- (1,1);
\end{tikzpicture}`;
    const differentRendered = renderTikzToSvg(differentSource);
    const differentPaths = differentRendered.semantic.scene.elements.filter((entry) => entry.kind === "Path");
    const differentModels = differentPaths.map((entry) =>
      buildStylesCascadeModel(entry, { source: differentSource, editHandles: differentRendered.semantic.editHandles })
    );
    expect(buildSharedStylesCascadeModel(differentModels)).toBeNull();
  });

  it("edits named-style origin layers through styles write targets", () => {
    const source = String.raw`\begin{tikzpicture}[accent/.style={draw=red}]
  \draw[accent] (0,0) -- (1,0);
\end{tikzpicture}`;

    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const namedStyleSection = model.sections.find((section) => section.kind === "named-style");
    expect(namedStyleSection).toBeDefined();
    const declaration = namedStyleSection?.declarations.find((row) => row.propertyId === "stroke-color");
    expect(declaration?.writeTargets[0]?.elementId).toContain("__style_source__:");

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: declaration!.writeTargets[0]!.elementId,
      level: "named-style",
      key: "draw",
      value: "blue"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected success");
    }
    expect(result.newSource).toContain("accent/.style={draw=blue}");
  });

  it("renaming a flag-style key preserves it as a flag", () => {
    const writeTarget = {
      mode: "setProperty" as const,
      elementId: "source-1",
      level: "command" as const,
      key: "",
      writable: true
    };

    const actions = planStylesRenamePropertyActions([writeTarget], "dashed", "dotted", "");
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      kind: "setProperty",
      key: "dashed",
      value: ""
    });
    expect(actions[1]).toMatchObject({
      kind: "setProperty",
      key: "dotted",
      value: "true"
    });
  });
});
