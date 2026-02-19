import { describe, expect, it } from "vitest";
import type { EditHandle, Point } from "../src/semantic/types.js";
import { identityMatrix } from "../src/semantic/transform.js";
import { applyEditAction } from "../src/edit/actions.js";
import { PT_PER_CM } from "../src/edit/format.js";
import { computeSourceFingerprint } from "../src/utils/source-fingerprint.js";

const cm = (v: number) => v * PT_PER_CM;

function makeHandle(
  source: string,
  overrides: Partial<EditHandle> & {
    world: Point;
    sourceSpan: { from: number; to: number };
    sourceId?: string;
  }
): EditHandle {
  const span = overrides.sourceSpan;
  return {
    id: `handle-${span.from}-${span.to}`,
    sourceId: overrides.sourceId ?? "elem-1",
    kind: "path-point",
    world: overrides.world,
    transform: identityMatrix(),
    sourceSpan: span,
    sourceText: source.slice(span.from, span.to),
    sourceFingerprint: computeSourceFingerprint(source),
    coordinateForm: overrides.coordinateForm ?? "cartesian",
    rewriteMode: overrides.rewriteMode ?? "direct",
    ...overrides
  };
}

// ── moveHandle ─────────────────────────────────────────────────────────────────

describe("applyEditAction – moveHandle", () => {
  it("moves a cartesian handle to a new world position", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const handle = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 6, to: 11 }
    });

    const result = applyEditAction(source, [handle], {
      kind: "moveHandle",
      handleId: handle.id,
      newWorld: { x: cm(5), y: cm(6) }
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toBe("\\draw (5,6) -- (3,4);");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("returns unsupported for unknown handle id", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const result = applyEditAction(source, [], {
      kind: "moveHandle",
      handleId: "nonexistent",
      newWorld: { x: cm(5), y: cm(6) }
    });
    expect(result.kind).toBe("error");
  });

  it("returns unsupported for unsupported coordinate form", () => {
    const source = "\\draw (A) -- (B);";
    const handle = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 6, to: 9 },
      coordinateForm: "named",
      rewriteMode: "unsupported"
    });

    const result = applyEditAction(source, [handle], {
      kind: "moveHandle",
      handleId: handle.id,
      newWorld: { x: cm(3), y: cm(4) }
    });
    expect(result.kind).toBe("unsupported");
  });
});

// ── moveElement ────────────────────────────────────────────────────────────────

describe("applyEditAction – moveElement", () => {
  it("moves all handles of an element by a delta", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const h1 = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 6, to: 11 },
      sourceId: "elem-1"
    });
    const h2 = makeHandle(source, {
      world: { x: cm(3), y: cm(4) },
      sourceSpan: { from: 15, to: 20 },
      id: "handle-15-20",
      sourceId: "elem-1"
    } as Parameters<typeof makeHandle>[1]);

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElement",
      elementId: "elem-1",
      delta: { x: cm(1), y: cm(1) }
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toBe("\\draw (2,3) -- (4,5);");
    }
  });

  it("returns unsupported when element has no handles", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "nonexistent",
      delta: { x: cm(1), y: cm(1) }
    });
    expect(result.kind).toBe("unsupported");
  });

  it("returns partial when some handles are unsupported", () => {
    const source = "\\draw (A) -- (1,2);";
    const unsupported = makeHandle(source, {
      world: { x: cm(0), y: cm(0) },
      sourceSpan: { from: 6, to: 9 },
      sourceId: "elem-1",
      coordinateForm: "named",
      rewriteMode: "unsupported"
    });
    // "\\draw (A) -- (1,2);" → "(1,2)" is at positions 13..17 (span end = 18)
    const supported = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 13, to: 18 },
      sourceId: "elem-1"
    });

    const result = applyEditAction(source, [unsupported, supported], {
      kind: "moveElement",
      elementId: "elem-1",
      delta: { x: cm(1), y: cm(0) }
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.skippedHandles).toHaveLength(1);
      expect(result.newSource).toBe("\\draw (A) -- (2,2);");  // x+1=2, y unchanged=2
    }
  });

  it("applies patches in correct order (handles at different offsets)", () => {
    // Both handles in same source; higher-offset patch applied first
    const source = "\\node (A) at (1,2) {}; \\node (B) at (3,4) {};";
    const h1 = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 14, to: 19 },
      sourceId: "multi"
    });
    const h2 = makeHandle(source, {
      world: { x: cm(3), y: cm(4) },
      sourceSpan: { from: 34, to: 39 },
      id: "handle-34-39",
      sourceId: "multi"
    } as Parameters<typeof makeHandle>[1]);

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElement",
      elementId: "multi",
      delta: { x: cm(10), y: cm(10) }
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("(11,12)");
      expect(result.newSource).toContain("(13,14)");
    }
  });
});

// ── unimplemented actions ──────────────────────────────────────────────────────

describe("applyEditAction – unimplemented", () => {
  it("returns unsupported for setProperty", () => {
    const result = applyEditAction("\\draw (0,0);", [], {
      kind: "setProperty",
      elementId: "elem",
      level: "command",
      key: "color",
      value: "red"
    });
    expect(result.kind).toBe("unsupported");
  });

  it("returns unsupported for addElement", () => {
    const result = applyEditAction("\\draw (0,0);", [], {
      kind: "addElement",
      template: { kind: "node" },
      at: { x: 0, y: 0 }
    });
    expect(result.kind).toBe("unsupported");
  });
});
