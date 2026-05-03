import { describe, expect, it } from "vitest";

import type { EvaluateTikzResult } from "../../packages/core/src/semantic/evaluate.js";
import type { SceneElement } from "../../packages/core/src/semantic/types.js";
import { evaluateSemantic, elementsOfKind } from "./helpers.js";

function assertOriginalSourceRefInvariants(source: string, result: EvaluateTikzResult): void {
  for (const element of result.scene.elements) {
    expect(element.sourceRef.sourceSpan.from).toBeGreaterThanOrEqual(0);
    expect(element.sourceRef.sourceSpan.to).toBeGreaterThanOrEqual(element.sourceRef.sourceSpan.from);
    expect(element.sourceRef.sourceSpan.to).toBeLessThanOrEqual(source.length);
  }

  for (const handle of result.editHandles) {
    expect(handle.sourceRef.sourceSpan.from).toBeGreaterThanOrEqual(0);
    expect(handle.sourceRef.sourceSpan.to).toBeGreaterThanOrEqual(handle.sourceRef.sourceSpan.from);
    expect(handle.sourceRef.sourceSpan.to).toBeLessThanOrEqual(source.length);
    if (handle.sourceText.length > 0) {
      expect(handle.sourceText).toBe(source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to));
    }
  }
}

function assertGeneratedIdentityRefs(result: EvaluateTikzResult): void {
  for (const element of result.scene.elements) {
    if (!isStatementExpandedElement(element)) {
      continue;
    }
    expect(element.identityRef?.sourceId).toBeTruthy();
    expect(element.identityRef?.sourceSpan.to).toBeGreaterThan(element.identityRef?.sourceSpan.from ?? -1);
  }

  for (const handle of result.editHandles) {
    if (!handle.sourceRef.sourceId.startsWith("foreach:") && !handle.sourceRef.sourceId.startsWith("unknown-statement:")) {
      continue;
    }
    expect(handle.identityRef?.sourceId).toBeTruthy();
    expect(handle.identityRef?.sourceSpan.to).toBeGreaterThan(handle.identityRef?.sourceSpan.from ?? -1);
  }
}

function assertRemappedStyleIdentityRefs(result: EvaluateTikzResult): void {
  for (const element of result.scene.elements) {
    if (!isStatementExpandedElement(element)) {
      continue;
    }
    const remappedEntries = element.styleChain.filter(
      (entry) => entry.sourceRef?.sourceSpan && entry.sourceRef.identityRef
    );
    expect(remappedEntries.length).toBeGreaterThan(0);
    for (const entry of remappedEntries) {
      expect(entry.sourceRef?.identityRef?.sourceId).toBeTruthy();
    }
  }
}

function isStatementExpandedElement(element: SceneElement): boolean {
  return element.sourceRef.sourceId.startsWith("foreach:")
    || element.sourceRef.sourceId.startsWith("unknown-statement:")
    || (element.origin?.macroStack?.length ?? 0) > 0;
}

describe("semantic source attribution invariants", () => {
  it("keeps statement foreach source refs original-facing and identity refs generated-facing", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1}
    \draw[red] (\x,0) -- ++(1,0);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    assertGeneratedIdentityRefs(result);
    assertRemappedStyleIdentityRefs(result);
    for (const path of elementsOfKind(result.scene.elements, "Path")) {
      expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to)).toBe(String.raw`\draw[red] (\x,0) -- ++(1,0);`);
      expect(path.identityRef?.sourceId.startsWith("path:")).toBe(true);
    }
  });

  it("keeps nested foreach instances tied to the original nested template", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1}
    \foreach \y in {0,1}
      \draw[blue] (\x,\y) -- ++(1,0);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    assertGeneratedIdentityRefs(result);
    assertRemappedStyleIdentityRefs(result);
    for (const path of elementsOfKind(result.scene.elements, "Path")) {
      expect(path.origin?.foreachStack).toHaveLength(2);
      expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to)).toBe(String.raw`\draw[blue] (\x,\y) -- ++(1,0);`);
    }
  });

  it("keeps path foreach source refs within the original source during the transitional mapping", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2} { -- (\x,0) };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const path = elementsOfKind(result.scene.elements, "Path")[0];
    expect(path?.origin?.foreachStack.length).toBeGreaterThan(0);
    expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to)).toContain("foreach");
  });

  it("keeps node foreach source refs original-facing", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node foreach \p in {0.25,0.75} [pos=\p] {\p};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const labels = elementsOfKind(result.scene.elements, "Text").filter((element) => element.text === "0.25" || element.text === "0.75");
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.origin?.foreachStack.length).toBeGreaterThan(0);
      expect(source.slice(label.sourceRef.sourceSpan.from, label.sourceRef.sourceSpan.to).length).toBeGreaterThan(0);
    }
  });

  it("does not regress child foreach evaluation while attribution remains original-bounded", () => {
    const source = String.raw`\begin{tikzpicture}
  \node {root}
    child foreach \x in {A,B} { node {\x} };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    assertOriginalSourceRefInvariants(source, result);
  });

  it("maps macro-expanded path statements to invocation source refs with generated identity refs", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\myline}{\draw[red] (0,0) -- (1,0);}
  \myline
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    assertGeneratedIdentityRefs(result);
    assertRemappedStyleIdentityRefs(result);
    const path = elementsOfKind(result.scene.elements, "Path")[0];
    expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to).trim()).toBe(String.raw`\myline`);
    expect(path.origin?.macroStack?.[0]?.macroName).toBe(String.raw`\myline`);
  });

  it("keeps macro-inside-foreach generated identities while source refs fall back to original loop source", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\myline}[1]{\draw[red] (#1,0) -- ++(1,0);}
  \foreach \x in {0,1} { \myline{\x} }
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    assertGeneratedIdentityRefs(result);
    assertRemappedStyleIdentityRefs(result);
    for (const path of elementsOfKind(result.scene.elements, "Path")) {
      expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to)).toContain(String.raw`\foreach`);
      expect(path.identityRef?.sourceId.startsWith("path:")).toBe(true);
    }
  });

  it("keeps foreach-inside-macro source refs on the macro invocation", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\twolines}{\foreach \x in {0,1} \draw[red] (\x,0) -- ++(1,0);}
  \twolines
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    assertGeneratedIdentityRefs(result);
    assertRemappedStyleIdentityRefs(result);
    const paths = elementsOfKind(result.scene.elements, "Path");
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to).trim()).toBe(String.raw`\twolines`);
      expect(path.identityRef?.sourceId.startsWith("path:")).toBe(true);
    }
  });
});
