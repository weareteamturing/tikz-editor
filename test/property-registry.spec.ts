import { describe, expect, it } from "vitest";
import { parseOptionListRaw } from "../packages/core/src/options/parse.js";
import * as inspectorModule from "../packages/core/src/edit/inspector.js";
import {
  PROPERTY_REGISTRY,
  candidateKeysForProperty,
  getPropertySemantics,
  isAddableProperty,
  isDefaultOmissionEligible,
  propertyCleanupKinds,
  propertyIdForOptionEntry,
  propertyIdForStyleContribution
} from "../packages/core/src/edit/property-registry.js";

describe("property registry", () => {
  it("exposes stable metadata for core writable properties", () => {
    expect(PROPERTY_REGISTRY.get("stroke-color")?.primaryKey).toBe("draw");
    expect(candidateKeysForProperty("stroke-color")).toEqual(expect.arrayContaining(["draw", "color"]));
    expect(candidateKeysForProperty("dash-style")).toEqual(expect.arrayContaining(["solid", "dash pattern", "dash phase"]));
    expect(candidateKeysForProperty("rounded-corners")).toEqual(expect.arrayContaining(["rounded corners", "sharp corners"]));
    expect(candidateKeysForProperty("transform.xshift")).toEqual(expect.arrayContaining(["xshift", "shift", "/tikz/xshift"]));
  });

  it("maps option entries to semantic properties only when supported by the target property set", () => {
    const entries = parseOptionListRaw("[draw=red, fill=blue, foo=baz, rounded corners]").entries;
    const [drawEntry, fillEntry, unsupportedEntry, roundedEntry] = entries;
    expect(drawEntry).toBeDefined();
    expect(fillEntry).toBeDefined();
    expect(unsupportedEntry).toBeDefined();
    expect(roundedEntry).toBeDefined();
    if (!drawEntry || !fillEntry || !unsupportedEntry || !roundedEntry) {
      throw new Error("Expected parsed option entries");
    }
    expect(propertyIdForOptionEntry(drawEntry, ["stroke-color", "fill-color"])).toBe("stroke-color");
    expect(propertyIdForOptionEntry(fillEntry, ["stroke-color", "fill-color"])).toBe("fill-color");
    expect(propertyIdForOptionEntry(unsupportedEntry, ["stroke-color", "fill-color"])).toBeNull();
    expect(propertyIdForOptionEntry(roundedEntry, ["rounded-corners"])).toBe("rounded-corners");
  });

  it("maps style contributions through registry metadata", () => {
    expect(propertyIdForStyleContribution("stroke", ["stroke-color"])).toBe("stroke-color");
    expect(propertyIdForStyleContribution("fillPattern", ["fill-pattern", "fill-mode"])).toBe("fill-pattern");
    expect(propertyIdForStyleContribution("fillPattern", ["fill-mode"])).toBe("fill-mode");
    expect(propertyIdForStyleContribution("fontSize", ["node-font"])).toBeNull();
  });

  it("keeps cleanup and default omission gated by registered semantics", () => {
    expect(propertyCleanupKinds("stroke-color")).toContain("paint-command");
    expect(propertyCleanupKinds("fill-color")).toContain("paint-command");
    expect(isDefaultOmissionEligible("line-cap")).toBe(true);
    expect(isDefaultOmissionEligible("stroke-color")).toBe(false);
    expect(isDefaultOmissionEligible("foo")).toBe(false);
  });

  it("identifies addable properties from registry metadata", () => {
    expect(isAddableProperty("line-cap", "lineCap")).toBe(true);
    expect(isAddableProperty("xshift", "number")).toBe(true);
    expect(isAddableProperty("fill-mode", "fillMode")).toBe(true);
    expect(isAddableProperty("arrow-tip")).toBe(false);
    expect(getPropertySemantics("foo")).toBeNull();
  });

  it("keeps mutation builders out of the inspector module", () => {
    expect("buildTransformSetPropertyMutations" in inspectorModule).toBe(false);
    expect("buildFillModeSetPropertyMutations" in inspectorModule).toBe(false);
    expect("buildRoundedCornersSetPropertyMutation" in inspectorModule).toBe(false);
  });
});
