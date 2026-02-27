import { describe, expect, it } from "vitest";

import { resolveTextSelectionOverlayResolution } from "../web/src/ui/text-selection-overlay-policy.js";

describe("text selection overlay policy", () => {
  it("applies when source id, target, and offsets are all valid", () => {
    expect(
      resolveTextSelectionOverlayResolution({
        hasSourceId: true,
        hasTarget: true,
        offsetsInRange: true,
        allowTransientPreserve: true,
        snapshotMatchesSource: true
      })
    ).toBe("apply");
  });

  it("preserves the existing overlay during transient recompute mismatch", () => {
    expect(
      resolveTextSelectionOverlayResolution({
        hasSourceId: true,
        hasTarget: false,
        offsetsInRange: false,
        allowTransientPreserve: true,
        snapshotMatchesSource: false
      })
    ).toBe("preserve");
  });

  it("clears when inputs are invalid and snapshot has already caught up", () => {
    expect(
      resolveTextSelectionOverlayResolution({
        hasSourceId: true,
        hasTarget: false,
        offsetsInRange: false,
        allowTransientPreserve: true,
        snapshotMatchesSource: true
      })
    ).toBe("clear");
  });

  it("clears when transient preserve is disabled", () => {
    expect(
      resolveTextSelectionOverlayResolution({
        hasSourceId: false,
        hasTarget: false,
        offsetsInRange: false,
        allowTransientPreserve: false,
        snapshotMatchesSource: false
      })
    ).toBe("clear");
  });
});
