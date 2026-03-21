import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import {
  buildArrowTipSetPropertyMutation,
  buildFillModeSetPropertyMutations,
  buildFillPatternOptionSetPropertyMutation,
  buildFillPatternSetPropertyMutation,
  buildFillShadingSetPropertyMutations,
  buildNodeFontSetPropertyMutation,
  buildNodeInnerSepSetPropertyMutation,
  buildNodeMinimumDimensionSetPropertyMutations,
  buildNodeShapeSetPropertyMutation,
  buildPathMorphingDecorationSetPropertyMutations,
  buildRoundedCornersSetPropertyMutation,
  buildShadowMutationContextForPreset,
  buildShadowSetPropertyMutations,
  buildTreeInspectorDescriptor,
  buildTransformSetPropertyMutations,
  getInspectorDescriptor,
  resolveTransformInspectorMutationContext,
  resolveTransformInspectorValues,
  TIKZPICTURE_GLOBAL_TARGET_ID
} from "../packages/core/src/edit/inspector.js";
import { resolvePropertyTarget } from "../packages/core/src/edit/property-target.js";
import { buildMultiInspectorModel } from "../packages/app/src/ui/inspector-panel/panel-helpers.js";

describe("getInspectorDescriptor", () => {
  it("returns adornment-specific sections for pins", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={blue,dashed,line width=1pt}]above:$q_0$}] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const pinText = rendered.semantic.scene.elements.find(
      (entry) => entry.adornment?.targetId === "node-adornment:node:0:2:pin:0" && entry.kind === "Text"
    );
    expect(pinText).toBeDefined();
    if (!pinText) {
      throw new Error("Expected a pin text element");
    }

    const descriptor = getInspectorDescriptor(pinText, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    expect(descriptor.sections.some((section) => section.id === "adornment")).toBe(true);
    const pinEdgeSection = descriptor.sections.find((section) => section.id === "pin-edge");
    expect(pinEdgeSection).toBeDefined();
    if (!pinEdgeSection) {
      throw new Error("Expected pin-edge section");
    }
    expect(pinEdgeSection.properties.some((property) => property.id === "pin-edge-color")).toBe(true);
    expect(pinEdgeSection.properties.some((property) => property.id === "pin-edge-line-width")).toBe(true);
    expect(pinEdgeSection.properties.some((property) => property.id === "pin-edge-dash-style")).toBe(false);
  });

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
    expect(pathSection.properties.some((property) => property.id === "path-morphing-segment-length")).toBe(false);
    expect(pathSection.properties.some((property) => property.id === "path-morphing-amplitude")).toBe(false);
    expect(pathSection.properties.some((property) => property.id === "path-morphing-aspect")).toBe(false);

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
      .sort((left, right) => left.sourceRef.sourceSpan.from - right.sourceRef.sourceSpan.from);
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

  it("keeps inherited every-node fill syntax for node inspector colors", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \node[draw] (A) at (-1, -1) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const textElement = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(textElement).toBeDefined();
    if (!textElement) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(textElement, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const fillSection = descriptor.sections.find((section) => section.id === "fill");
    expect(fillSection).toBeDefined();
    if (!fillSection) {
      throw new Error("Expected fill section");
    }

    const fillColor = fillSection.properties.find((property) => property.id === "fill-color");
    if (!fillColor || fillColor.kind !== "color") {
      throw new Error("Expected fill color property");
    }

    const fillMode = fillSection.properties.find((property) => property.kind === "fillMode");
    if (!fillMode || fillMode.kind !== "fillMode") {
      throw new Error("Expected fill mode property");
    }

    expect(fillColor.syntaxValue).toBe("blue!10");
    expect(fillMode.context.fillColor).toBe("blue!10");
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

    if (step.write!.mode !== "setProperty" || xstep.write!.mode !== "setProperty" || ystep.write!.mode !== "setProperty") {
      throw new Error("Expected setProperty writes for grid properties");
    }
    expect(step.write!.elementId).toBe(gridKeyword.id);
    expect(xstep.write!.elementId).toBe(gridKeyword.id);
    expect(ystep.write!.elementId).toBe(gridKeyword.id);
    expect(step.write!.key).toBe("step");
    expect(xstep.write!.key).toBe("xstep");
    expect(ystep.write!.key).toBe("ystep");

    const mutation = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: step.write!.elementId,
      level: step.write!.level,
      key: step.write!.key,
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
    if (!firstSetPropertyControl) {
      throw new Error("Expected a setProperty-driven control");
    }
    expect((firstSetPropertyControl as any).write.writable).toBe(false);
  });

  it("keeps statements after foreach editable in inspector", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red] (1.68,0.2) rectangle (1,-0.32);

  \foreach \x in {0,1} { \draw (0,0) -- (1,1); }

  \draw[blue] (-0.6,1.4) rectangle (0.2,0.8);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const blueRectangle = rendered.semantic.scene.elements.find(
      (entry) =>
        entry.kind === "Path" &&
        entry.shapeHint === "rectangle" &&
        entry.sourceRef.sourceId === "path:2"
    );
    expect(blueRectangle).toBeDefined();
    if (!blueRectangle) {
      throw new Error("Expected rectangle path after foreach");
    }

    const descriptor = getInspectorDescriptor(blueRectangle, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    expect(descriptor.readOnlyReason).toBeUndefined();

    const strokeColor = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "color" && property.id === "stroke-color");
    expect(strokeColor).toBeDefined();
    if (!strokeColor || strokeColor.kind !== "color") {
      throw new Error("Expected stroke color property");
    }
    expect(strokeColor.write.writable).toBe(true);
  });

  it("keeps non-first statements editable in inspector", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red] (0,0) rectangle (1,1);
  \draw[green] (2,0) rectangle (3,1);
  \draw[blue] (4,0) rectangle (5,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const secondRectangle = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Path" && entry.shapeHint === "rectangle" && entry.sourceRef.sourceId === "path:1"
    );
    const thirdRectangle = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Path" && entry.shapeHint === "rectangle" && entry.sourceRef.sourceId === "path:2"
    );
    expect(secondRectangle).toBeDefined();
    expect(thirdRectangle).toBeDefined();
    if (!secondRectangle || !thirdRectangle) {
      throw new Error("Expected second and third rectangle paths");
    }

    const secondDescriptor = getInspectorDescriptor(secondRectangle, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const thirdDescriptor = getInspectorDescriptor(thirdRectangle, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    const secondStrokeColor = secondDescriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "color" && property.id === "stroke-color");
    const thirdStrokeColor = thirdDescriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "color" && property.id === "stroke-color");
    expect(secondStrokeColor).toBeDefined();
    expect(thirdStrokeColor).toBeDefined();
    if (!secondStrokeColor || secondStrokeColor.kind !== "color") {
      throw new Error("Expected writable stroke color control for second statement");
    }
    if (!thirdStrokeColor || thirdStrokeColor.kind !== "color") {
      throw new Error("Expected writable stroke color control for third statement");
    }

    expect(secondStrokeColor.write.writable).toBe(true);
    expect(thirdStrokeColor.write.writable).toBe(true);
    expect(secondDescriptor.writeTargetId).toBe("path:1");
    expect(thirdDescriptor.writeTargetId).toBe("path:2");
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

  it("keeps cm transforms while applying additive canonical transform edits", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[cm={0,1,1,0,(1cm,1cm)}] (0,0) -- (2,0);
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

    const mutations = buildTransformSetPropertyMutations(xscale.write.transformContext.values, "xscale", 2);
    expect(mutations.length).toBeGreaterThanOrEqual(1);

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

    expect(updated).toContain("cm={0,1,1,0,(1cm,1cm)}");
    expect(updated).toContain("xscale=2");
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

  it("inserts new scope transform options after \\begin{scope} when a scope has no option list", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \node[draw] (B) at (1.5, -0.5) {B};
    \node[draw] (C) at (0, 1.5) {C};
  \end{scope}
\end{tikzpicture}`;

    const resolved = resolvePropertyTarget(source, "scope:0");
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected scope property target");
    }

    const mutations = buildTransformSetPropertyMutations(
      resolveTransformInspectorValues(source, "scope:0"),
      "xshift",
      0.8
    );
    expect(mutations).toHaveLength(1);

    let updated = source;
    for (const mutation of mutations) {
      const result = applyEditAction(updated, [], {
        kind: "setProperty",
        elementId: resolved.target.id,
        level: "command",
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful scope transform mutation");
      }
      updated = result.newSource;
    }

    expect(updated).toContain("\\begin{scope}[xshift=0.8pt]");
    expect(updated).not.toContain("yshift=0pt");
    expect(updated).not.toContain("\\begin{scope[xshift=0.8pt]}");
  });

  it("clears default xscale while preserving a non-default yscale companion", () => {
    const source = String.raw`\begin{tikzpicture}[xscale=1.5, yscale=2]
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const mutations = buildTransformSetPropertyMutations(
      resolveTransformInspectorMutationContext(source, TIKZPICTURE_GLOBAL_TARGET_ID),
      "xscale",
      1
    );
    expect(mutations).toEqual([
      {
        key: "xscale",
        value: "",
        clearKeys: ["xscale", "scale", "/tikz/scale", "/tikz/xscale"]
      }
    ]);

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
        throw new Error("Expected successful xscale reset mutation");
      }
      updated = result.newSource;
    }

    expect(updated).toContain("\\begin{tikzpicture}[yscale=2]");
    expect(updated).not.toContain("xscale=");
    expect(updated).not.toMatch(/\bscale\s*=/);
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

  it("rewrites scale shorthand into explicit scales when flipping xscale", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[scale=2] (0,0) -- (2,0);
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

    const mutations = buildTransformSetPropertyMutations(xscale.write.transformContext.values, "xscale", -2);
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

    expect(updated).toContain("xscale=-2");
    expect(updated).toContain("yscale=2");
    expect(updated).not.toMatch(/\bscale\s*=/);
  });

  it("supports flipping yscale twice back to the original value", () => {
    const values = resolveTransformInspectorValues(String.raw`\begin{tikzpicture}
  \draw[yscale=2] (0,0) -- (1,0);
\end{tikzpicture}`, "path:0");
    const flipped = buildTransformSetPropertyMutations(values, "yscale", -values.yscale);
    expect(flipped).toHaveLength(1);
    expect(flipped[0]).toMatchObject({
      key: "yscale",
      value: "-2"
    });

    const reflipped = buildTransformSetPropertyMutations(
      { ...values, yscale: -2 },
      "yscale",
      2
    );
    expect(reflipped).toHaveLength(1);
    expect(reflipped[0]).toMatchObject({
      key: "yscale",
      value: "2"
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
    expect(enabledMutations[0]?.clearKeys).toContain("/pgf/decoration/segment length");
    expect(enabledMutations[0]?.clearKeys).toContain("/pgf/decoration/amplitude");
    expect(enabledMutations[0]?.clearKeys).toContain("/pgf/decoration/aspect");

    const disabledMutations = buildPathMorphingDecorationSetPropertyMutations("none");
    expect(disabledMutations).toHaveLength(1);
    expect(disabledMutations[0]).toMatchObject({
      key: "decorate",
      value: "false"
    });
    expect(disabledMutations[0]?.clearKeys).toContain("decoration");
    expect(disabledMutations[0]?.clearKeys).toContain("/pgf/decorations/segment length");
    expect(disabledMutations[0]?.clearKeys).toContain("/pgf/decorations/amplitude");
    expect(disabledMutations[0]?.clearKeys).toContain("/pgf/decorations/aspect");
  });

  it("shows segment length and amplitude path morphing suboptions for curated decorations", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[decorate,decoration={zigzag,segment length=8pt,amplitude=3pt}] (0,0) -- (2,0);
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

    const segmentLength = pathSection.properties.find((property) => property.id === "path-morphing-segment-length");
    const amplitude = pathSection.properties.find((property) => property.id === "path-morphing-amplitude");
    const aspect = pathSection.properties.find((property) => property.id === "path-morphing-aspect");

    expect(segmentLength).toBeDefined();
    expect(amplitude).toBeDefined();
    expect(aspect).toBeUndefined();
    if (!segmentLength || segmentLength.kind !== "number") {
      throw new Error("Expected segment length property");
    }
    if (!amplitude || amplitude.kind !== "number") {
      throw new Error("Expected amplitude property");
    }

    expect(segmentLength.value).toBeCloseTo(8, 6);
    expect(segmentLength.unit).toBe("pt");
    expect(segmentLength.write?.key).toBe("/pgf/decoration/segment length");
    expect(amplitude.value).toBeCloseTo(3, 6);
    expect(amplitude.unit).toBe("pt");
    expect(amplitude.write?.key).toBe("/pgf/decoration/amplitude");
  });

  it("shows bent path morphing suboptions including aspect", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[decorate,decoration={bent,amplitude=4pt,aspect=.3}] (0,0) -- (2,0);
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

    const segmentLength = pathSection.properties.find((property) => property.id === "path-morphing-segment-length");
    const amplitude = pathSection.properties.find((property) => property.id === "path-morphing-amplitude");
    const aspect = pathSection.properties.find((property) => property.id === "path-morphing-aspect");

    expect(segmentLength).toBeUndefined();
    expect(amplitude).toBeDefined();
    expect(aspect).toBeDefined();
    if (!amplitude || amplitude.kind !== "number") {
      throw new Error("Expected bent amplitude property");
    }
    if (!aspect || aspect.kind !== "number") {
      throw new Error("Expected bent aspect property");
    }

    expect(amplitude.value).toBeCloseTo(4, 6);
    expect(aspect.value).toBeCloseTo(0.3, 6);
    expect(aspect.unit).toBeUndefined();
    expect(aspect.write?.key).toBe("/pgf/decoration/aspect");
  });

  it("falls back to default path morphing suboption values when keys are omitted", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[decorate,decoration=bent] (0,0) -- (2,0);
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

    const amplitude = pathSection.properties.find((property) => property.id === "path-morphing-amplitude");
    const aspect = pathSection.properties.find((property) => property.id === "path-morphing-aspect");
    if (!amplitude || amplitude.kind !== "number") {
      throw new Error("Expected default bent amplitude property");
    }
    if (!aspect || aspect.kind !== "number") {
      throw new Error("Expected default bent aspect property");
    }
    expect(amplitude.value).toBeCloseTo(2.5, 6);
    expect(aspect.value).toBeCloseTo(0.5, 6);
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
    expect(pathSection.properties.some((property) => property.id === "path-morphing-segment-length")).toBe(false);
    expect(pathSection.properties.some((property) => property.id === "path-morphing-amplitude")).toBe(false);
    expect(pathSection.properties.some((property) => property.id === "path-morphing-aspect")).toBe(false);
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

  it("shows rounded corners in the path section only when the path has geometric corners", () => {
    const joinedSource = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const straightSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;
    const collinearSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const smoothArcSource = String.raw`\begin{tikzpicture}
  \draw (1,0) arc[start angle=0,end angle=180,radius=1cm]
               arc[start angle=180,end angle=360,radius=1cm];
\end{tikzpicture}`;
    const decoratedStraightSource = String.raw`\begin{tikzpicture}
  \draw[decorate, decoration=zigzag] (-2.5, 2.5) -- (2.5, 2.5);
\end{tikzpicture}`;
    const decoratedCorneredSource = String.raw`\begin{tikzpicture}
  \draw[decorate, decoration=zigzag] (0,0) -- (1,0) -- (1,1);
\end{tikzpicture}`;

    const joinedRendered = renderTikzToSvg(joinedSource);
    const straightRendered = renderTikzToSvg(straightSource);
    const collinearRendered = renderTikzToSvg(collinearSource);
    const smoothArcRendered = renderTikzToSvg(smoothArcSource);
    const decoratedStraightRendered = renderTikzToSvg(decoratedStraightSource);
    const decoratedCorneredRendered = renderTikzToSvg(decoratedCorneredSource);
    const joinedPath = joinedRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    const straightPath = straightRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    const collinearPath = collinearRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    const smoothArcPath = smoothArcRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    const decoratedStraightPath = decoratedStraightRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    const decoratedCorneredPath = decoratedCorneredRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(joinedPath).toBeDefined();
    expect(straightPath).toBeDefined();
    expect(collinearPath).toBeDefined();
    expect(smoothArcPath).toBeDefined();
    expect(decoratedStraightPath).toBeDefined();
    expect(decoratedCorneredPath).toBeDefined();
    if (
      !joinedPath ||
      !straightPath ||
      !collinearPath ||
      !smoothArcPath ||
      !decoratedStraightPath ||
      !decoratedCorneredPath
    ) {
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
    const collinearDescriptor = getInspectorDescriptor(collinearPath, {
      source: collinearSource,
      editHandles: collinearRendered.semantic.editHandles
    });
    const smoothArcDescriptor = getInspectorDescriptor(smoothArcPath, {
      source: smoothArcSource,
      editHandles: smoothArcRendered.semantic.editHandles
    });
    const decoratedStraightDescriptor = getInspectorDescriptor(decoratedStraightPath, {
      source: decoratedStraightSource,
      editHandles: decoratedStraightRendered.semantic.editHandles
    });
    const decoratedCorneredDescriptor = getInspectorDescriptor(decoratedCorneredPath, {
      source: decoratedCorneredSource,
      editHandles: decoratedCorneredRendered.semantic.editHandles
    });

    const joinedPathSection = joinedDescriptor.sections.find((section) => section.id === "path");
    const straightPathSection = straightDescriptor.sections.find((section) => section.id === "path");
    const collinearPathSection = collinearDescriptor.sections.find((section) => section.id === "path");
    const smoothArcPathSection = smoothArcDescriptor.sections.find((section) => section.id === "path");
    const decoratedStraightPathSection = decoratedStraightDescriptor.sections.find((section) => section.id === "path");
    const decoratedCorneredPathSection = decoratedCorneredDescriptor.sections.find((section) => section.id === "path");
    expect(joinedPathSection).toBeDefined();
    expect(straightPathSection).toBeDefined();
    expect(collinearPathSection).toBeDefined();
    expect(smoothArcPathSection).toBeDefined();
    expect(decoratedStraightPathSection).toBeDefined();
    expect(decoratedCorneredPathSection).toBeDefined();
    if (
      !joinedPathSection ||
      !straightPathSection ||
      !collinearPathSection ||
      !smoothArcPathSection ||
      !decoratedStraightPathSection ||
      !decoratedCorneredPathSection
    ) {
      throw new Error("Expected path sections");
    }

    const joinedRoundedCorners = joinedPathSection.properties.find(
      (property) => property.kind === "roundedCorners"
    );
    const straightRoundedCorners = straightPathSection.properties.find(
      (property) => property.kind === "roundedCorners"
    );
    const collinearRoundedCorners = collinearPathSection.properties.find(
      (property) => property.kind === "roundedCorners"
    );
    const smoothArcRoundedCorners = smoothArcPathSection.properties.find(
      (property) => property.kind === "roundedCorners"
    );
    const decoratedStraightRoundedCorners = decoratedStraightPathSection.properties.find(
      (property) => property.kind === "roundedCorners"
    );
    const decoratedCorneredRoundedCorners = decoratedCorneredPathSection.properties.find(
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
    expect(collinearRoundedCorners).toBeUndefined();
    expect(smoothArcRoundedCorners).toBeUndefined();
    expect(decoratedStraightRoundedCorners).toBeUndefined();
    expect(decoratedCorneredRoundedCorners).toBeDefined();
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

    const disabledWithoutSharp = buildRoundedCornersSetPropertyMutation(false, 6, false);
    expect(disabledWithoutSharp).toMatchObject({
      key: "rounded corners",
      value: ""
    });
    expect(disabledWithoutSharp.clearKeys).toContain("rounded corners");
    expect(disabledWithoutSharp.clearKeys).toContain("sharp corners");
  });

  it("requires explicit sharp-corners disable only when rounded corners are inherited", () => {
    const inheritedSource = String.raw`\begin{tikzpicture}
  \begin{scope}[rounded corners=6pt]
    \draw (0,0) rectangle (1,1);
  \end{scope}
\end{tikzpicture}`;
    const inheritedRendered = renderTikzToSvg(inheritedSource);
    const inheritedPath = inheritedRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(inheritedPath).toBeDefined();
    if (!inheritedPath) {
      throw new Error("Expected inherited path element");
    }
    const inheritedDescriptor = getInspectorDescriptor(inheritedPath, {
      source: inheritedSource,
      editHandles: inheritedRendered.semantic.editHandles
    });
    const inheritedPathSection = inheritedDescriptor.sections.find((section) => section.id === "path");
    expect(inheritedPathSection).toBeDefined();
    if (!inheritedPathSection) {
      throw new Error("Expected inherited path section");
    }
    const inheritedRounded = inheritedPathSection.properties.find((property) => property.kind === "roundedCorners");
    expect(inheritedRounded).toBeDefined();
    if (!inheritedRounded || inheritedRounded.kind !== "roundedCorners") {
      throw new Error("Expected inherited rounded corners property");
    }
    expect(inheritedRounded.disableRequiresSharpCorners).toBe(true);

    const localSource = String.raw`\begin{tikzpicture}
  \draw[rounded corners=6pt] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const localRendered = renderTikzToSvg(localSource);
    const localPath = localRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(localPath).toBeDefined();
    if (!localPath) {
      throw new Error("Expected local path element");
    }
    const localDescriptor = getInspectorDescriptor(localPath, {
      source: localSource,
      editHandles: localRendered.semantic.editHandles
    });
    const localPathSection = localDescriptor.sections.find((section) => section.id === "path");
    expect(localPathSection).toBeDefined();
    if (!localPathSection) {
      throw new Error("Expected local path section");
    }
    const localRounded = localPathSection.properties.find((property) => property.kind === "roundedCorners");
    expect(localRounded).toBeDefined();
    if (!localRounded || localRounded.kind !== "roundedCorners") {
      throw new Error("Expected local rounded corners property");
    }
    expect(localRounded.disableRequiresSharpCorners).toBe(false);
  });

  it("shows shadow controls for paths with a drop shadow", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[drop shadow={shadow xshift=1pt,shadow yshift=-2pt,opacity=.25,fill=gray}] (0,0) -- (1,0);
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
    const shadowSection = descriptor.sections.find((section) => section.id === "shadow");
    expect(shadowSection).toBeDefined();
    if (!shadowSection) {
      throw new Error("Expected shadow section");
    }

    expect(shadowSection.properties.map((property) => property.id)).toEqual([
      "shadow-preset",
      "shadow-xshift",
      "shadow-yshift",
      "shadow-scale",
      "shadow-opacity",
      "shadow-color"
    ]);

    const preset = shadowSection.properties.find((property) => property.id === "shadow-preset");
    const xshift = shadowSection.properties.find((property) => property.id === "shadow-xshift");
    const yshift = shadowSection.properties.find((property) => property.id === "shadow-yshift");
    const scale = shadowSection.properties.find((property) => property.id === "shadow-scale");
    const opacity = shadowSection.properties.find((property) => property.id === "shadow-opacity");
    const color = shadowSection.properties.find((property) => property.id === "shadow-color");

    if (!preset || preset.kind !== "shadowPreset") {
      throw new Error("Expected shadow preset property");
    }
    if (!xshift || xshift.kind !== "length") {
      throw new Error("Expected shadow xshift property");
    }
    if (!yshift || yshift.kind !== "length") {
      throw new Error("Expected shadow yshift property");
    }
    if (!scale || scale.kind !== "number") {
      throw new Error("Expected shadow scale property");
    }
    if (!opacity || opacity.kind !== "number") {
      throw new Error("Expected shadow opacity property");
    }
    if (!color || color.kind !== "color") {
      throw new Error("Expected shadow color property");
    }

    expect(preset.value).toBe("drop-shadow");
    expect(xshift.value).toBeCloseTo(1, 6);
    expect(yshift.value).toBeCloseTo(-2, 6);
    expect(scale.value).toBeCloseTo(1, 6);
    expect(opacity.value).toBeCloseTo(0.25, 6);
    expect(opacity.min).toBe(0);
    expect(opacity.max).toBe(1);
    expect(color.value).toBe("gray");
    expect(color.syntaxValue).toBe("gray");
    expect(xshift.write.shadowContext).toBeDefined();
  });

  it("preserves preset default shadow color syntax as black!50", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[drop shadow] (0,0) -- (1,0);
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
    const shadowSection = descriptor.sections.find((section) => section.id === "shadow");
    expect(shadowSection).toBeDefined();
    if (!shadowSection) {
      throw new Error("Expected shadow section");
    }

    const color = shadowSection.properties.find((property) => property.id === "shadow-color");
    if (!color || color.kind !== "color") {
      throw new Error("Expected shadow color property");
    }

    expect(color.value).toBe("black!50");
    expect(color.syntaxValue).toBe("black!50");
  });

  it("matches documented circular glow defaults", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[circular glow] (0,0) -- (1,0);
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
    const shadowSection = descriptor.sections.find((section) => section.id === "shadow");
    expect(shadowSection).toBeDefined();
    if (!shadowSection) {
      throw new Error("Expected shadow section");
    }

    const xshift = shadowSection.properties.find((property) => property.id === "shadow-xshift");
    const yshift = shadowSection.properties.find((property) => property.id === "shadow-yshift");
    const scale = shadowSection.properties.find((property) => property.id === "shadow-scale");
    const opacity = shadowSection.properties.find((property) => property.id === "shadow-opacity");
    const color = shadowSection.properties.find((property) => property.id === "shadow-color");

    if (!xshift || xshift.kind !== "length") {
      throw new Error("Expected circular glow xshift property");
    }
    if (!yshift || yshift.kind !== "length") {
      throw new Error("Expected circular glow yshift property");
    }
    if (!scale || scale.kind !== "number") {
      throw new Error("Expected circular glow scale property");
    }
    if (!opacity || opacity.kind !== "number") {
      throw new Error("Expected circular glow opacity property");
    }
    if (!color || color.kind !== "color") {
      throw new Error("Expected circular glow color property");
    }

    expect(xshift.value).toBeCloseTo(0, 6);
    expect(yshift.value).toBeCloseTo(0, 6);
    expect(scale.value).toBeCloseTo(1.25, 6);
    expect(opacity.value).toBeCloseTo(1, 6);
    expect(opacity.min).toBe(0);
    expect(opacity.max).toBe(1);
    expect(color.value).toBe("black");
    expect(color.syntaxValue).toBe("black");
  });

  it("builds shadow mutations as flags or nested option payloads", () => {
    const defaultDropShadow = buildShadowSetPropertyMutations({
      preset: "drop-shadow",
      xshiftPt: 2.15,
      yshiftPt: -2.15,
      scale: 1,
      opacity: 0.5,
      color: "black!50"
    });
    expect(defaultDropShadow).toEqual([
      {
        key: "drop shadow",
        value: "true",
        clearKeys: ["copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
      }
    ]);

    const customDropShadow = buildShadowSetPropertyMutations({
      preset: "drop-shadow",
      xshiftPt: 2,
      yshiftPt: -3,
      scale: 1,
      opacity: 0.25,
      color: "gray"
    });
    expect(customDropShadow).toEqual([
      {
        key: "drop shadow",
        value: "{shadow xshift=2pt,shadow yshift=-3pt,opacity=0.25,fill=gray}",
        clearKeys: ["copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
      }
    ]);

    const disabledShadow = buildShadowSetPropertyMutations({
      preset: "none",
      xshiftPt: 0,
      yshiftPt: 0,
      scale: 1,
      opacity: 1,
      color: null
    });
    expect(disabledShadow).toEqual([
      {
        key: "drop shadow",
        value: "",
        clearKeys: ["drop shadow", "copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
      }
    ]);

    const copyToDropShadow = buildShadowSetPropertyMutations({
      preset: "drop-shadow",
      xshiftPt: 2.15,
      yshiftPt: -2.15,
      scale: 1,
      opacity: 0.5,
      color: "__tikz-shadow-inherit-fill__"
    });
    expect(copyToDropShadow).toEqual([
      {
        key: "drop shadow",
        value: "true",
        clearKeys: ["copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
      }
    ]);

    const circularGlowOpacity = buildShadowSetPropertyMutations({
      preset: "circular-glow",
      xshiftPt: 0,
      yshiftPt: 0,
      scale: 1.25,
      opacity: 0.4,
      color: "black"
    });
    expect(circularGlowOpacity).toEqual([
      {
        key: "circular glow",
        value: "{opacity=0.4}",
        clearKeys: ["drop shadow", "copy shadow", "circular drop shadow", "general shadow", "double copy shadow"]
      }
    ]);
  });

  it("builds documented preset contexts for shadow preset switches", () => {
    expect(buildShadowMutationContextForPreset("circular-glow")).toEqual({
      preset: "circular-glow",
      xshiftPt: 0,
      yshiftPt: 0,
      scale: 1.25,
      opacity: 1,
      color: "black"
    });

    expect(buildShadowMutationContextForPreset("copy-shadow")).toEqual({
      preset: "copy-shadow",
      xshiftPt: 2.15,
      yshiftPt: -2.15,
      scale: 1,
      opacity: 1,
      color: null
    });
  });

  it("shows a node section for node-backed text with shape, padding, minimum size, font, and text color controls", () => {
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
      "length",
      "length",
      "nodeFont",
      "color"
    ]);
    expect(nodeSection.properties.map((property) => property.id)).toEqual([
      "node-shape",
      "node-inner-sep",
      "node-minimum-width",
      "node-minimum-height",
      "node-font",
      "node-text-color"
    ]);
  });

  it("exposes node text color through the node section using the text key", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[circle,text=red] at (0,0) {A};
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
    const nodeSection = descriptor.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }
    const textColor = nodeSection.properties.find((property) => property.id === "node-text-color");
    if (!textColor || textColor.kind !== "color") {
      throw new Error("Expected node text color property");
    }

    expect(textColor.syntaxValue).toBe("red");
    expect(textColor.write.key).toBe("text");
  });

  it("removes node text color when setProperty receives an empty text value", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[circle,text=red] at (0,0) {A};
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
    const nodeSection = descriptor.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }
    const textColor = nodeSection.properties.find((property) => property.id === "node-text-color");
    if (!textColor || textColor.kind !== "color") {
      throw new Error("Expected node text color property");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: textColor.write.elementId,
      level: textColor.write.level,
      key: textColor.write.key,
      value: "",
      clearKeys: ["text", "text color"]
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected successful text color reset mutation");
    }

    expect(result.newSource).not.toContain("text=red");
    expect(result.newSource).not.toContain("text color=");
  });

  it("detects node shape from flags and shape= values, including custom fallback note", () => {
    const circleSource = String.raw`\begin{tikzpicture}
  \node[circle] at (0,0) {A};
\end{tikzpicture}`;
    const diamondSource = String.raw`\begin{tikzpicture}
  \node[shape=diamond] at (0,0) {A};
\end{tikzpicture}`;
    const customSource = String.raw`\begin{tikzpicture}
  \node[shape=rounded rectangle] at (0,0) {A};
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

  it("adds adaptive shape controls under node shape for supported core and arrow shapes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[star,star points=7,star point ratio=1.8,shape border rotate=25] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, { source, editHandles: rendered.semantic.editHandles });
    const nodeSection = descriptor.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }
    const propertyIds = nodeSection.properties.map((property) => property.id);
    expect(propertyIds).toContain("node-shape-star-points");
    expect(propertyIds).toContain("node-shape-star-point-ratio");
    expect(propertyIds).toContain("node-shape-star-point-height");
    expect(propertyIds).toContain("node-shape-star-border-rotate");
  });

  it("enforces star ratio/height conflict clear-keys for adaptive controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[star,star point ratio=1.65] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, { source, editHandles: rendered.semantic.editHandles });
    const nodeSection = descriptor.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }

    const ratio = nodeSection.properties.find((property) => property.id === "node-shape-star-point-ratio");
    const height = nodeSection.properties.find((property) => property.id === "node-shape-star-point-height");
    if (!ratio || ratio.kind !== "number") {
      throw new Error("Expected star point ratio number property");
    }
    if (!height || height.kind !== "length") {
      throw new Error("Expected star point height length property");
    }

    expect(ratio.clearKeys).toContain("star point height");
    expect(height.clearKeys).toContain("star point ratio");
  });

  it("edits adaptive number/length/enum/boolean properties through inspector write targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[trapezium,trapezium left angle=75,trapezium stretches=false] at (0,0) {A};
  \node[tape,tape bend top=none,tape bend height=4pt] at (2,0) {B};
  \node[signal,signal to=east,signal from=nowhere] at (4,0) {C};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const texts = rendered.semantic.scene.elements.filter((entry) => entry.kind === "Text");
    expect(texts.length).toBeGreaterThanOrEqual(3);
    if (texts.length < 3) {
      throw new Error("Expected three text elements");
    }

    const trapezium = getInspectorDescriptor(texts[0]!, { source, editHandles: rendered.semantic.editHandles });
    const tape = getInspectorDescriptor(texts[1]!, { source, editHandles: rendered.semantic.editHandles });
    const signal = getInspectorDescriptor(texts[2]!, { source, editHandles: rendered.semantic.editHandles });

    const leftAngle = getNodePropertyById(trapezium, "node-shape-trapezium-left-angle");
    if (!leftAngle || leftAngle.kind !== "number") {
      throw new Error("Expected trapezium left-angle number property");
    }
    const stretches = getNodePropertyById(trapezium, "node-shape-trapezium-stretches");
    if (!stretches || stretches.kind !== "boolean") {
      throw new Error("Expected trapezium stretches boolean property");
    }
    const bendTop = getNodePropertyById(tape, "node-shape-tape-bend-top");
    if (!bendTop || bendTop.kind !== "enum") {
      throw new Error("Expected tape bend-top enum property");
    }
    const bendHeight = getNodePropertyById(tape, "node-shape-tape-bend-height");
    if (!bendHeight || bendHeight.kind !== "length") {
      throw new Error("Expected tape bend-height length property");
    }
    const signalTo = getNodePropertyById(signal, "node-shape-signal-to");
    if (!signalTo || signalTo.kind !== "enum") {
      throw new Error("Expected signal-to enum property");
    }

    const applyProperty = (
      currentSource: string,
      property: typeof leftAngle | typeof stretches | typeof bendTop | typeof bendHeight | typeof signalTo,
      value: string
    ) => {
      if (!("write" in property) || !property.write) {
        throw new Error("Expected writable inspector property");
      }
      const result = applyEditAction(currentSource, [], {
        kind: "setProperty",
        elementId: property.write.elementId,
        level: property.write.level,
        key: property.write.key,
        value,
        clearKeys:
          property.kind === "number" || property.kind === "length" || property.kind === "boolean"
            ? property.clearKeys
            : undefined
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful inspector property mutation");
      }
      return result.newSource;
    };

    let next = source;
    next = applyProperty(next, leftAngle, "80deg");
    next = applyProperty(next, stretches, "true");
    next = applyProperty(next, bendTop, "in and out");
    next = applyProperty(next, bendHeight, "7pt");
    next = applyProperty(next, signalTo, "west");

    expect(next).toContain("trapezium left angle=80deg");
    expect(next).toContain("trapezium stretches");
    expect(next).not.toContain("trapezium stretches=false");
    expect(next).toContain("tape bend top=in and out");
    expect(next).toContain("tape bend height=7pt");
    expect(next).toContain("signal to=west");
  });

  it("clears the conflicting star adaptive key when editing ratio vs point height", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[star,star points=5,star point ratio=1.65] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, { source, editHandles: rendered.semantic.editHandles });
    const pointHeight = getNodePropertyById(descriptor, "node-shape-star-point-height");
    const pointRatio = getNodePropertyById(descriptor, "node-shape-star-point-ratio");
    if (!pointHeight || pointHeight.kind !== "length") {
      throw new Error("Expected star point-height length property");
    }
    if (!pointRatio || pointRatio.kind !== "number") {
      throw new Error("Expected star point-ratio number property");
    }
    if (!pointHeight.write || !pointRatio.write) {
      throw new Error("Expected write targets for star adaptive properties");
    }

    const heightResult = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: pointHeight.write.elementId,
      level: pointHeight.write.level,
      key: pointHeight.write.key,
      value: "9pt",
      clearKeys: pointHeight.clearKeys
    });
    expect(heightResult.kind).toBe("success");
    if (heightResult.kind !== "success") {
      throw new Error("Expected successful star point-height mutation");
    }
    expect(heightResult.newSource).toContain("star point height=9pt");
    expect(heightResult.newSource).not.toContain("star point ratio=");

    const ratioResult = applyEditAction(heightResult.newSource, [], {
      kind: "setProperty",
      elementId: pointRatio.write.elementId,
      level: pointRatio.write.level,
      key: pointRatio.write.key,
      value: "1.9",
      clearKeys: pointRatio.clearKeys
    });
    expect(ratioResult.kind).toBe("success");
    if (ratioResult.kind !== "success") {
      throw new Error("Expected successful star point-ratio mutation");
    }
    expect(ratioResult.newSource).toContain("star point ratio=1.9");
    expect(ratioResult.newSource).not.toContain("star point height=");
  });

  it("shows shape border rotate only for shapes that use rotation in semantic rendering", () => {
    const withRotationSource = String.raw`\begin{tikzpicture}
  \node[star,shape border rotate=10] at (0,0) {A};
\end{tikzpicture}`;
    const withoutRotationSource = String.raw`\begin{tikzpicture}
  \node[diamond,aspect=1.2] at (0,0) {A};
\end{tikzpicture}`;

    const withRotationText = renderTikzToSvg(withRotationSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const withoutRotationText = renderTikzToSvg(withoutRotationSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(withRotationText).toBeDefined();
    expect(withoutRotationText).toBeDefined();
    if (!withRotationText || !withoutRotationText) {
      throw new Error("Expected text elements");
    }

    const withRotationDescriptor = getInspectorDescriptor(withRotationText, { source: withRotationSource });
    const withoutRotationDescriptor = getInspectorDescriptor(withoutRotationText, { source: withoutRotationSource });
    const withRotation = getNodePropertyById(withRotationDescriptor, "node-shape-star-border-rotate");
    const withoutRotation = getNodePropertyById(withoutRotationDescriptor, "node-shape-diamond-border-rotate");

    expect(withRotation).toBeDefined();
    expect(withRotation?.kind).toBe("number");
    expect(withoutRotation).toBeUndefined();
  });

  it("merges adaptive properties for same-shape multi-selection and hides them for mixed shapes", () => {
    const sameShapeSource = String.raw`\begin{tikzpicture}
  \node[star,star points=5] at (0,0) {A};
  \node[star,star points=7] at (2,0) {B};
\end{tikzpicture}`;
    const mixedShapeSource = String.raw`\begin{tikzpicture}
  \node[star,star points=5] at (0,0) {A};
  \node[trapezium,trapezium left angle=70] at (2,0) {B};
\end{tikzpicture}`;

    const sameTexts = renderTikzToSvg(sameShapeSource).semantic.scene.elements.filter((entry) => entry.kind === "Text");
    const mixedTexts = renderTikzToSvg(mixedShapeSource).semantic.scene.elements.filter((entry) => entry.kind === "Text");
    expect(sameTexts).toHaveLength(2);
    expect(mixedTexts).toHaveLength(2);
    if (sameTexts.length !== 2 || mixedTexts.length !== 2) {
      throw new Error("Expected two text elements in each source");
    }

    const sameDescriptors = sameTexts.map((entry) => getInspectorDescriptor(entry, { source: sameShapeSource }));
    const mixedDescriptors = mixedTexts.map((entry) => getInspectorDescriptor(entry, { source: mixedShapeSource }));
    const sameMulti = buildMultiInspectorModel(sameDescriptors, sameDescriptors.length);
    const mixedMulti = buildMultiInspectorModel(mixedDescriptors, mixedDescriptors.length);

    const sameNode = sameMulti.sections.find((section) => section.id === "node");
    const mixedNode = mixedMulti.sections.find((section) => section.id === "node");
    expect(sameNode).toBeDefined();
    expect(mixedNode).toBeDefined();
    if (!sameNode || !mixedNode) {
      throw new Error("Expected node sections");
    }

    const sameStarPoints = sameNode.properties.find((property) => property.id === "node-shape-star-points");
    expect(sameStarPoints).toBeDefined();
    expect(sameStarPoints && "mixed" in sameStarPoints ? sameStarPoints.mixed : false).toBe(true);

    const mixedAdaptive = mixedNode.properties.filter(
      (property) =>
        property.id.startsWith("node-shape-star-")
        || property.id.startsWith("node-shape-trapezium-")
    );
    expect(mixedAdaptive).toHaveLength(0);
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

  it("resolves node minimum width/height from minimum size and replaces shared sizing on edit", () => {
    const defaultSource = String.raw`\begin{tikzpicture}
  \node[rectangle] at (0,0) {A};
\end{tikzpicture}`;
    const sharedSource = String.raw`\begin{tikzpicture}
  \node[minimum size=12pt] at (0,0) {A};
\end{tikzpicture}`;
    const mixedSource = String.raw`\begin{tikzpicture}
  \node[minimum width=4pt,minimum size=10pt] at (0,0) {A};
\end{tikzpicture}`;

    const defaultElement = renderTikzToSvg(defaultSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const sharedElement = renderTikzToSvg(sharedSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const mixedElement = renderTikzToSvg(mixedSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(defaultElement).toBeDefined();
    expect(sharedElement).toBeDefined();
    expect(mixedElement).toBeDefined();
    if (!defaultElement || !sharedElement || !mixedElement) {
      throw new Error("Expected text elements");
    }

    const defaultMinimumWidth = getNodeLengthProperty(getInspectorDescriptor(defaultElement, { source: defaultSource }), "node-minimum-width");
    const defaultMinimumHeight = getNodeLengthProperty(getInspectorDescriptor(defaultElement, { source: defaultSource }), "node-minimum-height");
    expect(defaultMinimumWidth.value).toBeCloseTo(1, 6);
    expect(defaultMinimumHeight.value).toBeCloseTo(1, 6);

    const sharedMinimumWidth = getNodeLengthProperty(getInspectorDescriptor(sharedElement, { source: sharedSource }), "node-minimum-width");
    const sharedMinimumHeight = getNodeLengthProperty(getInspectorDescriptor(sharedElement, { source: sharedSource }), "node-minimum-height");
    expect(sharedMinimumWidth.value).toBeCloseTo(12, 6);
    expect(sharedMinimumHeight.value).toBeCloseTo(12, 6);
    expect(sharedMinimumWidth.note).toContain("minimum size detected");
    expect(sharedMinimumHeight.note).toContain("minimum size detected");

    const mixedMinimumWidth = getNodeLengthProperty(getInspectorDescriptor(mixedElement, { source: mixedSource }), "node-minimum-width");
    const mixedMinimumHeight = getNodeLengthProperty(getInspectorDescriptor(mixedElement, { source: mixedSource }), "node-minimum-height");
    expect(mixedMinimumWidth.value).toBeCloseTo(10, 6);
    expect(mixedMinimumHeight.value).toBeCloseTo(10, 6);

    const mutationSet = buildNodeMinimumDimensionSetPropertyMutations(
      { minimumWidth: 12, minimumHeight: 12 },
      "minimum width",
      14
    );
    expect(mutationSet).toEqual([
      {
        key: "minimum width",
        value: "14pt",
        clearKeys: ["minimum size"]
      },
      {
        key: "minimum height",
        value: "12pt",
        clearKeys: ["minimum size"]
      }
    ]);

    const update = applyEditAction(sharedSource, [], {
      kind: "setProperty",
      elementId: sharedMinimumWidth.write.elementId,
      level: sharedMinimumWidth.write.level,
      key: mutationSet[0]!.key,
      value: mutationSet[0]!.value,
      clearKeys: mutationSet[0]!.clearKeys
    });
    expect(update.kind).toBe("success");
    if (update.kind !== "success") {
      throw new Error("Expected successful minimum size mutation");
    }
    const update2 = applyEditAction(update.newSource, [], {
      kind: "setProperty",
      elementId: sharedMinimumWidth.write.elementId,
      level: sharedMinimumWidth.write.level,
      key: mutationSet[1]!.key,
      value: mutationSet[1]!.value,
      clearKeys: mutationSet[1]!.clearKeys
    });
    expect(update2.kind).toBe("success");
    if (update2.kind !== "success") {
      throw new Error("Expected successful companion minimum mutation");
    }
    expect(update2.newSource).toContain("minimum width=14pt");
    expect(update2.newSource).toContain("minimum height=12pt");
    expect(update2.newSource).not.toContain("minimum size=");
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

describe("resolvePropertyTarget – matrix cells", () => {
  it("resolves matrix statement ids to matrix-statement targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,row sep=2mm,column sep=3mm] {
    A & B \\
  };
\end{tikzpicture}`;

    const resolved = resolvePropertyTarget(source, "path:0");
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected matrix statement target");
    }

    expect(resolved.target.kind).toBe("matrix-statement");
    expect(resolved.target.optionsSpan).toBeDefined();
    expect(resolved.target.matrixKind).toBe("nodes");
    expect(resolved.target.matrixTextMode).toBe("text");
  });

  it("resolves matrix-cell synthetic ids to cell text spans", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw,fill=yellow]| BC \\
  };
\end{tikzpicture}`;

    const resolved = resolvePropertyTarget(source, "node:0:0:matrix-cell:1:2");
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected matrix-cell target");
    }

    expect(resolved.target.kind).toBe("matrix-cell");
    expect(resolved.target.matrixSourceId).toBe("path:0");
    expect(resolved.target.row).toBe(1);
    expect(resolved.target.column).toBe(2);
    expect(resolved.target.textSpan).toBeDefined();
    expect(resolved.target.optionSpan).toBeDefined();
    if (resolved.target.textSpan) {
      expect(source.slice(resolved.target.textSpan.from, resolved.target.textSpan.to)).toBe("BC");
    }
    if (resolved.target.optionSpan) {
      expect(source.slice(resolved.target.optionSpan.from, resolved.target.optionSpan.to)).toBe("[draw,fill=yellow]");
    }
  });

  it("allows supported matrix-cell inspector writes for matrix of nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,nodes={draw}] {
    A & B \\
  };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const matrixCellText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.matrixCell?.cellSourceId === "node:0:0:matrix-cell:1:1"
    );
    expect(matrixCellText).toBeDefined();
    if (!matrixCellText) {
      throw new Error("Expected matrix cell text element");
    }

    const descriptor = getInspectorDescriptor(matrixCellText, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(false);

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
    expect(strokeColor.write.writable).toBe(true);
    const lineWidth = strokeSection.properties.find((property) => property.kind === "lineWidth");
    expect(lineWidth).toBeDefined();
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected stroke line width property");
    }
    expect(lineWidth.write.writable).toBe(true);
  });

  it("allows supported matrix-cell inspector writes for matrix of math nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of math nodes,nodes={draw}] {
    x^2 & y^2 \\
  };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const matrixCellText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.matrixCell?.cellSourceId === "node:0:0:matrix-cell:1:1"
    );
    expect(matrixCellText).toBeDefined();
    if (!matrixCellText) {
      throw new Error("Expected matrix cell text element");
    }

    const descriptor = getInspectorDescriptor(matrixCellText, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(false);
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
    expect(strokeColor.write.writable).toBe(true);
    const lineWidth = strokeSection.properties.find((property) => property.kind === "lineWidth");
    expect(lineWidth).toBeDefined();
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected stroke line width property");
    }
    expect(lineWidth.write.writable).toBe(true);
  });

  it("keeps plain matrix-cell inspector writes read-only", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix {
    A & B \\
  };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const matrixCellText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.matrixCell?.cellSourceId === "node:0:0:matrix-cell:1:1"
    );
    expect(matrixCellText).toBeDefined();
    if (!matrixCellText) {
      throw new Error("Expected matrix cell text element");
    }

    const descriptor = getInspectorDescriptor(matrixCellText, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(false);
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
    expect(strokeColor.write.writable).toBe(false);
    const lineWidth = strokeSection.properties.find((property) => property.kind === "lineWidth");
    expect(lineWidth).toBeDefined();
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected stroke line width property");
    }
    expect(lineWidth.write.writable).toBe(false);
  });
});

describe("resolvePropertyTarget – tree children", () => {
  it("resolves synthetic tree-child ids with child/node spans", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=4mm] { node[draw,fill=yellow] {left} }
    child { node {right} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    expect(leftText?.kind).toBe("Text");
    if (!leftText || leftText.kind !== "Text" || !leftText.treeChild) {
      throw new Error("Expected a tree child text element");
    }

    const resolved = resolvePropertyTarget(source, leftText.treeChild.childSourceId);
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected tree-child property target");
    }
    expect(resolved.target.kind).toBe("tree-child");
    expect(resolved.target.childOperationId).toBe(leftText.treeChild.childOperationId);
    expect(resolved.target.treeChildForeach).toBe(false);
    expect(resolved.target.treeChildOptionsSpan).toBeDefined();
    expect(resolved.target.treeNodeOptionsSpan).toBeDefined();
    expect(resolved.target.textSpan).toBeDefined();
    if (resolved.target.treeChildOptionsSpan) {
      expect(source.slice(resolved.target.treeChildOptionsSpan.from, resolved.target.treeChildOptionsSpan.to)).toBe("[level distance=4mm]");
    }
    if (resolved.target.treeNodeOptionsSpan) {
      expect(source.slice(resolved.target.treeNodeOptionsSpan.from, resolved.target.treeNodeOptionsSpan.to)).toBe("[draw,fill=yellow]");
    }
    if (resolved.target.textSpan) {
      expect(source.slice(resolved.target.textSpan.from, resolved.target.textSpan.to)).toBe("left");
    }
  });

  it("marks child foreach tree children as read-only targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child foreach \x in {A,B} { node {\x} };
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const path = parsed.figure.body.find((statement) => statement.kind === "Path");
    if (!path || path.kind !== "Path") {
      throw new Error("Expected path statement");
    }
    const childOperation = path.items.find((item) => item.kind === "ChildOperation");
    if (!childOperation || childOperation.kind !== "ChildOperation") {
      throw new Error("Expected child operation");
    }
    const syntheticChildId = `${path.id}:tree-child:1:${childOperation.id}`;
    const resolved = resolvePropertyTarget(source, syntheticChildId);
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected tree-child property target");
    }
    expect(resolved.target.kind).toBe("tree-child");
    expect(resolved.target.treeChildForeach).toBe(true);
  });

  it("builds tree-child descriptors with node controls and without Transform/Child Layout", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=3mm,sibling distance=7mm] { node[draw,fill=yellow] {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    expect(leftText?.kind).toBe("Text");
    if (!leftText || leftText.kind !== "Text") {
      throw new Error("Expected tree child text element");
    }

    const descriptor = getInspectorDescriptor(leftText, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(false);
    expect(descriptor.sections.some((section) => section.id === "tree-child-layout")).toBe(false);
    expect(descriptor.sections.some((section) => section.id === "node")).toBe(true);
    const lineWidth = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "lineWidth");
    expect(lineWidth?.kind).toBe("lineWidth");
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected lineWidth property");
    }
    expect(lineWidth.write.writable).toBe(true);
  });

  it("keeps tree-child write targeting on the synthetic child id when style-chain command points at root path", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node[draw] {root}
    child { node[draw,fill=yellow] {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    expect(leftText?.kind).toBe("Text");
    if (!leftText || leftText.kind !== "Text" || !leftText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const rootText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "root"
    );
    expect(rootText?.kind).toBe("Text");
    if (!rootText || rootText.kind !== "Text") {
      throw new Error("Expected root text element");
    }
    const syntheticStyleChainElement = {
      ...leftText,
      styleChain: rootText.styleChain
    };

    const descriptor = getInspectorDescriptor(syntheticStyleChainElement, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.writeTargetId).toBe(leftText.treeChild.childSourceId);
    const writableFillProperty = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "color" && property.write.key === "fill");
    expect(writableFillProperty).toBeDefined();
    if (!writableFillProperty || writableFillProperty.kind !== "color") {
      throw new Error("Expected fill color property");
    }
    expect(writableFillProperty.write.elementId).toBe(leftText.treeChild.childSourceId);
    expect(writableFillProperty.write.writable).toBe(true);
  });

  it("keeps tree-child descriptors read-only for child foreach expansions", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child foreach \x in {A,B} { node[draw] {\x} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const rootText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "root"
    );
    if (!rootText || rootText.kind !== "Text") {
      throw new Error("Expected root text element");
    }

    const parsed = parseTikz(source, { recover: true });
    const path = parsed.figure.body.find((statement) => statement.kind === "Path");
    if (!path || path.kind !== "Path") {
      throw new Error("Expected path statement");
    }
    const childOperation = path.items.find((item) => item.kind === "ChildOperation");
    if (!childOperation || childOperation.kind !== "ChildOperation") {
      throw new Error("Expected child operation");
    }
    const syntheticChildId = `${path.id}:tree-child:1:${childOperation.id}`;
    const fakeTreeChildElement = {
      ...rootText,
      styleChain: [],
      sourceRef: {
        ...rootText.sourceRef,
        sourceId: syntheticChildId
      }
    };

    const descriptor = getInspectorDescriptor(fakeTreeChildElement, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.readOnlyReason).toContain("child foreach");
    expect(descriptor.sections.some((section) => section.id === "tree-child-layout")).toBe(false);
    expect(descriptor.sections.some((section) => section.id === "node")).toBe(true);
  });

  it("builds root tree descriptor with transform, layout, and node controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[grow=right,level distance=6mm] node[draw] {root}
    child[sibling distance=5mm] { node[fill=yellow] {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const rootText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "root"
    );
    expect(rootText?.kind).toBe("Text");
    if (!rootText) {
      throw new Error("Expected root tree text element");
    }

    const descriptor = buildTreeInspectorDescriptor(source, "path:0", rootText, {});
    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error("Expected tree root descriptor");
    }
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(true);
    expect(descriptor.sections.some((section) => section.id === "tree-layout")).toBe(true);
    expect(descriptor.sections.some((section) => section.id === "node")).toBe(true);
  });

  it("chooses root layout write targets by existing key site with path fallback", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[level distance=4mm] node[sibling distance=3mm] {root}
    child { node {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const rootText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "root"
    );
    expect(rootText?.kind).toBe("Text");
    if (!rootText) {
      throw new Error("Expected root tree text element");
    }

    const descriptor = buildTreeInspectorDescriptor(source, "path:0", rootText, {});
    if (!descriptor) {
      throw new Error("Expected tree root descriptor");
    }
    const treeLayout = descriptor.sections.find((section) => section.id === "tree-layout");
    expect(treeLayout).toBeDefined();
    if (!treeLayout) {
      throw new Error("Expected tree layout section");
    }
    const levelDistance = treeLayout.properties.find((property) => property.id === "tree-level-distance");
    const siblingDistance = treeLayout.properties.find((property) => property.id === "tree-sibling-distance");
    const grow = treeLayout.properties.find((property) => property.id === "tree-grow");
    expect(levelDistance?.kind).toBe("length");
    expect(siblingDistance?.kind).toBe("length");
    expect(grow?.kind).toBe("enum");
    if (!levelDistance || levelDistance.kind !== "length" || !siblingDistance || siblingDistance.kind !== "length" || !grow || grow.kind !== "enum") {
      throw new Error("Expected tree layout properties");
    }
    const nodeSection = descriptor.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }
    const nodeShape = nodeSection.properties.find((property) => property.id === "node-shape");
    expect(nodeShape?.kind).toBe("nodeShape");
    if (!nodeShape || nodeShape.kind !== "nodeShape") {
      throw new Error("Expected node shape write target");
    }

    expect(levelDistance.write.elementId).toBe("path:0");
    expect(siblingDistance.write.elementId).toBe(nodeShape.write.elementId);
    expect(grow.write.elementId).toBe("path:0");
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

function getNodePropertyById(descriptor: ReturnType<typeof getInspectorDescriptor>, propertyId: string) {
  const nodeSection = descriptor.sections.find((section) => section.id === "node");
  if (!nodeSection) {
    throw new Error("Expected node section");
  }
  return nodeSection.properties.find((property) => property.id === propertyId);
}

function getNodeLengthProperty(
  descriptor: ReturnType<typeof getInspectorDescriptor>,
  propertyId: "node-inner-sep" | "node-minimum-width" | "node-minimum-height"
) {
  const nodeSection = descriptor.sections.find((section) => section.id === "node");
  if (!nodeSection) {
    throw new Error("Expected node section");
  }
  const property = nodeSection.properties.find((entry) => entry.id === propertyId);
  if (!property || property.kind !== "length") {
    throw new Error(`Expected node length property for ${propertyId}`);
  }
  return property;
}

function getNodeInnerSepProperty(descriptor: ReturnType<typeof getInspectorDescriptor>) {
  return getNodeLengthProperty(descriptor, "node-inner-sep");
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
