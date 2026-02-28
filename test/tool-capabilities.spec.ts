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
  });
});
