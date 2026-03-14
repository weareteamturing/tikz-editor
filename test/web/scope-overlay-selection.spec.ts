import { describe, expect, it } from "vitest";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import {
  buildScopeOverlayIndex,
  isWorldPointWithinScopeBounds,
  resolveFocusedScopeIdForSelection,
  resolveScopeAwareMarqueeSelection,
  resolveScopeAwareContextMenuTarget,
  resolveScopeAwarePointerDownTarget,
  resolveScopeAwarePointerUpDrillTarget
} from "../../packages/app/src/ui/canvas-panel/scope-overlay.js";

describe("scope overlay selection resolver", () => {
  const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (0,1) -- (1,1);
    \begin{scope}
      \draw (0,2) -- (1,2);
    \end{scope}
  \end{scope}
\end{tikzpicture}`;

  const parsed = parseTikz(source, { recover: true });
  const overlay = buildScopeOverlayIndex(parsed.figure.body, new Map([
    ["path:0", { minX: 0, minY: 0, maxX: 1, maxY: 0 }],
    ["path:2", { minX: 0, minY: 1, maxX: 1, maxY: 1 }],
    ["path:4", { minX: 0, minY: 2, maxX: 1, maxY: 2 }]
  ]));

  it("selects the outermost enclosing scope on first pointer-down", () => {
    const resolved = resolveScopeAwarePointerDownTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      scopeOverlay: overlay
    });

    expect(resolved).toBe("scope:1");
  });

  it("respects focused scope when resolving pointer-down targets", () => {
    const resolvedIntoInnerScope = resolveScopeAwarePointerDownTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      focusedScopeId: "scope:1",
      scopeOverlay: overlay
    });
    expect(resolvedIntoInnerScope).toBe("scope:3");

    const resolvedIntoLeaf = resolveScopeAwarePointerDownTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      focusedScopeId: "scope:3",
      scopeOverlay: overlay
    });
    expect(resolvedIntoLeaf).toBe("path:4");
  });

  it("drills down one level on pointer-up from the selected scope", () => {
    const drillToInnerScope = resolveScopeAwarePointerUpDrillTarget({
      selectedScopeId: "scope:1",
      hitSourceId: "path:4",
      scopeOverlay: overlay
    });
    expect(drillToInnerScope).toBe("scope:3");

    const drillToLeaf = resolveScopeAwarePointerUpDrillTarget({
      selectedScopeId: "scope:3",
      hitSourceId: "path:4",
      scopeOverlay: overlay
    });
    expect(drillToLeaf).toBe("path:4");
  });

  it("computes focused scope transitions for scope -> scope -> leaf", () => {
    expect(resolveFocusedScopeIdForSelection("scope:1", overlay)).toBeNull();
    expect(resolveFocusedScopeIdForSelection("scope:3", overlay)).toBe("scope:1");
    expect(resolveFocusedScopeIdForSelection("path:4", overlay)).toBe("scope:3");
  });

  it("preserves selected ancestor scope for context-menu hits without drilling", () => {
    const resolved = resolveScopeAwareContextMenuTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      selectedSourceIds: new Set(["scope:1"]),
      scopeOverlay: overlay
    });
    expect(resolved).toBe("scope:1");
  });

  it("computes scope bounds as unions of descendant statement bounds", () => {
    const outer = overlay.boundsByScopeId.get("scope:1");
    const inner = overlay.boundsByScopeId.get("scope:3");
    expect(outer).toEqual({ minX: 0, minY: 1, maxX: 1, maxY: 2 });
    expect(inner).toEqual({ minX: 0, minY: 2, maxX: 1, maxY: 2 });
  });

  it("supports focused-scope outside-click reset checks via bounds", () => {
    expect(isWorldPointWithinScopeBounds("scope:1", { x: 0.5, y: 1.5 }, overlay)).toBe(true);
    expect(isWorldPointWithinScopeBounds("scope:1", { x: 2, y: 2 }, overlay)).toBe(false);
  });

  it("marquee selects unscoped elements and only the outermost fully-contained scopes", () => {
    const selected = resolveScopeAwareMarqueeSelection({
      selectionBounds: { minX: -0.1, minY: -0.1, maxX: 1.1, maxY: 2.1 },
      sourceBoundsById: new Map([
        ["path:0", { minX: 0, minY: 0, maxX: 1, maxY: 0 }],
        ["path:2", { minX: 0, minY: 1, maxX: 1, maxY: 1 }],
        ["path:4", { minX: 0, minY: 2, maxX: 1, maxY: 2 }]
      ]),
      scopeOverlay: overlay
    });

    expect(selected).toEqual(["path:0", "scope:1"]);
  });

  it("marquee can select an inner scope when its parent is not fully contained", () => {
    const selected = resolveScopeAwareMarqueeSelection({
      selectionBounds: { minX: -0.1, minY: 1.5, maxX: 1.1, maxY: 2.1 },
      sourceBoundsById: new Map([
        ["path:0", { minX: 0, minY: 0, maxX: 1, maxY: 0 }],
        ["path:2", { minX: 0, minY: 1, maxX: 1, maxY: 1 }],
        ["path:4", { minX: 0, minY: 2, maxX: 1, maxY: 2 }]
      ]),
      scopeOverlay: overlay
    });

    expect(selected).toEqual(["scope:3"]);
  });
});
