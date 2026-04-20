import { describe, expect, it } from "vitest";
import type { EditHandle, SceneElement, ScenePath } from "../../packages/core/src/semantic/types.js";
import { identityMatrix } from "../../packages/core/src/semantic/transform.js";
import { deriveCurveControlLines } from "../../packages/app/src/ui/canvas-panel/curve-controls";

function makePath(sourceId: string, commands: ScenePath["commands"]): SceneElement {
  return {
    kind: "Path",
    id: `path:${sourceId}`,
    runtimeId: `runtime:path:${sourceId}`,
    sourceRef: {
      sourceId,
      sourceSpan: { from: 0, to: 0 },
      sourceFingerprint: "test-fingerprint"
    },
    style: {} as ScenePath["style"],
    styleChain: [],
    commands
  };
}

function makeControlHandle(id: string, sourceId: string): EditHandle {
  return {
    handleType: "curve-control",
    id,
    runtimeId: `runtime:handle:${id}`,
    sourceRef: {
      sourceId,
      sourceSpan: { from: 0, to: 5 },
      sourceFingerprint: "fingerprint"
    },
    kind: "path-control",
    world: { x: 0, y: 0 },
    transform: identityMatrix(),
    sourceText: "(0,0)",
    coordinateForm: "cartesian",
    rewriteMode: "direct"
  } as EditHandle;
}

function makeBendHandle(id: string, sourceId: string): EditHandle {
  return {
    ...makeControlHandle(id, sourceId),
    kind: "path-bend",
    world: { x: 1.5, y: 1 },
    curveEdit: {
      kind: "to-bend",
      operationItemId: "to:0",
      startWorld: { x: 0, y: 0 },
      endWorld: { x: 3, y: 0 },
      baseHeading: 0
    }
  } as EditHandle;
}

describe("deriveCurveControlLines", () => {
  it("derives two helper lines for one cubic Bezier command", () => {
    const elements = [
      makePath("path:0", [
        { kind: "M", to: { x: 0, y: 0 } },
        { kind: "C", c1: { x: 1, y: 1 }, c2: { x: 2, y: 1 }, to: { x: 3, y: 0 } }
      ])
    ];
    const lines = deriveCurveControlLines(elements, new Set(["path:0"]), [makeControlHandle("h0", "path:0")]);

    expect(lines).toHaveLength(2);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: "path:0", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }),
        expect.objectContaining({ sourceId: "path:0", from: { x: 3, y: 0 }, to: { x: 2, y: 1 } })
      ])
    );
  });

  it("supports multiple cubic commands across subpaths", () => {
    const elements = [
      makePath("path:0", [
        { kind: "M", to: { x: 0, y: 0 } },
        { kind: "C", c1: { x: 1, y: 1 }, c2: { x: 2, y: 1 }, to: { x: 3, y: 0 } },
        { kind: "C", c1: { x: 4, y: 1 }, c2: { x: 5, y: 1 }, to: { x: 6, y: 0 } },
        { kind: "M", to: { x: 10, y: 0 } },
        { kind: "C", c1: { x: 11, y: 1 }, c2: { x: 12, y: 1 }, to: { x: 13, y: 0 } }
      ])
    ];
    const lines = deriveCurveControlLines(elements, new Set(["path:0"]), [makeControlHandle("h0", "path:0")]);

    expect(lines).toHaveLength(6);
  });

  it("filters to selected sources that actually have path-control handles", () => {
    const elements = [
      makePath("path:0", [
        { kind: "M", to: { x: 0, y: 0 } },
        { kind: "C", c1: { x: 1, y: 1 }, c2: { x: 2, y: 1 }, to: { x: 3, y: 0 } }
      ]),
      makePath("path:1", [
        { kind: "M", to: { x: 0, y: -2 } },
        { kind: "C", c1: { x: 1, y: -1 }, c2: { x: 2, y: -1 }, to: { x: 3, y: -2 } }
      ])
    ];
    const handles: EditHandle[] = [
      makeControlHandle("h0", "path:0"),
      {
        ...makeControlHandle("h1", "path:1"),
        handleType: "coordinate",
        coordinateSpace: "frame-local",
        kind: "path-point"
      } as EditHandle
    ];

    const lines = deriveCurveControlLines(elements, new Set(["path:0", "path:1"]), handles);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.sourceId === "path:0")).toBe(true);
  });

  it("derives helper lines from endpoints to bend handles", () => {
    const elements = [
      makePath("path:0", [
        { kind: "M", to: { x: 0, y: 0 } },
        { kind: "C", c1: { x: 1, y: 1 }, c2: { x: 2, y: 1 }, to: { x: 3, y: 0 } }
      ])
    ];
    const lines = deriveCurveControlLines(elements, new Set(["path:0"]), [makeBendHandle("hb", "path:0")]);
    expect(lines).toHaveLength(2);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: "path:0", from: { x: 0, y: 0 }, to: { x: 1.5, y: 1 } }),
        expect.objectContaining({ sourceId: "path:0", from: { x: 3, y: 0 }, to: { x: 1.5, y: 1 } })
      ])
    );
  });
});
