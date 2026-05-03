import { describe, expect, it } from "vitest";
import type { EditAction } from "../packages/core/src/edit/actions.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { buildFillModeSetPropertyMutations } from "../packages/core/src/edit/property-write-builders.js";
import type { EditParseOptions } from "../packages/core/src/edit/parse-options.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import {
  buildSharedStylesCascadeModel,
  buildStylesCascadeModel,
  planStylesRemovePropertyActions,
  planStylesRenamePropertyActions,
  planStylesSetPropertyActions,
  planStylesTogglePropertyActions
} from "../packages/core/src/edit/styles-cascade.js";

function firstPath(source: string) {
  const rendered = renderTikzToSvg(source);
  const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
  if (!element || element.kind !== "Path") {
    throw new Error("Expected a path element");
  }
  return { rendered, element };
}

function firstText(source: string) {
  const rendered = renderTikzToSvg(source);
  const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
  if (!element || element.kind !== "Text") {
    throw new Error("Expected a text element");
  }
  return { rendered, element };
}

function applyActionsToSource(source: string, actions: EditAction[], parseOptions?: EditParseOptions): string {
  let current = source;
  for (const action of actions) {
    const result = applyEditAction(current, [], action, parseOptions ? { parseOptions } : undefined);
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error(`Expected success, got ${result.kind}`);
    }
    current = result.newSource;
  }
  return current;
}

function commandSourceTexts(source: string): string[] {
  const { rendered, element } = firstPath(source);
  const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
  const commandSection = model.sections.find((section) => section.kind === "command");
  return (commandSection?.declarations ?? []).map((declaration) => declaration.sourceText.trim());
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
      elementId: declaration!.writeTargets[0].elementId,
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

describe("styles cascade integration edits", () => {
  it("renames a flag option from dashed to dotted", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[dashed,draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((s) => s.declarations).find((d) => d.sourceText.trim() === "dashed");
    expect(declaration).toBeDefined();

    const updated = applyActionsToSource(
      source,
      planStylesRenamePropertyActions(declaration!.writeTargets, "dashed", "dotted", "")
    );

    expect(updated).toContain("dotted");
    expect(updated).toContain("draw=red");
    expect(updated).not.toContain("dashed");
  });

  it("renames key-value draw=red to fill=red while preserving value", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((s) => s.declarations).find((d) => d.sourceText.includes("draw=red"));
    expect(declaration).toBeDefined();

    const updated = applyActionsToSource(
      source,
      planStylesRenamePropertyActions(declaration!.writeTargets, "draw", "fill", "red")
    );

    expect(updated).toContain("fill=red");
    expect(updated).not.toContain("draw=red");
    expect(updated).toContain("line width=1pt");
  });

  it("removes draw=red without disturbing other options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt,dashed] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((s) => s.declarations).find((d) => d.sourceText.includes("draw=red"));
    expect(declaration).toBeDefined();

    const updated = applyActionsToSource(source, planStylesRemovePropertyActions(declaration!.writeTargets, "draw"));

    expect(updated).not.toContain("draw=red");
    expect(updated).toContain("line width=1pt");
    expect(updated).toContain("dashed");
  });

  it("toggles a declaration off by serializing it as a commented option line", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((section) => section.declarations).find((row) => row.sourceText.includes("draw=red"));
    expect(declaration).toBeDefined();

    const updated = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(declaration!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: declaration!.sourceText
      })
    );

    expect(updated).toContain("% draw=red,");
    expect(updated).toContain("line width=1pt");
    expect(updated).toContain("\\draw[\n  % draw=red,\n  line width=1pt\n]");
    expect(updated).toContain("\\draw[");
  });

  it("toggles a commented declaration back on", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[
    % draw=red,
    line width=1pt
  ] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((section) => section.declarations).find((row) => row.propertyId === "stroke-color");
    expect(declaration).toBeDefined();
    expect(declaration?.status).toBe("disabled");

    const updated = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(declaration!.writeTargets, {
        key: "draw",
        mode: "enable",
        sourceText: declaration!.sourceText
      })
    );

    expect(updated).toContain("draw=red");
    expect(updated).not.toContain("% draw=red,");
    expect(updated).toContain("line width=1pt");
  });

  it("toggles declarations inside named-style bodies", () => {
    const source = String.raw`\begin{tikzpicture}[accent/.style={draw=red,fill=blue}]
  \draw[accent] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const namedStyleSection = model.sections.find((section) => section.kind === "named-style");
    const declaration = namedStyleSection?.declarations.find((row) => row.propertyId === "stroke-color");
    expect(declaration).toBeDefined();

    const updated = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(declaration!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: declaration!.sourceText
      })
    );

    expect(updated).toContain("% draw=red,");
    expect(updated).toContain("fill=blue");
    expect(updated).toContain("accent/.style={");
  });

  it("toggles fill declarations inside every node style layers", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \node (A) at (-1, -1) {A};
\end{tikzpicture}`;
    const { rendered, element } = firstText(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const everyNodeSection = model.sections.find((section) => section.title === "every node");
    const fillDeclaration = everyNodeSection?.declarations.find((row) => row.propertyId === "fill-color");
    expect(fillDeclaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(fillDeclaration!.writeTargets, {
        key: "fill",
        mode: "disable",
        sourceText: fillDeclaration!.sourceText
      })
    );

    expect(disabled).toContain("every node/.style={");
    expect(disabled).toContain("% fill=blue!10,");
    expect(disabled).toContain("every node/.style={\n  % fill=blue!10,\n}");

    const { rendered: disabledRendered, element: disabledElement } = firstText(disabled);
    const disabledModel = buildStylesCascadeModel(disabledElement, {
      source: disabled,
      editHandles: disabledRendered.semantic.editHandles
    });
    const disabledFill = disabledModel.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.propertyId === "fill-color" && row.status === "disabled");
    expect(disabledFill).toBeDefined();
  });

  it("preserves existing multiline option indentation when toggling", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[
    draw=red,
    line width=1pt
  ] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const drawDeclaration = model.sections.flatMap((section) => section.declarations).find((row) => row.propertyId === "stroke-color");
    expect(drawDeclaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(drawDeclaration!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: drawDeclaration!.sourceText
      })
    );

    expect(disabled).toContain("\\draw[\n    % draw=red,\n    line width=1pt\n]");
  });

  it("uses configured indent size when reflowing single-line toggles", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const drawDeclaration = model.sections.flatMap((section) => section.declarations).find((row) => row.propertyId === "stroke-color");
    expect(drawDeclaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(drawDeclaration!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: drawDeclaration!.sourceText
      }),
      { indentSize: 4 }
    );

    expect(disabled).toContain("\\draw[\n    % draw=red,\n    line width=1pt\n]");
  });

  it("toggles fill declarations inside every-shape style layers", () => {
    const source = String.raw`\begin{tikzpicture}[every rectangle node/.style={fill=green!20}]
  \node[rectangle] (R) at (0, 0) {R};
\end{tikzpicture}`;
    const { rendered, element } = firstText(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const everyRectangleSection = model.sections.find((section) => section.title === "every rectangle node");
    const fillDeclaration = everyRectangleSection?.declarations.find((row) => row.propertyId === "fill-color");
    expect(fillDeclaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(fillDeclaration!.writeTargets, {
        key: "fill",
        mode: "disable",
        sourceText: fillDeclaration!.sourceText
      })
    );

    expect(disabled).toContain("every rectangle node/.style={");
    expect(disabled).toContain("% fill=green!20,");
  });

  it("toggles fill declarations inside scope layers", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[fill=yellow!30]
    \node (S) at (0,0) {S};
  \end{scope}
\end{tikzpicture}`;
    const { rendered, element } = firstText(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const scopeSection = model.sections.find((section) => section.kind === "scope");
    const fillDeclaration = scopeSection?.declarations.find((row) => row.propertyId === "fill-color");
    expect(fillDeclaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(fillDeclaration!.writeTargets, {
        key: "fill",
        mode: "disable",
        sourceText: fillDeclaration!.sourceText
      })
    );

    expect(disabled).toContain("\\begin{scope}[");
    expect(disabled).toContain("% fill=yellow!30,");
  });

  it.each([
    {
      placement: "first",
      source: String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt,dashed] (0,0) -- (1,0);
\end{tikzpicture}`,
      before: ["% draw=red,", "line width=1pt", "dashed"]
    },
    {
      placement: "middle",
      source: String.raw`\begin{tikzpicture}
  \draw[line width=1pt,draw=red,dashed] (0,0) -- (1,0);
\end{tikzpicture}`,
      before: ["line width=1pt", "% draw=red,", "dashed"]
    },
    {
      placement: "last",
      source: String.raw`\begin{tikzpicture}
  \draw[line width=1pt,dashed,draw=red] (0,0) -- (1,0);
\end{tikzpicture}`,
      before: ["line width=1pt", "dashed", "% draw=red,"]
    },
    {
      placement: "only",
      source: String.raw`\begin{tikzpicture}
  \draw[draw=red] (0,0) -- (1,0);
\end{tikzpicture}`,
      before: ["% draw=red,"]
    }
  ])("toggles key-value declarations in $placement position", ({ source, before }) => {
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((section) => section.declarations).find((row) => row.sourceText.includes("draw=red"));
    expect(declaration).toBeDefined();

    const disabledSource = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(declaration!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: declaration!.sourceText
      })
    );
    expect(disabledSource).toContain("% draw=red,");

    const indexes = before.map((token) => disabledSource.indexOf(token));
    for (const index of indexes) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    for (let index = 1; index < indexes.length; index += 1) {
      expect(indexes[index]).toBeGreaterThan(indexes[index - 1]);
    }

    const { rendered: disabledRendered, element: disabledElement } = firstPath(disabledSource);
    const disabledModel = buildStylesCascadeModel(disabledElement, {
      source: disabledSource,
      editHandles: disabledRendered.semantic.editHandles
    });
    const disabledDeclaration = disabledModel.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.propertyId === "stroke-color" && row.status === "disabled");
    expect(disabledDeclaration).toBeDefined();

    const reenabledSource = applyActionsToSource(
      disabledSource,
      planStylesTogglePropertyActions(disabledDeclaration!.writeTargets, {
        key: "draw",
        mode: "enable",
        sourceText: disabledDeclaration!.sourceText
      })
    );

    expect(reenabledSource).not.toContain("% draw=red,");
    expect(reenabledSource).toContain("draw=red");
  });

  it("toggles flag-like options (draw, rounded corners) without values", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw,rounded corners,line width=1pt] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const drawFlag = model.sections.flatMap((section) => section.declarations).find((row) => row.sourceText.trim() === "draw");
    const roundedCornersFlag = model.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.sourceText.trim() === "rounded corners");
    expect(drawFlag).toBeDefined();
    expect(roundedCornersFlag).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      [
        ...planStylesTogglePropertyActions(drawFlag!.writeTargets, {
          key: "draw",
          mode: "disable",
          sourceText: drawFlag!.sourceText
        }),
        ...planStylesTogglePropertyActions(roundedCornersFlag!.writeTargets, {
          key: "rounded corners",
          mode: "disable",
          sourceText: roundedCornersFlag!.sourceText
        })
      ]
    );

    expect(disabled).toContain("% draw,");
    expect(disabled).toContain("% rounded corners,");
    expect(disabled).toContain("line width=1pt");

    const { rendered: disabledRendered, element: disabledElement } = firstPath(disabled);
    const disabledModel = buildStylesCascadeModel(disabledElement, {
      source: disabled,
      editHandles: disabledRendered.semantic.editHandles
    });
    const disabledDraw = disabledModel.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.sourceText.trim() === "draw" && row.status === "disabled");
    const disabledRoundedCorners = disabledModel.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.sourceText.trim() === "rounded corners" && row.status === "disabled");
    expect(disabledDraw).toBeDefined();
    expect(disabledRoundedCorners).toBeDefined();
  });

  it("toggles node option declarations (text element selection)", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,rounded corners,font=\small] at (0,0) {A};
\end{tikzpicture}`;
    const { rendered, element } = firstText(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.sourceText.trim() === "rounded corners");
    expect(declaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(declaration!.writeTargets, {
        key: "rounded corners",
        mode: "disable",
        sourceText: declaration!.sourceText
      })
    );

    expect(disabled).toContain("% rounded corners,");
    expect(disabled).toContain("draw,");
    expect(disabled).toContain("font=\\small");
  });

  it("surfaces commented-only node options as disabled declarations", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[
    % draw=red,
  ] at (-0.2,3) {node};
\end{tikzpicture}`;
    const { rendered, element } = firstText(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const commandSection = model.sections.find((section) => section.kind === "command");
    const drawDeclaration = commandSection?.declarations.find(
      (row) => row.sourceText.trim() === "draw=red" && row.status === "disabled"
    );
    expect(drawDeclaration).toBeDefined();
  });

  it("preserves duplicate keys by only disabling the targeted declaration", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,draw=blue,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((section) => section.declarations).find((row) => row.sourceText.trim() === "draw=red");
    expect(declaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(declaration!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: declaration!.sourceText
      })
    );

    expect(disabled).toContain("% draw=red,");
    expect(disabled).toContain("draw=blue");
    expect(disabled).toContain("line width=1pt");

    const { rendered: disabledRendered, element: disabledElement } = firstPath(disabled);
    const disabledModel = buildStylesCascadeModel(disabledElement, {
      source: disabled,
      editHandles: disabledRendered.semantic.editHandles
    });
    const commandSection = disabledModel.sections.find((section) => section.kind === "command");
    const strokeDeclarations = (commandSection?.declarations ?? []).filter((row) => row.propertyId === "stroke-color");
    expect(strokeDeclarations.some((row) => row.status === "disabled")).toBe(true);
    expect(strokeDeclarations.some((row) => row.status === "active")).toBe(true);
  });

  it("keeps command declaration order stable when toggling a middle property", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,rounded corners,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const orderBefore = commandSourceTexts(source);
    expect(orderBefore).toEqual(["draw=red", "rounded corners", "line width=1pt"]);

    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const roundedCorners = model.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.sourceText.trim() === "rounded corners");
    expect(roundedCorners).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(roundedCorners!.writeTargets, {
        key: "rounded corners",
        mode: "disable",
        sourceText: roundedCorners!.sourceText
      })
    );
    const orderAfterDisable = commandSourceTexts(disabled);
    expect(orderAfterDisable).toEqual(["draw=red", "rounded corners", "line width=1pt"]);
  });

  it("surfaces disabled declarations and keeps lower layers active", () => {
    const source = String.raw`\begin{tikzpicture}[draw=blue]
  \draw[
    % draw=red,
    line width=1pt
  ] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const commandSection = model.sections.find((section) => section.kind === "command");
    const commandStroke = commandSection?.declarations.find((row) => row.propertyId === "stroke-color");
    expect(commandStroke).toBeDefined();
    expect(commandStroke?.status).toBe("disabled");

    const inheritedStroke = model.sections
      .filter((section) => section.kind !== "command")
      .flatMap((section) => section.declarations)
      .find((row) => row.propertyId === "stroke-color");
    expect(inheritedStroke).toBeDefined();
    expect(inheritedStroke?.status).toBe("active");
  });

  it("renames unsupported raw options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[foo=bar,draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const rawDecl = model.sections.flatMap((s) => s.declarations).find((d) => d.sourceText.includes("foo=bar"));
    expect(rawDecl).toBeDefined();

    const updated = applyActionsToSource(
      source,
      planStylesRenamePropertyActions(rawDecl!.writeTargets, "foo", "baz", "bar")
    );

    expect(updated).toContain("baz=bar");
    expect(updated).not.toContain("foo=bar");
  });

  it("deletes unsupported raw options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[foo=bar,draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const rawDecl = model.sections.flatMap((s) => s.declarations).find((d) => d.sourceText.includes("foo=bar"));
    expect(rawDecl).toBeDefined();

    const updated = applyActionsToSource(source, planStylesRemovePropertyActions(rawDecl!.writeTargets, "foo"));

    expect(updated).not.toContain("foo=bar");
    expect(updated).toContain("draw=red");
  });

  it("applies fill-mode transitions with clear keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=blue,pattern=north east lines] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const commandSection = model.sections.find((s) => s.kind === "command");
    expect(commandSection).toBeDefined();

    const mutations = buildFillModeSetPropertyMutations("gradient", {});
    const actions = mutations.flatMap((mutation) =>
      planStylesSetPropertyActions(commandSection!.writeTargets, mutation)
    );

    const updated = applyActionsToSource(source, actions);

    expect(updated).toContain("shade");
    expect(updated).toContain("shading=");
    expect(updated).not.toContain("pattern=north east lines");
  });

  it("applies shared-cascade edits to all selected elements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[dashed,draw=red] (0,0) -- (1,0);
  \draw[dashed,draw=red] (0,1) -- (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const paths = rendered.semantic.scene.elements.filter((entry) => entry.kind === "Path");
    expect(paths).toHaveLength(2);
    const models = paths.map((entry) =>
      buildStylesCascadeModel(entry, { source, editHandles: rendered.semantic.editHandles })
    );
    const shared = buildSharedStylesCascadeModel(models);
    expect(shared).not.toBeNull();

    const dashedDecl = shared!.sections.flatMap((s) => s.declarations).find((d) => d.sourceText.trim() === "dashed");
    expect(dashedDecl).toBeDefined();
    expect(dashedDecl!.writeTargets).toHaveLength(2);

    const updated = applyActionsToSource(
      source,
      planStylesRenamePropertyActions(dashedDecl!.writeTargets, "dashed", "dotted", "")
    );

    expect(updated).not.toContain("dashed");
    expect((updated.match(/dotted/g) ?? []).length).toBe(2);
  });

  it("applies shared-cascade toggle edits to all selected elements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
  \draw[draw=red,line width=1pt] (0,1) -- (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const paths = rendered.semantic.scene.elements.filter((entry) => entry.kind === "Path");
    expect(paths).toHaveLength(2);
    const models = paths.map((entry) =>
      buildStylesCascadeModel(entry, { source, editHandles: rendered.semantic.editHandles })
    );
    const shared = buildSharedStylesCascadeModel(models);
    expect(shared).not.toBeNull();

    const drawDecl = shared!.sections.flatMap((section) => section.declarations).find((row) => row.propertyId === "stroke-color");
    expect(drawDecl).toBeDefined();
    expect(drawDecl!.writeTargets).toHaveLength(2);

    const updated = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(drawDecl!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: drawDecl!.sourceText
      })
    );

    expect((updated.match(/% draw=red,/g) ?? []).length).toBe(2);
  });

  it("keeps generated node foreach style layers read-only", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) node foreach \p in {0.25,0.75} [pos=\p,fill=red] {\p};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text" && entry.text === "0.25");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected generated node foreach text");
    }

    const model = buildStylesCascadeModel(text, { source, editHandles: rendered.semantic.editHandles });
    const command = model.sections.find((section) => section.kind === "command");
    expect(command?.writable).toBe(false);
    expect(command?.readOnlyReason).toContain("Generated style layers");
    const fill = command?.declarations.find((declaration) => declaration.propertyId === "fill-color");
    expect(fill?.sourceText).toBe("fill=red");
    expect(fill?.writeTargets).toHaveLength(0);
  });
});
