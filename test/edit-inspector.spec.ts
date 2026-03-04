import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../src/render/index.js";
import { applyEditAction } from "../src/edit/actions.js";
import { parseTikz } from "../src/parser/index.js";
import {
  buildArrowTipSetPropertyMutation,
  buildFillModeSetPropertyMutations,
  buildFillPatternOptionSetPropertyMutation,
  buildFillPatternSetPropertyMutation,
  buildFillShadingSetPropertyMutations,
  buildNodeFontSetPropertyMutation,
  buildNodeInnerSepSetPropertyMutation,
  buildNodeShapeSetPropertyMutation,
  buildPathMorphingDecorationSetPropertyMutations,
  buildRoundedCornersSetPropertyMutation,
  buildTransformSetPropertyMutations,
  getInspectorDescriptor,
  resolveTransformInspectorValues,
  TIKZPICTURE_GLOBAL_TARGET_ID
} from "../src/edit/inspector.js";

describe("getInspectorDescriptor", () => {
  it("returns computed style sections for a path element", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue,fill=yellow,line width=0.8pt,->] (0,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    expect(descriptor.elementKind).toBe("path");
    expect(descriptor.writeTargetId).toBe("path:0");

    const strokeSection = descriptor.sections.find((section) => section.id === "stroke");
    expect(strokeSection).toBeDefined();
    if (!strokeSection) {
      throw new Error("Expected stroke section");
    }

    const strokeColor = strokeSection.properties.find((property) => property.kind === "color");
    expect(strokeColor).toBeDefined();
    if (!strokeColor || strokeColor.kind !== "color") {
      throw new Error("Expected stroke color property");
    }
    expect(strokeColor.value).toBe("blue");
    expect(strokeColor.write.writable).toBe(true);

    const lineWidth = strokeSection.properties.find((property) => property.kind === "lineWidth");
    expect(lineWidth).toBeDefined();
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected line width property");
    }
    expect(lineWidth.value).toBeCloseTo(0.8, 6);
    expect(lineWidth.presetLabel).toBe("thick");

    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }
    const pathMorphingProperty = pathSection.properties.find(
      (property) => property.kind === "pathMorphingDecoration"
    );
    expect(pathMorphingProperty).toBeDefined();
    if (!pathMorphingProperty || pathMorphingProperty.kind !== "pathMorphingDecoration") {
      throw new Error("Expected path morphing property");
    }
    expect(pathMorphingProperty.value).toBe("none");

    const arrowProperties = pathSection.properties.filter((property) => property.kind === "arrowTip");
    expect(arrowProperties).toHaveLength(2);
    const beginArrow = arrowProperties.find(
      (property) => property.kind === "arrowTip" && property.side === "start"
    );
    const endArrow = arrowProperties.find(
      (property) => property.kind === "arrowTip" && property.side === "end"
    );
    if (!beginArrow || beginArrow.kind !== "arrowTip") {
      throw new Error("Expected begin arrow property");
    }
    if (!endArrow || endArrow.kind !== "arrowTip") {
      throw new Error("Expected end arrow property");
    }
    expect(beginArrow.value).toBe("none");
    expect(endArrow.value).toBe("arrow");
    expect(endArrow.write.arrowContext.startRaw).toBe("");
    expect(endArrow.write.arrowContext.endRaw).toBe(">");
    expect(endArrow.write.arrowContext.clearKeys).toContain("->");
  });

  it("replaces geometric transform fields with canonical TikZ transform controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[scale=2,shift={(2pt,3pt)},rotate=15] (0,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const transformSection = descriptor.sections.find((section) => section.id === "transform");
    expect(transformSection).toBeDefined();
    if (!transformSection) {
      throw new Error("Expected transform section");
    }

    const transformIds = transformSection.properties.map((property) => property.id);
    expect(transformIds).toEqual(["xshift", "yshift", "xscale", "yscale", "rotate"]);
    expect(transformIds).not.toContain("x");
    expect(transformIds).not.toContain("y");
    expect(transformIds).not.toContain("width");
    expect(transformIds).not.toContain("height");
  });

  it("resolves canonical transform values from scale and shift shorthands", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[scale=2,shift={(2pt,3pt)},rotate=15] (0,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const transformSection = descriptor.sections.find((section) => section.id === "transform");
    expect(transformSection).toBeDefined();
    if (!transformSection) {
      throw new Error("Expected transform section");
    }

    const values = new Map<string, number>();
    for (const property of transformSection.properties) {
      if (property.kind !== "number") {
        continue;
      }
      values.set(property.id, property.value);
    }

    expect(values.get("xscale")).toBeCloseTo(2, 6);
    expect(values.get("yscale")).toBeCloseTo(2, 6);
    expect(values.get("xshift")).toBeCloseTo(2, 6);
    expect(values.get("yshift")).toBeCloseTo(3, 6);
    expect(values.get("rotate")).toBeCloseTo(15, 6);
  });

  it("resolves global tikzpicture transform values for inspector empty state", () => {
    const source = String.raw`\begin{tikzpicture}[scale=2, yscale=3]
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const values = resolveTransformInspectorValues(source, TIKZPICTURE_GLOBAL_TARGET_ID);
    expect(values.xscale).toBeCloseTo(2, 6);
    expect(values.yscale).toBeCloseTo(3, 6);
  });

  it("keeps declared color alias syntax for color flags", () => {
    const source = String.raw`\begin{tikzpicture}
  \definecolor{mypink}{rgb}{0.858, 0.188, 0.478}
  \draw[mypink] (-2.5, 2.5) -- (2.5, 2.5);
  \draw[draw=mypink] (-2.55, 2.5) -- (2.45, 2.5);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const pathElements = rendered.semantic.scene.elements
      .filter((entry) => entry.kind === "Path")
      .sort((left, right) => left.sourceSpan.from - right.sourceSpan.from);
    expect(pathElements.length).toBeGreaterThanOrEqual(2);

    const first = pathElements[0];
    const second = pathElements[1];
    if (!first || !second) {
      throw new Error("Expected two path elements");
    }

    const firstDescriptor = getInspectorDescriptor(first, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const secondDescriptor = getInspectorDescriptor(second, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    const firstStrokeSection = firstDescriptor.sections.find((section) => section.id === "stroke");
    const secondStrokeSection = secondDescriptor.sections.find((section) => section.id === "stroke");
    if (!firstStrokeSection || !secondStrokeSection) {
      throw new Error("Expected stroke section");
    }

    const firstStrokeColor = firstStrokeSection.properties.find((property) => property.kind === "color");
    const secondStrokeColor = secondStrokeSection.properties.find((property) => property.kind === "color");
    if (!firstStrokeColor || firstStrokeColor.kind !== "color") {
      throw new Error("Expected first stroke color property");
    }
    if (!secondStrokeColor || secondStrokeColor.kind !== "color") {
      throw new Error("Expected second stroke color property");
    }

    expect(firstStrokeColor.syntaxValue).toBe("mypink");
    expect(secondStrokeColor.syntaxValue).toBe("mypink");
  });

  it("does not expose arrow tips for closed paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue,->] (0,0) -- (2,0) -- cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }
    const arrowProperties = pathSection.properties.filter((property) => property.kind === "arrowTip");
    expect(arrowProperties).toHaveLength(0);
  });

  it("shows grid controls for a single grid operation with keyword-targeted writes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid (2,2);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const sectionIds = descriptor.sections.map((section) => section.id);
    expect(sectionIds).toContain("grid");
    expect(sectionIds).toContain("stroke");
    expect(sectionIds.indexOf("grid")).toBeLessThan(sectionIds.indexOf("stroke"));

    const gridSection = descriptor.sections.find((section) => section.id === "grid");
    expect(gridSection).toBeDefined();
    if (!gridSection) {
      throw new Error("Expected grid section");
    }

    const step = gridSection.properties.find((property) => property.id === "grid-step");
    const xstep = gridSection.properties.find((property) => property.id === "grid-xstep");
    const ystep = gridSection.properties.find((property) => property.id === "grid-ystep");
    if (!step || step.kind !== "number") {
      throw new Error("Expected grid step number property");
    }
    if (!xstep || xstep.kind !== "number") {
      throw new Error("Expected grid xstep number property");
    }
    if (!ystep || ystep.kind !== "number") {
      throw new Error("Expected grid ystep number property");
    }

    expect(step.value).toBeCloseTo(1, 6);
    expect(xstep.value).toBeCloseTo(1, 6);
    expect(ystep.value).toBeCloseTo(1, 6);
    expect(step.unit).toBe("cm");
    expect(xstep.unit).toBe("cm");
    expect(ystep.unit).toBe("cm");
    expect(step.step).toBeCloseTo(0.1, 6);
    expect(xstep.step).toBeCloseTo(0.1, 6);
    expect(ystep.step).toBeCloseTo(0.1, 6);
    expect(step.clearKeys).toContain("xstep");
    expect(step.clearKeys).toContain("ystep");

    const parsed = parseTikz(source);
    const statement = parsed.figure.body.find((entry) => entry.kind === "Path");
    if (!statement || statement.kind !== "Path") {
      throw new Error("Expected path statement");
    }
    const gridKeyword = statement.items.find((item) => item.kind === "PathKeyword" && item.keyword === "grid");
    if (!gridKeyword || gridKeyword.kind !== "PathKeyword") {
      throw new Error("Expected grid keyword");
    }

    if (step.write.mode !== "setProperty" || xstep.write.mode !== "setProperty" || ystep.write.mode !== "setProperty") {
      throw new Error("Expected setProperty writes for grid properties");
    }
    expect(step.write.elementId).toBe(gridKeyword.id);
    expect(xstep.write.elementId).toBe(gridKeyword.id);
    expect(ystep.write.elementId).toBe(gridKeyword.id);
    expect(step.write.key).toBe("step");
    expect(xstep.write.key).toBe("xstep");
    expect(ystep.write.key).toBe("ystep");

    const mutation = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: step.write.elementId,
      level: step.write.level,
      key: step.write.key,
      value: "2.5cm",
      clearKeys: step.clearKeys
    });
    expect(mutation.kind).toBe("success");
    if (mutation.kind !== "success") {
      throw new Error("Expected successful grid step mutation");
    }
    expect(mutation.newSource).toContain("\\draw (0,0) grid[step=2.5cm] (2,2);");
  });

  it("reads explicit grid xstep/ystep keyword options into cm inspector values", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid[xstep=2mm, y step=3mm] (2,2);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const gridSection = descriptor.sections.find((section) => section.id === "grid");
    expect(gridSection).toBeDefined();
    if (!gridSection) {
      throw new Error("Expected grid section");
    }

    const step = gridSection.properties.find((property) => property.id === "grid-step");
    const xstep = gridSection.properties.find((property) => property.id === "grid-xstep");
    const ystep = gridSection.properties.find((property) => property.id === "grid-ystep");
    if (!step || step.kind !== "number" || !xstep || xstep.kind !== "number" || !ystep || ystep.kind !== "number") {
      throw new Error("Expected grid number properties");
    }

    expect(step.value).toBeCloseTo(1, 6);
    expect(xstep.value).toBeCloseTo(0.2, 6);
    expect(ystep.value).toBeCloseTo(0.3, 6);
  });

  it("hides grid controls when a path statement contains multiple grid operations", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid (1,1) (2,2) grid (3,3);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.sections.some((section) => section.id === "grid")).toBe(false);
  });

  it("marks foreach-expanded elements as read-only", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1} {
    \draw (\x,0) -- (\x,1);
  }
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    expect(descriptor.readOnlyReason?.toLowerCase()).toContain("foreach");

    const firstSetPropertyControl = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind !== "number");
    expect(firstSetPropertyControl).toBeDefined();
    if (!firstSetPropertyControl || firstSetPropertyControl.kind === "number") {
      throw new Error("Expected a setProperty-driven control");
    }
    expect(firstSetPropertyControl.write.writable).toBe(false);
  });

  it("marks non-curated tip kinds as custom", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[arrows={Rays-}] (0,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }

    const beginArrow = pathSection.properties.find(
      (property) => property.kind === "arrowTip" && property.side === "start"
    );
    const endArrow = pathSection.properties.find(
      (property) => property.kind === "arrowTip" && property.side === "end"
    );
    if (!beginArrow || beginArrow.kind !== "arrowTip") {
      throw new Error("Expected begin arrow property");
    }
    if (!endArrow || endArrow.kind !== "arrowTip") {
      throw new Error("Expected end arrow property");
    }

    expect(beginArrow.value).toBe("custom");
    expect(endArrow.value).toBe("none");
  });

  it("builds shorthand mutations for default arrow combinations", () => {
    const mutation = buildArrowTipSetPropertyMutation(
      {
        startRaw: "",
        endRaw: ">",
        clearKeys: ["arrows", "->"]
      },
      "start",
      "arrow"
    );
    expect(mutation.key).toBe("<->");
    expect(mutation.value).toBe("true");
    expect(mutation.clearKeys).toContain("arrows");
  });

  it("canonicalizes xscale edits by materializing xscale and yscale while removing scale shorthand", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[scale=2,blue] (0,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const transformSection = descriptor.sections.find((section) => section.id === "transform");
    expect(transformSection).toBeDefined();
    if (!transformSection) {
      throw new Error("Expected transform section");
    }

    const xscale = transformSection.properties.find((property) => property.id === "xscale");
    expect(xscale).toBeDefined();
    if (!xscale || xscale.kind !== "number" || !xscale.write?.transformContext) {
      throw new Error("Expected xscale number property with transform context");
    }

    const mutations = buildTransformSetPropertyMutations(xscale.write.transformContext.values, "xscale", 3);
    expect(mutations).toHaveLength(2);

    let updated = source;
    for (const mutation of mutations) {
      const result = applyEditAction(updated, [], {
        kind: "setProperty",
        elementId: xscale.write.elementId,
        level: xscale.write.level,
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful setProperty transform mutation");
      }
      updated = result.newSource;
    }

    expect(updated).toContain("xscale=3");
    expect(updated).toContain("yscale=2");
    expect(updated).not.toMatch(/\bscale\s*=/);
  });

  it("does not materialize default companion scale when editing only yscale", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;
    const values = resolveTransformInspectorValues(source, TIKZPICTURE_GLOBAL_TARGET_ID);
    const mutations = buildTransformSetPropertyMutations(values, "yscale", 2);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      key: "yscale",
      value: "2"
    });

    let updated = source;
    for (const mutation of mutations) {
      const result = applyEditAction(updated, [], {
        kind: "setProperty",
        elementId: TIKZPICTURE_GLOBAL_TARGET_ID,
        level: "command",
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful global setProperty transform mutation");
      }
      updated = result.newSource;
    }

    expect(updated).toContain("\\begin{tikzpicture}[yscale=2]");
    expect(updated).not.toContain("xscale=1");
  });

  it("canonicalizes xshift edits by materializing xshift and yshift while removing shift shorthand", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[shift={(2pt,3pt)},blue] (0,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const transformSection = descriptor.sections.find((section) => section.id === "transform");
    expect(transformSection).toBeDefined();
    if (!transformSection) {
      throw new Error("Expected transform section");
    }

    const xshift = transformSection.properties.find((property) => property.id === "xshift");
    expect(xshift).toBeDefined();
    if (!xshift || xshift.kind !== "number" || !xshift.write?.transformContext) {
      throw new Error("Expected xshift number property with transform context");
    }

    const mutations = buildTransformSetPropertyMutations(xshift.write.transformContext.values, "xshift", 5);
    expect(mutations).toHaveLength(2);

    let updated = source;
    for (const mutation of mutations) {
      const result = applyEditAction(updated, [], {
        kind: "setProperty",
        elementId: xshift.write.elementId,
        level: xshift.write.level,
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful setProperty transform mutation");
      }
      updated = result.newSource;
    }

    expect(updated).toContain("xshift=5pt");
    expect(updated).toContain("yshift=3pt");
    expect(updated).not.toMatch(/\bshift\s*=/);
  });

  it("builds rotate mutations without touching scale or shift keys", () => {
    const mutations = buildTransformSetPropertyMutations(
      { xshift: 2, yshift: 3, xscale: 2, yscale: 2, rotate: 15 },
      "rotate",
      20
    );

    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      key: "rotate",
      value: "20"
    });
  });

  it("builds path morphing decoration mutations", () => {
    const enabledMutations = buildPathMorphingDecorationSetPropertyMutations("zigzag");
    expect(enabledMutations).toHaveLength(2);
    expect(enabledMutations[0]).toMatchObject({
      key: "decorate",
      value: "true"
    });
    expect(enabledMutations[1]).toMatchObject({
      key: "decoration",
      value: "zigzag"
    });
    expect(enabledMutations[0]?.clearKeys).toContain("decoration");

    const disabledMutations = buildPathMorphingDecorationSetPropertyMutations("none");
    expect(disabledMutations).toHaveLength(1);
    expect(disabledMutations[0]).toMatchObject({
      key: "decorate",
      value: "false"
    });
    expect(disabledMutations[0]?.clearKeys).toContain("decoration");
  });

  it("marks out-of-set path morphing decorations as custom", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[decorate,decoration=waves] (0,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }
    const pathMorphingProperty = pathSection.properties.find(
      (property) => property.kind === "pathMorphingDecoration"
    );
    expect(pathMorphingProperty).toBeDefined();
    if (!pathMorphingProperty || pathMorphingProperty.kind !== "pathMorphingDecoration") {
      throw new Error("Expected path morphing property");
    }
    expect(pathMorphingProperty.value).toBe("custom");
  });

  it("preserves the untouched custom side when editing the opposite side", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue,arrows={Stealth[length=10pt]-Latex}] (0,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }
    const endArrow = pathSection.properties.find(
      (property) => property.kind === "arrowTip" && property.side === "end"
    );
    expect(endArrow).toBeDefined();
    if (!endArrow || endArrow.kind !== "arrowTip") {
      throw new Error("Expected end arrow property");
    }

    const mutation = buildArrowTipSetPropertyMutation(endArrow.write.arrowContext, "end", "none");
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: endArrow.write.elementId,
      level: endArrow.write.level,
      key: mutation.key,
      value: mutation.value,
      clearKeys: mutation.clearKeys
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("arrows=Stealth[length=10pt]-");
    expect(result.newSource).not.toContain("Latex");
  });

  it("shows line cap for open paths but hides line join when there are no joins", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const strokeSection = descriptor.sections.find((section) => section.id === "stroke");
    expect(strokeSection).toBeDefined();
    if (!strokeSection) {
      throw new Error("Expected stroke section");
    }

    const hasLineCap = strokeSection.properties.some((property) => property.kind === "lineCap");
    const hasLineJoin = strokeSection.properties.some((property) => property.kind === "lineJoin");
    expect(hasLineCap).toBe(true);
    expect(hasLineJoin).toBe(false);
  });

  it("hides fill controls for open single-segment paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (-2.5, 2.5) -- (2.5, 2.5);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    expect(descriptor.sections.some((section) => section.id === "fill")).toBe(false);
  });

  it("keeps fill controls for open paths that enclose a region via implicit closure", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) -- (2,0) -- (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    expect(descriptor.sections.some((section) => section.id === "fill")).toBe(true);
  });

  it("keeps solid fill mode as the default inspector mode", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const fillSection = descriptor.sections.find((section) => section.id === "fill");
    expect(fillSection).toBeDefined();
    if (!fillSection) {
      throw new Error("Expected fill section");
    }

    const fillMode = fillSection.properties.find((property) => property.kind === "fillMode");
    expect(fillMode).toBeDefined();
    if (!fillMode || fillMode.kind !== "fillMode") {
      throw new Error("Expected fill mode property");
    }
    expect(fillMode.value).toBe("solid");
  });

  it("detects gradient fill mode and shading subtype", () => {
    const source = String.raw`\begin{tikzpicture}
  \shade[top color=red,bottom color=blue] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const fillSection = descriptor.sections.find((section) => section.id === "fill");
    expect(fillSection).toBeDefined();
    if (!fillSection) {
      throw new Error("Expected fill section");
    }

    const fillMode = fillSection.properties.find((property) => property.kind === "fillMode");
    const fillShading = fillSection.properties.find((property) => property.kind === "fillShading");
    if (!fillMode || fillMode.kind !== "fillMode") {
      throw new Error("Expected fill mode property");
    }
    if (!fillShading || fillShading.kind !== "fillShading") {
      throw new Error("Expected fill shading property");
    }
    expect(fillMode.value).toBe("gradient");
    expect(fillShading.value).toBe("axis");
    expect(fillSection.properties.some((property) => property.id === "fill-axis-top-color")).toBe(true);
    expect(fillSection.properties.some((property) => property.id === "fill-axis-bottom-color")).toBe(true);
  });

  it("detects pattern fill mode and keeps pattern color syntax aliases", () => {
    const source = String.raw`\begin{tikzpicture}
  \definecolor{brand}{rgb}{0.2,0.4,0.7}
  \draw[pattern=grid,pattern color=brand] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const fillSection = descriptor.sections.find((section) => section.id === "fill");
    expect(fillSection).toBeDefined();
    if (!fillSection) {
      throw new Error("Expected fill section");
    }

    const fillMode = fillSection.properties.find((property) => property.kind === "fillMode");
    const fillPattern = fillSection.properties.find((property) => property.kind === "fillPattern");
    const patternColor = fillSection.properties.find((property) => property.id === "fill-pattern-color");
    if (!fillMode || fillMode.kind !== "fillMode") {
      throw new Error("Expected fill mode property");
    }
    if (!fillPattern || fillPattern.kind !== "fillPattern") {
      throw new Error("Expected fill pattern property");
    }
    if (!patternColor || patternColor.kind !== "color") {
      throw new Error("Expected pattern color property");
    }
    expect(fillMode.value).toBe("pattern");
    expect(fillPattern.value).toBe("grid");
    expect(patternColor.syntaxValue).toBe("brand");
  });

  it("shows meta-pattern options for configurable pattern families", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[pattern={Lines[angle=45,distance=4pt,line width=0.6pt,xshift=1pt,yshift=2pt]},pattern color=blue] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const fillSection = descriptor.sections.find((section) => section.id === "fill");
    expect(fillSection).toBeDefined();
    if (!fillSection) {
      throw new Error("Expected fill section");
    }

    const angle = fillSection.properties.find((property) => property.id === "fill-pattern-angle");
    const distance = fillSection.properties.find((property) => property.id === "fill-pattern-distance");
    const xshift = fillSection.properties.find((property) => property.id === "fill-pattern-xshift");
    const yshift = fillSection.properties.find((property) => property.id === "fill-pattern-yshift");
    const lineWidth = fillSection.properties.find((property) => property.id === "fill-pattern-line-width");
    const fillPattern = fillSection.properties.find((property) => property.kind === "fillPattern");

    if (!fillPattern || fillPattern.kind !== "fillPattern") {
      throw new Error("Expected fill pattern property");
    }

    if (!angle || angle.kind !== "fillPatternOption") {
      throw new Error("Expected fill pattern angle property");
    }
    if (!distance || distance.kind !== "fillPatternOption") {
      throw new Error("Expected fill pattern distance property");
    }
    if (!xshift || xshift.kind !== "fillPatternOption") {
      throw new Error("Expected fill pattern xshift property");
    }
    if (!yshift || yshift.kind !== "fillPatternOption") {
      throw new Error("Expected fill pattern yshift property");
    }
    if (!lineWidth || lineWidth.kind !== "fillPatternOption") {
      throw new Error("Expected fill pattern line width property");
    }

    expect(fillPattern.value).toBe("Lines");
    expect(angle.value).toBeCloseTo(45, 6);
    expect(distance.value).toBeCloseTo(4, 6);
    expect(xshift.value).toBeCloseTo(1, 6);
    expect(yshift.value).toBeCloseTo(2, 6);
    expect(lineWidth.value).toBeCloseTo(0.6, 6);
  });

  it("maps unsupported shading and pattern values to custom inspector presets", () => {
    const shadingSource = String.raw`\begin{tikzpicture}
  \shade[shading=color wheel] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const shadingRendered = renderTikzToSvg(shadingSource);
    const shadingPath = shadingRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(shadingPath).toBeDefined();
    if (!shadingPath) {
      throw new Error("Expected shading path element");
    }

    const shadingDescriptor = getInspectorDescriptor(shadingPath, {
      source: shadingSource,
      editHandles: shadingRendered.semantic.editHandles
    });
    const shadingFillSection = shadingDescriptor.sections.find((section) => section.id === "fill");
    expect(shadingFillSection).toBeDefined();
    if (!shadingFillSection) {
      throw new Error("Expected fill section");
    }
    const fillShading = shadingFillSection.properties.find((property) => property.kind === "fillShading");
    if (!fillShading || fillShading.kind !== "fillShading") {
      throw new Error("Expected fill shading property");
    }
    expect(fillShading.value).toBe("custom");

    const patternSource = String.raw`\begin{tikzpicture}
  \draw[pattern={CustomPattern}] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const patternRendered = renderTikzToSvg(patternSource);
    const patternPath = patternRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(patternPath).toBeDefined();
    if (!patternPath) {
      throw new Error("Expected pattern path element");
    }

    const patternDescriptor = getInspectorDescriptor(patternPath, {
      source: patternSource,
      editHandles: patternRendered.semantic.editHandles
    });
    const patternFillSection = patternDescriptor.sections.find((section) => section.id === "fill");
    expect(patternFillSection).toBeDefined();
    if (!patternFillSection) {
      throw new Error("Expected fill section");
    }
    const fillPattern = patternFillSection.properties.find((property) => property.kind === "fillPattern");
    if (!fillPattern || fillPattern.kind !== "fillPattern") {
      throw new Error("Expected fill pattern property");
    }
    expect(fillPattern.value).toBe("custom");
  });

  it("builds deterministic fill mode mutations that clear conflicting paint keys", () => {
    const toSolid = buildFillModeSetPropertyMutations("solid", {
      fillColor: "green",
      patternColor: "red",
      shading: "radial",
      pattern: "grid"
    });
    expect(toSolid).toHaveLength(1);
    expect(toSolid[0]).toMatchObject({
      key: "fill",
      value: "green"
    });
    expect(toSolid[0]?.clearKeys).toContain("pattern");
    expect(toSolid[0]?.clearKeys).toContain("shade");

    const toGradient = buildFillModeSetPropertyMutations("gradient", {
      fillColor: "green",
      patternColor: "red",
      shading: "custom",
      pattern: "grid"
    });
    expect(toGradient.map((mutation) => mutation.key)).toEqual(["shade", "shading"]);
    expect(toGradient[1]?.value).toBe("axis");
    expect(toGradient[0]?.clearKeys).toContain("pattern");

    const toPattern = buildFillModeSetPropertyMutations("pattern", {
      fillColor: "green",
      patternColor: "blue",
      shading: "axis",
      pattern: "custom"
    });
    expect(toPattern.map((mutation) => mutation.key)).toEqual(["pattern", "pattern color"]);
    expect(toPattern[0]?.value).toBe("dots");
    expect(toPattern[1]?.value).toBe("blue");
    expect(toPattern[0]?.clearKeys).toContain("shade");
    expect(toPattern[0]?.clearKeys).toContain("shading");

    const shadingMutations = buildFillShadingSetPropertyMutations("radial");
    expect(shadingMutations.map((mutation) => mutation.key)).toEqual(["shade", "shading"]);
    expect(shadingMutations[1]?.value).toBe("radial");
    expect(shadingMutations[1]?.clearKeys).toContain("top color");

    const patternMutation = buildFillPatternSetPropertyMutation("grid");
    expect(patternMutation).toMatchObject({
      key: "pattern",
      value: "grid"
    });

    const patternOptionMutation = buildFillPatternOptionSetPropertyMutation(
      {
        family: "Stars",
        values: {
          angle: 0,
          distance: 8.5358,
          xshift: 0,
          yshift: 0,
          lineWidth: 0.4,
          radius: 2.8,
          points: 5
        }
      },
      "points",
      7
    );
    expect(patternOptionMutation).toMatchObject({
      key: "pattern",
      value: "{Stars[angle=0,distance=8.54pt,xshift=0pt,yshift=0pt,radius=2.8pt,points=7]}"
    });
  });

  it("shows line join for closed paths and line cap only when dashes are active", () => {
    const undashedSource = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const dashedSource = String.raw`\begin{tikzpicture}
  \draw[dashed] (0,0) rectangle (1,1);
\end{tikzpicture}`;

    const undashedRendered = renderTikzToSvg(undashedSource);
    const dashedRendered = renderTikzToSvg(dashedSource);
    const undashedPath = undashedRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    const dashedPath = dashedRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(undashedPath).toBeDefined();
    expect(dashedPath).toBeDefined();
    if (!undashedPath || !dashedPath) {
      throw new Error("Expected path elements");
    }

    const undashedDescriptor = getInspectorDescriptor(undashedPath, {
      source: undashedSource,
      editHandles: undashedRendered.semantic.editHandles
    });
    const dashedDescriptor = getInspectorDescriptor(dashedPath, {
      source: dashedSource,
      editHandles: dashedRendered.semantic.editHandles
    });
    const undashedStroke = undashedDescriptor.sections.find((section) => section.id === "stroke");
    const dashedStroke = dashedDescriptor.sections.find((section) => section.id === "stroke");
    expect(undashedStroke).toBeDefined();
    expect(dashedStroke).toBeDefined();
    if (!undashedStroke || !dashedStroke) {
      throw new Error("Expected stroke sections");
    }

    expect(undashedStroke.properties.some((property) => property.kind === "lineJoin")).toBe(true);
    expect(undashedStroke.properties.some((property) => property.kind === "lineCap")).toBe(false);

    expect(dashedStroke.properties.some((property) => property.kind === "lineJoin")).toBe(true);
    expect(dashedStroke.properties.some((property) => property.kind === "lineCap")).toBe(true);
  });

  it("shows rounded corners in the path section only when the path has joins", () => {
    const joinedSource = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const straightSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;

    const joinedRendered = renderTikzToSvg(joinedSource);
    const straightRendered = renderTikzToSvg(straightSource);
    const joinedPath = joinedRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    const straightPath = straightRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(joinedPath).toBeDefined();
    expect(straightPath).toBeDefined();
    if (!joinedPath || !straightPath) {
      throw new Error("Expected path elements");
    }

    const joinedDescriptor = getInspectorDescriptor(joinedPath, {
      source: joinedSource,
      editHandles: joinedRendered.semantic.editHandles
    });
    const straightDescriptor = getInspectorDescriptor(straightPath, {
      source: straightSource,
      editHandles: straightRendered.semantic.editHandles
    });

    const joinedPathSection = joinedDescriptor.sections.find((section) => section.id === "path");
    const straightPathSection = straightDescriptor.sections.find((section) => section.id === "path");
    expect(joinedPathSection).toBeDefined();
    expect(straightPathSection).toBeDefined();
    if (!joinedPathSection || !straightPathSection) {
      throw new Error("Expected path sections");
    }

    const joinedRoundedCorners = joinedPathSection.properties.find(
      (property) => property.kind === "roundedCorners"
    );
    const straightRoundedCorners = straightPathSection.properties.find(
      (property) => property.kind === "roundedCorners"
    );

    expect(joinedRoundedCorners).toBeDefined();
    if (!joinedRoundedCorners || joinedRoundedCorners.kind !== "roundedCorners") {
      throw new Error("Expected rounded corners property");
    }
    expect(joinedRoundedCorners.enabled).toBe(false);
    expect(joinedRoundedCorners.radius).toBeCloseTo(4, 6);
    expect(joinedRoundedCorners.defaultRadius).toBeCloseTo(4, 6);
    expect(joinedRoundedCorners.max).toBeCloseTo(14.23, 2);

    expect(straightRoundedCorners).toBeUndefined();
  });

  it("keeps rounded-corner max stable after rounded corners are enabled", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rounded corners=4pt] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const path = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(path).toBeDefined();
    if (!path) {
      throw new Error("Expected path element");
    }

    const descriptor = getInspectorDescriptor(path, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }

    const roundedCorners = pathSection.properties.find((property) => property.kind === "roundedCorners");
    expect(roundedCorners).toBeDefined();
    if (!roundedCorners || roundedCorners.kind !== "roundedCorners") {
      throw new Error("Expected rounded corners property");
    }

    expect(roundedCorners.enabled).toBe(true);
    expect(roundedCorners.max).toBeCloseTo(14.23, 2);
  });

  it("builds rounded-corners mutations for enabling and disabling", () => {
    const enabled = buildRoundedCornersSetPropertyMutation(true, 6);
    expect(enabled).toMatchObject({
      key: "rounded corners",
      value: "6pt"
    });
    expect(enabled.clearKeys).toContain("sharp corners");
    expect(enabled.clearKeys).not.toContain("rounded corners");

    const enabledDefault = buildRoundedCornersSetPropertyMutation(true);
    expect(enabledDefault.value).toBe("true");

    const disabled = buildRoundedCornersSetPropertyMutation(false, 6);
    expect(disabled).toMatchObject({
      key: "sharp corners",
      value: "true"
    });
    expect(disabled.clearKeys).toContain("rounded corners");
    expect(disabled.clearKeys).not.toContain("sharp corners");
  });

  it("shows a node section for node-backed text with shape, inner sep, and font controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[circle,inner sep=3pt,font=\Large\bfseries\sffamily] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const sectionIds = descriptor.sections.map((section) => section.id);
    expect(sectionIds).toContain("node");

    const nodeSection = descriptor.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }
    expect(nodeSection.properties.map((property) => property.kind)).toEqual([
      "nodeShape",
      "length",
      "nodeFont"
    ]);
  });

  it("detects node shape from flags and shape= values, including custom fallback note", () => {
    const circleSource = String.raw`\begin{tikzpicture}
  \node[circle] at (0,0) {A};
\end{tikzpicture}`;
    const diamondSource = String.raw`\begin{tikzpicture}
  \node[shape=diamond] at (0,0) {A};
\end{tikzpicture}`;
    const customSource = String.raw`\begin{tikzpicture}
  \node[shape=star] at (0,0) {A};
\end{tikzpicture}`;

    const circleElement = renderTikzToSvg(circleSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const diamondElement = renderTikzToSvg(diamondSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const customElement = renderTikzToSvg(customSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(circleElement).toBeDefined();
    expect(diamondElement).toBeDefined();
    expect(customElement).toBeDefined();
    if (!circleElement || !diamondElement || !customElement) {
      throw new Error("Expected text elements");
    }

    const circleDescriptor = getInspectorDescriptor(circleElement, { source: circleSource });
    const diamondDescriptor = getInspectorDescriptor(diamondElement, { source: diamondSource });
    const customDescriptor = getInspectorDescriptor(customElement, { source: customSource });

    const circleShape = getNodeShapeProperty(circleDescriptor);
    const diamondShape = getNodeShapeProperty(diamondDescriptor);
    const customShape = getNodeShapeProperty(customDescriptor);

    expect(circleShape.value).toBe("circle");
    expect(diamondShape.value).toBe("diamond");
    expect(customShape.value).toBe("custom");
    expect(customShape.note).toContain("Custom node shape detected");
  });

  it("builds node shape mutations that normalize existing shape flags", () => {
    const mutation = buildNodeShapeSetPropertyMutation("circle");
    expect(mutation).toMatchObject({
      key: "shape",
      value: "circle"
    });
    expect(mutation.clearKeys).toContain("rectangle");
    expect(mutation.clearKeys).toContain("diamond");
    expect(mutation.clearKeys).toContain("trapezium");

    const source = String.raw`\begin{tikzpicture}
  \node[diamond,shape=star] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }
    const descriptor = getInspectorDescriptor(text, { source, editHandles: rendered.semantic.editHandles });
    const shapeProperty = getNodeShapeProperty(descriptor);
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: shapeProperty.write.elementId,
      level: "command",
      key: mutation.key,
      value: mutation.value,
      clearKeys: mutation.clearKeys
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected successful shape mutation");
    }
    expect(result.newSource).toContain("shape=circle");
    expect(result.newSource).not.toContain("diamond");
  });

  it("detects node inner sep defaults and normalizes x/y sep conflicts", () => {
    const defaultSource = String.raw`\begin{tikzpicture}
  \node[rectangle] at (0,0) {A};
\end{tikzpicture}`;
    const conflictSource = String.raw`\begin{tikzpicture}
  \node[inner xsep=2pt,inner ysep=6pt] at (0,0) {A};
\end{tikzpicture}`;

    const defaultElement = renderTikzToSvg(defaultSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const conflictElement = renderTikzToSvg(conflictSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(defaultElement).toBeDefined();
    expect(conflictElement).toBeDefined();
    if (!defaultElement || !conflictElement) {
      throw new Error("Expected text elements");
    }

    const defaultInnerSep = getNodeInnerSepProperty(getInspectorDescriptor(defaultElement, { source: defaultSource }));
    const conflictInnerSep = getNodeInnerSepProperty(getInspectorDescriptor(conflictElement, { source: conflictSource }));
    expect(defaultInnerSep.value).toBeGreaterThan(3);
    expect(defaultInnerSep.value).toBeLessThan(3.5);
    expect(conflictInnerSep.value).toBeCloseTo(4, 6);
    expect(conflictInnerSep.note).toContain("inner xsep/inner ysep");

    const mutation = buildNodeInnerSepSetPropertyMutation(5.5);
    expect(mutation).toMatchObject({
      key: "inner sep",
      value: "5.5pt"
    });
    expect(mutation.clearKeys).toContain("inner xsep");
    expect(mutation.clearKeys).toContain("inner ysep");
  });

  it("resolves node font key preference and serializes deterministic font mutations", () => {
    const fontKeySource = String.raw`\begin{tikzpicture}
  \node[circle,font=\small\bfseries] at (0,0) {A};
\end{tikzpicture}`;
    const nodeFontKeySource = String.raw`\begin{tikzpicture}
  \node[circle,node font=\footnotesize\itshape] at (0,0) {A};
\end{tikzpicture}`;
    const defaultKeySource = String.raw`\begin{tikzpicture}
  \node[circle] at (0,0) {A};
\end{tikzpicture}`;

    const fontElement = renderTikzToSvg(fontKeySource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const nodeFontElement = renderTikzToSvg(nodeFontKeySource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const defaultElement = renderTikzToSvg(defaultKeySource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(fontElement).toBeDefined();
    expect(nodeFontElement).toBeDefined();
    expect(defaultElement).toBeDefined();
    if (!fontElement || !nodeFontElement || !defaultElement) {
      throw new Error("Expected text elements");
    }

    const fontProperty = getNodeFontProperty(getInspectorDescriptor(fontElement, { source: fontKeySource }));
    const nodeFontProperty = getNodeFontProperty(
      getInspectorDescriptor(nodeFontElement, { source: nodeFontKeySource })
    );
    const defaultFontProperty = getNodeFontProperty(
      getInspectorDescriptor(defaultElement, { source: defaultKeySource })
    );

    expect(fontProperty.context.key).toBe("font");
    expect(nodeFontProperty.context.key).toBe("node font");
    expect(defaultFontProperty.context.key).toBe("node font");

    const presetMutation = buildNodeFontSetPropertyMutation(
      {
        key: "font",
        clearKeys: ["node font"],
        fallbackCustomSizePt: 10
      },
      {
        family: "sans",
        weight: "bold",
        style: "italic",
        sizePreset: "small",
        customSizePt: null
      }
    );
    expect(presetMutation).toMatchObject({
      key: "font",
      value: "\\small\\sffamily\\bfseries\\itshape",
      clearKeys: ["node font"]
    });

    const customSizeMutation = buildNodeFontSetPropertyMutation(
      {
        key: "node font",
        clearKeys: ["font"],
        fallbackCustomSizePt: 10
      },
      {
        family: "serif",
        weight: "normal",
        style: "normal",
        sizePreset: "custom",
        customSizePt: 11
      }
    );
    expect(customSizeMutation).toMatchObject({
      key: "node font",
      value: "\\fontsize{11pt}{13.2pt}\\selectfont",
      clearKeys: ["font"]
    });

    const italicOnlyMutation = buildNodeFontSetPropertyMutation(
      {
        key: "node font",
        clearKeys: ["font"],
        fallbackCustomSizePt: 10
      },
      {
        family: "serif",
        weight: "normal",
        style: "italic",
        sizePreset: "normalsize",
        customSizePt: null
      }
    );
    expect(italicOnlyMutation).toMatchObject({
      key: "node font",
      value: "\\itshape",
      clearKeys: ["font"]
    });

    const defaultsMutation = buildNodeFontSetPropertyMutation(
      {
        key: "node font",
        clearKeys: ["font"],
        fallbackCustomSizePt: 10
      },
      {
        family: "serif",
        weight: "normal",
        style: "normal",
        sizePreset: "normalsize",
        customSizePt: null
      }
    );
    expect(defaultsMutation).toMatchObject({
      key: "node font",
      value: "",
      clearKeys: ["font"]
    });
  });

  it("removes a node font key when setProperty receives an empty value", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[circle,node font=\itshape] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }
    const descriptor = getInspectorDescriptor(text, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const nodeFont = getNodeFontProperty(descriptor);
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: nodeFont.write.elementId,
      level: nodeFont.write.level,
      key: nodeFont.write.key,
      value: "",
      clearKeys: nodeFont.context.clearKeys
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected successful node font reset mutation");
    }
    expect(result.newSource).not.toContain("node font=");
    expect(result.newSource).not.toContain("font=");
  });
});

function getNodeShapeProperty(descriptor: ReturnType<typeof getInspectorDescriptor>) {
  const nodeSection = descriptor.sections.find((section) => section.id === "node");
  if (!nodeSection) {
    throw new Error("Expected node section");
  }
  const shape = nodeSection.properties.find((property) => property.kind === "nodeShape");
  if (!shape || shape.kind !== "nodeShape") {
    throw new Error("Expected node shape property");
  }
  return shape;
}

function getNodeInnerSepProperty(descriptor: ReturnType<typeof getInspectorDescriptor>) {
  const nodeSection = descriptor.sections.find((section) => section.id === "node");
  if (!nodeSection) {
    throw new Error("Expected node section");
  }
  const innerSep = nodeSection.properties.find((property) => property.kind === "length");
  if (!innerSep || innerSep.kind !== "length") {
    throw new Error("Expected node inner sep property");
  }
  return innerSep;
}

function getNodeFontProperty(descriptor: ReturnType<typeof getInspectorDescriptor>) {
  const nodeSection = descriptor.sections.find((section) => section.id === "node");
  if (!nodeSection) {
    throw new Error("Expected node section");
  }
  const nodeFont = nodeSection.properties.find((property) => property.kind === "nodeFont");
  if (!nodeFont || nodeFont.kind !== "nodeFont") {
    throw new Error("Expected node font property");
  }
  return nodeFont;
}
