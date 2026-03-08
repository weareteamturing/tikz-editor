import { describe, expect, it } from "vitest";

import {
  resolveHandleDragAction,
  shouldCommitHandleAnchorOnPointerUp
} from "../../apps/web/src/ui/canvas-panel/handle-drag-actions.js";

describe("handle drag actions", () => {
  it("uses connectHandle during drag when an endpoint anchor is active", () => {
    const action = resolveHandleDragAction({
      handleId: "handle-1",
      newWorld: { x: 10, y: 20 },
      activeEndpointAnchor: {
        nodeName: "A",
        anchor: "east",
        world: { x: 1, y: 2 },
        tier: "basic"
      }
    });

    expect(action).toEqual({
      kind: "connectHandle",
      handleId: "handle-1",
      nodeName: "A",
      anchor: "east"
    });
  });

  it("falls back to moveHandle when no endpoint anchor is active", () => {
    const action = resolveHandleDragAction({
      handleId: "handle-1",
      newWorld: { x: 10, y: 20 },
      activeEndpointAnchor: null
    });

    expect(action).toEqual({
      kind: "moveHandle",
      handleId: "handle-1",
      newWorld: { x: 10, y: 20 }
    });
  });

  it("only retries the anchor commit on pointer up when the snapshot is current", () => {
    expect(
      shouldCommitHandleAnchorOnPointerUp({
        snapshotSource: "\\draw (0,0) -- (A.east);",
        source: "\\draw (0,0) -- (A.east);",
        activeEndpointAnchor: {
          nodeName: "A",
          anchor: "east",
          world: { x: 1, y: 2 },
          tier: "basic"
        }
      })
    ).toBe(true);

    expect(
      shouldCommitHandleAnchorOnPointerUp({
        snapshotSource: "\\draw (0,0) -- (1,1);",
        source: "\\draw (0,0) -- (A.east);",
        activeEndpointAnchor: {
          nodeName: "A",
          anchor: "east",
          world: { x: 1, y: 2 },
          tier: "basic"
        }
      })
    ).toBe(false);
  });
});
