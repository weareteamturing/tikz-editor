import { describe, expect, it } from "vitest";
import type { EditAction } from "../packages/core/src/edit/actions.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { buildFillModeSetPropertyMutations } from "../packages/core/src/edit/inspector.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import {
  buildSharedStylesCascadeModel,
  buildStylesCascadeModel,
  planStylesRemovePropertyActions,
  planStylesRenamePropertyActions,
  planStylesSetPropertyActions
} from "../packages/core/src/edit/styles-cascade.js";

function firstPath(source: string) {
  const rendered = renderTikzToSvg(source);
  const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
  if (!element || element.kind !== "Path") {
    throw new Error("Expected a path element");
  }
  return { rendered, element };
}

function applyActionsToSource(source: string, actions: EditAction[]): string {
  let current = source;
  for (const action of actions) {
    const result = applyEditAction(current, [], action);
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error(`Expected success, got ${result.kind}`);
    }
    current = result.newSource;
  }
  return current;
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
});
