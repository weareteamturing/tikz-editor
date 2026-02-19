import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../src/render/index.js";
import { getInspectorDescriptor } from "../src/edit/inspector.js";

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
    const arrow = arrowSection.properties.find((property) => property.kind === "arrowTip");
    expect(arrow).toBeDefined();
    if (!arrow || arrow.kind !== "arrowTip") {
      throw new Error("Expected arrow direction property");
    }
    expect(arrow.value).toBe("->");
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
});
