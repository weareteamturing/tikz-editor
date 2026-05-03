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

  it("maps inline path foreach handles back to the original repeated coordinate", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2} { -- (\x,0) };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const path = elementsOfKind(result.scene.elements, "Path")[0];
    expect(path?.origin?.foreachStack.length).toBeGreaterThan(0);
    expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to)).toContain("foreach");
    const generatedHandles = result.editHandles.filter((handle) => handle.identityRef);
    expect(generatedHandles).toHaveLength(2);
    expect(new Set(generatedHandles.map((handle) => handle.runtimeId)).size).toBe(generatedHandles.length);
    for (const handle of generatedHandles) {
      expect(source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to)).toBe(String.raw`(\x,0)`);
      expect(handle.identityRef?.sourceId).toContain("coordinate");
    }
  });

  it("composes nested inline path foreach source maps", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2} { foreach \y in {0,1} { -- (\x,\y) } };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const generatedHandles = result.editHandles.filter((handle) => handle.identityRef);
    expect(generatedHandles).toHaveLength(4);
    for (const handle of generatedHandles) {
      expect(source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to)).toBe(String.raw`(\x,\y)`);
    }
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
      expect(label.identityRef?.sourceId).toBe("node:0:0");
      expect(source.slice(label.sourceRef.sourceSpan.from, label.sourceRef.sourceSpan.to)).toBe(String.raw`node foreach \p in {0.25,0.75} [pos=\p] {\p}`);
    }
    const nodeHandles = result.editHandles.filter((handle) => handle.identityRef);
    expect(nodeHandles).toHaveLength(2);
    for (const handle of nodeHandles) {
      expect(source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to)).toBe(String.raw`[pos=\p]`);
    }
  });

  it("maps chained node foreach clauses to the original node template", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) node foreach \x in {0,1} foreach \y in {a,b} [name=n\x\y] {\x\y};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const labels = elementsOfKind(result.scene.elements, "Text").filter((element) => /^(0|1)(a|b)$/.test(element.text));
    expect(labels).toHaveLength(4);
    for (const label of labels) {
      expect(label.identityRef?.sourceId).toBe("node:0:0");
      expect(source.slice(label.sourceRef.sourceSpan.from, label.sourceRef.sourceSpan.to)).toBe(String.raw`node foreach \x in {0,1} foreach \y in {a,b} [name=n\x\y] {\x\y}`);
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

  it("falls back to the path foreach operation span when macro-expanded path fragments are not precisely mappable", () => {
    const source = String.raw`\begin{tikzpicture}
  \def\seg{-- (1,0)}
  \draw (0,0) foreach \x in {1,2} { \seg };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const generatedHandles = result.editHandles.filter((handle) => handle.identityRef);
    expect(generatedHandles).toHaveLength(2);
    for (const handle of generatedHandles) {
      expect(source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to)).toBe(String.raw`foreach \x in {1,2} { \seg }`);
    }
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

  it("composes path foreach item maps through macro-expanded path statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\mypath}{\draw (0,0) foreach \x in {1,2} { -- (\x,0) };}
  \mypath
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    assertOriginalSourceRefInvariants(source, result);
    const generatedHandles = result.editHandles.filter((handle) => handle.identityRef);
    expect(generatedHandles.length).toBeGreaterThan(0);
    for (const handle of generatedHandles) {
      expect(source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to).trim()).toBe(String.raw`\mypath`);
    }
  });
});
