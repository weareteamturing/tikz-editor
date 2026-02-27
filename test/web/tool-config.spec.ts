import { describe, expect, it } from "vitest";
import { resolveToolbarToolMode } from "../../web/src/ui/tool-config.js";

describe("resolveToolbarToolMode", () => {
  it("deactivates non-select tool when reclicked", () => {
    expect(resolveToolbarToolMode("addRect", "addRect")).toBe("select");
    expect(resolveToolbarToolMode("addNode", "addNode")).toBe("select");
  });

  it("keeps select active when reclicking select", () => {
    expect(resolveToolbarToolMode("select", "select")).toBe("select");
  });

  it("switches to clicked mode for normal tool changes", () => {
    expect(resolveToolbarToolMode("select", "addLine")).toBe("addLine");
    expect(resolveToolbarToolMode("addArrow", "addEllipse")).toBe("addEllipse");
  });
});
