import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../src/render/index.js";
import { applyEditAction } from "../src/edit/actions.js";
import { buildArrowTipSetPropertyMutation, getInspectorDescriptor } from "../src/edit/inspector.js";

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

    const arrowSection = descriptor.sections.find((section) => section.id === "arrows");
    expect(arrowSection).toBeDefined();
    if (!arrowSection) {
      throw new Error("Expected arrow tips section");
    }
    const arrowProperties = arrowSection.properties.filter((property) => property.kind === "arrowTip");
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

    const arrowSection = descriptor.sections.find((section) => section.id === "arrows");
    expect(arrowSection).toBeUndefined();
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
    const arrowSection = descriptor.sections.find((section) => section.id === "arrows");
    expect(arrowSection).toBeDefined();
    if (!arrowSection) {
      throw new Error("Expected arrow tips section");
    }

    const beginArrow = arrowSection.properties.find(
      (property) => property.kind === "arrowTip" && property.side === "start"
    );
    const endArrow = arrowSection.properties.find(
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
    const arrowSection = descriptor.sections.find((section) => section.id === "arrows");
    expect(arrowSection).toBeDefined();
    if (!arrowSection) {
      throw new Error("Expected arrow tips section");
    }
    const endArrow = arrowSection.properties.find(
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
});
