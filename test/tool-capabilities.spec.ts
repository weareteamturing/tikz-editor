import { describe, expect, it } from "vitest";
import type { InspectorProperty } from "../src/edit/inspector.js";
import {
  getInspectorPropertyCapabilityStatus,
  getToolCapabilityStatus
} from "../web/src/ui/capabilities.js";

describe("tool capability status", () => {
  it("reports select/addNode as supported", () => {
    expect(getToolCapabilityStatus("select").status).toBe("supported");
    expect(getToolCapabilityStatus("addNode").status).toBe("supported");
  });

  it("treats add tools as supported when parse/semantic/svg support is stable", () => {
    expect(getToolCapabilityStatus("addLine").status).toBe("supported");
    expect(getToolCapabilityStatus("addArrow").status).toBe("supported");
    expect(getToolCapabilityStatus("addBezier").status).toBe("partial");
    expect(getToolCapabilityStatus("addRect").status).toBe("supported");
    expect(getToolCapabilityStatus("addEllipse").status).toBe("supported");
    expect(getToolCapabilityStatus("addCircle").status).toBe("supported");
  });
});

describe("inspector property capability status", () => {
  it("keeps arrow-tip editing enabled through option-level support", () => {
    const arrowProperty: InspectorProperty = {
      kind: "arrowTip",
      id: "arrow-tip-end",
      label: "End arrow type",
      side: "end",
      value: "arrow",
      options: [{ value: "arrow", label: "Arrow" }],
      previewLineWidth: 0.8,
      write: {
        mode: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "arrows",
        writable: true,
        arrowContext: {
          startRaw: "",
          endRaw: ">",
          clearKeys: ["arrows", "-", "->", "<-", "<->"]
        }
      }
    };
    expect(getInspectorPropertyCapabilityStatus(arrowProperty).status).toBe("partial");

    const pathMorphingProperty: InspectorProperty = {
      kind: "pathMorphingDecoration",
      id: "path-morphing-decoration",
      label: "Path morphing",
      value: "zigzag",
      options: [{ value: "zigzag", label: "Zigzag" }],
      previewLineWidth: 0.8,
      write: {
        mode: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "decorate",
        writable: true
      }
    };
    expect(getInspectorPropertyCapabilityStatus(pathMorphingProperty).status).toBe("partial");

    const colorProperty: InspectorProperty = {
      kind: "color",
      id: "stroke-color",
      label: "Color",
      value: "blue",
      syntaxValue: "blue",
      options: ["blue", "red"],
      write: {
        mode: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "draw",
        writable: true
      }
    };
    expect(getInspectorPropertyCapabilityStatus(colorProperty).status).toBe("partial");

    const fillModeProperty: InspectorProperty = {
      kind: "fillMode",
      id: "fill-mode",
      label: "Mode",
      value: "gradient",
      options: [
        { value: "solid", label: "Solid" },
        { value: "gradient", label: "Gradient" },
        { value: "pattern", label: "Pattern" }
      ],
      context: {
        fillColor: "blue",
        patternColor: "red",
        shading: "axis",
        pattern: "grid"
      },
      write: {
        mode: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "fill",
        writable: true
      }
    };
    expect(getInspectorPropertyCapabilityStatus(fillModeProperty).status).toBe("partial");

    const fillShadingProperty: InspectorProperty = {
      kind: "fillShading",
      id: "fill-shading",
      label: "Shading",
      value: "axis",
      options: [
        { value: "axis", label: "Axis" },
        { value: "radial", label: "Radial" },
        { value: "ball", label: "Ball" }
      ],
      write: {
        mode: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "shading",
        writable: true
      }
    };
    expect(getInspectorPropertyCapabilityStatus(fillShadingProperty).status).toBe("partial");

    const fillPatternProperty: InspectorProperty = {
      kind: "fillPattern",
      id: "fill-pattern",
      label: "Pattern",
      value: "grid",
      options: [{ value: "grid", label: "grid" }],
      write: {
        mode: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "pattern",
        writable: true
      }
    };
    expect(getInspectorPropertyCapabilityStatus(fillPatternProperty).status).toBe("partial");

    const fillPatternOptionProperty: InspectorProperty = {
      kind: "fillPatternOption",
      id: "fill-pattern-distance",
      label: "Distance",
      option: "distance",
      value: 3,
      step: 0.1,
      unit: "pt",
      context: {
        family: "Lines",
        values: {
          angle: 0,
          distance: 3,
          xshift: 0,
          yshift: 0,
          lineWidth: 0.4,
          radius: 0.5,
          points: 5
        }
      },
      write: {
        mode: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "pattern",
        writable: true
      }
    };
    expect(getInspectorPropertyCapabilityStatus(fillPatternOptionProperty).status).toBe("partial");

    const roundedCornersProperty: InspectorProperty = {
      kind: "roundedCorners",
      id: "rounded-corners",
      label: "Rounded corners",
      enabled: true,
      radius: 4,
      defaultRadius: 4,
      min: 0.1,
      max: 24,
      step: 0.1,
      write: {
        mode: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "rounded corners",
        writable: true
      }
    };
    expect(getInspectorPropertyCapabilityStatus(roundedCornersProperty).status).toBe("partial");

    const transformNumberProperty: InspectorProperty = {
      kind: "number",
      id: "xscale",
      label: "X scale",
      value: 2,
      step: 0.1,
      write: {
        mode: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "xscale",
        writable: true
      }
    };
    expect(getInspectorPropertyCapabilityStatus(transformNumberProperty).status).toBe("partial");
  });
});
