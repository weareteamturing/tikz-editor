import { describe, expect, it } from "vitest";

import { FEATURE_IDS } from "../src/capabilities/feature-ids.js";
import { capabilityMatrix } from "../src/capabilities/matrix.js";
import {
  editFeatureRegistry,
  parserFeatureRegistry,
  semanticFeatureRegistry,
  svgFeatureRegistry
} from "../src/capabilities/registries.js";
import { renderTikzToSvg } from "../src/render/index.js";
import { capabilityFixtures } from "./capability-fixtures.js";

describe("capability matrix guards", () => {
  it("has exact matrix coverage for all feature IDs", () => {
    const matrixKeys = Object.keys(capabilityMatrix).sort();
    expect(matrixKeys).toEqual([...FEATURE_IDS].sort());
  });

  it("requires fixture references for every feature row", () => {
    for (const featureId of FEATURE_IDS) {
      const row = capabilityMatrix[featureId];
      expect(row.fixtures.length, `Expected fixtures for ${featureId}`).toBeGreaterThan(0);
      for (const fixtureId of row.fixtures) {
        expect(capabilityFixtures[fixtureId], `Unknown fixture ${fixtureId} for ${featureId}`).toBeTypeOf("string");
      }
    }
  });

  it("keeps layer registries aligned with matrix statuses", () => {
    assertRegistryMatchesLayer("parser", parserFeatureRegistry);
    assertRegistryMatchesLayer("semantic", semanticFeatureRegistry);
    assertRegistryMatchesLayer("svg", svgFeatureRegistry);
    assertRegistryMatchesLayer("edit", editFeatureRegistry);
  });

  it("fails if stable semantic features are still unsupported", () => {
    for (const featureId of FEATURE_IDS) {
      const row = capabilityMatrix[featureId];
      for (const fixtureId of row.fixtures) {
        const source = capabilityFixtures[fixtureId];
        const result = renderTikzToSvg(source);

        const semanticUsage = result.semantic.featureUsage[featureId];
        if (row.semantic === "stable") {
          expect(
            semanticUsage,
            `Feature ${featureId} is stable in semantic matrix but not supported in fixture ${fixtureId}`
          ).toBe("used-supported");
        }

        if (row.semantic === "partial") {
          expect(
            semanticUsage,
            `Feature ${featureId} is semantic=partial but not exercised in fixture ${fixtureId}`
          ).not.toBe("unused");
        }

        if (row.semantic === "none") {
          expect(
            semanticUsage,
            `Feature ${featureId} is marked semantic=none but appears supported in fixture ${fixtureId}`
          ).not.toBe("used-supported");
        }
      }
    }
  });

  it("fails if stable SVG features are not emitted", () => {
    for (const featureId of FEATURE_IDS) {
      const row = capabilityMatrix[featureId];
      if (row.svg !== "stable") {
        continue;
      }

      for (const fixtureId of row.fixtures) {
        const source = capabilityFixtures[fixtureId];
        const rendered = renderTikzToSvg(source);
        const svg = rendered.svg.svg;

        if (featureId === "svg_path") {
          expect(svg).toContain("<path");
        }
        if (featureId === "svg_circle") {
          expect(svg).toContain("<circle");
        }
        if (featureId === "svg_text") {
          expect(svg).toContain("<text");
        }
        if (featureId === "render_pipeline") {
          expect(svg).toContain("<svg");
        }
        if (featureId === "arrow_tips") {
          expect(svg).toContain("marker-end=");
          expect(svg).toContain("<defs>");
        }
      }
    }
  });
});

function assertRegistryMatchesLayer(
  layer: "parser" | "semantic" | "svg" | "edit",
  registry: readonly (typeof FEATURE_IDS)[number][]
): void {
  const registrySet = new Set(registry);

  for (const featureId of FEATURE_IDS) {
    const status = capabilityMatrix[featureId][layer];
    if (status === "none") {
      expect(registrySet.has(featureId), `${featureId} has ${layer}=none but exists in registry`).toBe(false);
    } else {
      expect(registrySet.has(featureId), `${featureId} has ${layer}=${status} but is missing from registry`).toBe(true);
    }
  }

  for (const featureId of registrySet) {
    expect(FEATURE_IDS.includes(featureId), `Unknown feature id in ${layer} registry: ${featureId}`).toBe(true);
  }
}
