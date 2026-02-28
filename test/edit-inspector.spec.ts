import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../src/render/index.js";
import { applyEditAction } from "../src/edit/actions.js";
import {
  buildArrowTipSetPropertyMutation,
  buildRoundedCornersSetPropertyMutation,
  buildPathMorphingDecorationSetPropertyMutations,
  getInspectorDescriptor
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
});
