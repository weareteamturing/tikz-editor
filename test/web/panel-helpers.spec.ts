import { describe, expect, it } from "vitest";
import { rectHitRegionsForTargetId } from "../../web/src/ui/canvas-panel/panel-helpers.js";
import type { HitRegion } from "../../web/src/ui/canvas-panel/hit-regions.js";

describe("rectHitRegionsForTargetId", () => {
  it("matches rect regions by target id rather than statement source id", () => {
    const hitRegions: HitRegion[] = [
      {
        shape: "rect",
        key: "hit:text",
        sourceId: "path:0",
        targetId: "node-adornment:node:0:2:label:0",
        x: 0,
        y: 0,
        width: 10,
        height: 4,
        cx: 5,
        cy: 2,
        rotation: 0
      },
      {
        shape: "rect",
        key: "hit:node-text",
        sourceId: "path:0",
        targetId: "path:0",
        x: 0,
        y: 0,
        width: 12,
        height: 4,
        cx: 6,
        cy: 2,
        rotation: 0
      }
    ];

    const result = rectHitRegionsForTargetId(hitRegions, "node-adornment:node:0:2:label:0");

    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe("hit:text");
  });
});
