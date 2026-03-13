import { describe, expect, it } from "vitest";
import {
  isToolCreateMode,
  resolveToolbarToolMode,
  toolModeFromShortcut,
  toolModeHasPopup,
  toolModePopupKind
} from "../../packages/app/src/ui/tool-config.js";

describe("resolveToolbarToolMode", () => {
  it("deactivates non-select tool when reclicked", () => {
    expect(resolveToolbarToolMode("addRect", "addRect")).toBe("select");
    expect(resolveToolbarToolMode("addNode", "addNode")).toBe("select");
  });

  it("keeps popup-enabled tool active when reclicked", () => {
    expect(resolveToolbarToolMode("addFreehand", "addFreehand")).toBe("addFreehand");
  });

  it("keeps select active when reclicking select", () => {
    expect(resolveToolbarToolMode("select", "select")).toBe("select");
  });

  it("switches to clicked mode for normal tool changes", () => {
    expect(resolveToolbarToolMode("select", "addLine")).toBe("addLine");
    expect(resolveToolbarToolMode("addArrow", "addEllipse")).toBe("addEllipse");
  });

  it("maps keyboard shortcut B to addBezier", () => {
    expect(toolModeFromShortcut("b")).toBe("addBezier");
    expect(toolModeFromShortcut("B")).toBe("addBezier");
  });

  it("maps keyboard shortcut P to addPath", () => {
    expect(toolModeFromShortcut("p")).toBe("addPath");
    expect(toolModeFromShortcut("P")).toBe("addPath");
  });

  it("maps keyboard shortcut F to addFreehand", () => {
    expect(toolModeFromShortcut("f")).toBe("addFreehand");
    expect(toolModeFromShortcut("F")).toBe("addFreehand");
  });

  it("treats addBezier as a tool-create mode", () => {
    expect(isToolCreateMode("addBezier")).toBe(true);
    expect(isToolCreateMode("addPath")).toBe(true);
    expect(isToolCreateMode("addFreehand")).toBe(false);
    expect(isToolCreateMode("select")).toBe(false);
  });

  it("treats addGrid as a create mode without a keyboard shortcut", () => {
    expect(isToolCreateMode("addGrid")).toBe(true);
    expect(toolModeFromShortcut("g")).toBeNull();
    expect(toolModeFromShortcut("G")).toBeNull();
  });

  it("exposes popup metadata for freehand and no popup for rectangle", () => {
    expect(toolModeHasPopup("addFreehand")).toBe(true);
    expect(toolModePopupKind("addFreehand")).toBe("freehand-smoothing");
    expect(toolModeHasPopup("addRect")).toBe(false);
    expect(toolModePopupKind("addRect")).toBeNull();
  });
});
