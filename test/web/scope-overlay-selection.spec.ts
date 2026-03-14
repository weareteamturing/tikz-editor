import { describe, expect, it } from "vitest";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { buildScopeOverlayIndex, resolveScopeAwareSelectionTarget } from "../../packages/app/src/ui/canvas-panel/scope-overlay.js";

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

  it("selects the nearest enclosing scope on first click", () => {
    const resolved = resolveScopeAwareSelectionTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      selectedSourceIds: new Set(),
      additiveSelection: false,
      scopeOverlay: overlay
    });

    expect(resolved).toBe("scope:3");
  });

  it("drills down one level when the clicked content is inside the selected scope", () => {
    const resolvedIntoLeaf = resolveScopeAwareSelectionTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      selectedSourceIds: new Set(["scope:3"]),
      additiveSelection: false,
      scopeOverlay: overlay
    });
    expect(resolvedIntoLeaf).toBe("path:4");

    const resolvedIntoNestedScope = resolveScopeAwareSelectionTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      selectedSourceIds: new Set(["scope:1"]),
      additiveSelection: false,
      scopeOverlay: overlay
    });
    expect(resolvedIntoNestedScope).toBe("scope:3");
  });

  it("keeps a selected leaf selected when clicking it again", () => {
    const resolved = resolveScopeAwareSelectionTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      selectedSourceIds: new Set(["path:4"]),
      additiveSelection: false,
      scopeOverlay: overlay
    });

    expect(resolved).toBe("path:4");
  });

  it("bypasses scope lifting when additive/modifier selection is used", () => {
    const resolved = resolveScopeAwareSelectionTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      selectedSourceIds: new Set(["scope:1"]),
      additiveSelection: true,
      scopeOverlay: overlay
    });

    expect(resolved).toBe("path:4");
  });

  it("preserves selected scope on context-menu style hit-testing without drill-down", () => {
    const resolved = resolveScopeAwareSelectionTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      selectedSourceIds: new Set(["scope:1"]),
      additiveSelection: false,
      scopeOverlay: overlay,
      allowDrillDown: false
    });

    expect(resolved).toBe("scope:1");
  });

  it("computes scope bounds as unions of descendant statement bounds", () => {
    const outer = overlay.boundsByScopeId.get("scope:1");
    const inner = overlay.boundsByScopeId.get("scope:3");
    expect(outer).toEqual({ minX: 0, minY: 1, maxX: 1, maxY: 2 });
    expect(inner).toEqual({ minX: 0, minY: 2, maxX: 1, maxY: 2 });
  });
});
