import { describe, expect, it } from "vitest";

import type { Span } from "../packages/core/src/ast/types.js";
import type { SourcePatch } from "../packages/core/src/edit/types.js";
import { createIncrementalParseSession, parseTikz } from "../packages/core/src/parser/index.js";

describe("incremental parser session", () => {
  it("patches a single changed statement during drag", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \draw (A) -- (1,0);
\end{tikzpicture}`;
    const nextSource = source.replace("(1,0)", "(1.25,0.5)");
    const seeded = parseWithContext(source);
    const full = parseWithContext(nextSource);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const statementId = seeded.figure.body[1]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected a second statement to patch");
    }

    const incremental = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      patches: [computeSinglePatch(source, nextSource)],
      changedSourceIds: [statementId],
      trigger: "drag-element"
    });

    expect(incremental.stats.strategy).toBe("incremental");
    expect(incremental.stats.patchApplication).toBe("direct");
    expect(incremental.stats.reparsedStatementCount).toBe(1);
    expect(normalizeFigureForComparison(incremental.parse.figure)).toEqual(normalizeFigureForComparison(full.figure));
    expect(incremental.parse.figures).toEqual(full.figures);
    expect(incremental.parse.diagnostics).toEqual(full.diagnostics);
  });

  it("rebases a coalesced drag patch against the cached source", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,1) -- (1,2.4);
\end{tikzpicture}`;
    const skippedSource = source.replace("(1,2.4)", "(1.07,2.4)");
    const nextSource = skippedSource.replace("(1.07,2.4)", "(1.14,2.4)");
    const seeded = parseWithContext(source);
    const full = parseWithContext(nextSource);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected a statement to patch");
    }

    const incremental = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      patches: [computeSinglePatch(skippedSource, nextSource)],
      changedSourceIds: [statementId],
      trigger: "drag-handle"
    });

    expect(incremental.stats.strategy).toBe("incremental");
    expect(incremental.stats.patchApplication).toBe("rebased");
    expect(incremental.stats.fallbackReason).toBeUndefined();
    expect(normalizeFigureForComparison(incremental.parse.figure)).toEqual(normalizeFigureForComparison(full.figure));
    expect(incremental.parse.diagnostics).toEqual(full.diagnostics);
  });

  it("keeps statement spans stable when snapped coordinates shorten", () => {
    const coordinates = ["(1,2.4)", "(1.03,2.4)", "(1.04,2.4)", "(1.05,2.4)", "(1.06,2.4)", "(1.1,2.4)"];
    const sourceForCoordinate = (coordinate: string) => String.raw`\begin{tikzpicture}
  \draw (0,1) -- ${coordinate};
\end{tikzpicture}`;
    const seeded = parseWithContext(sourceForCoordinate(coordinates[0] ?? "(1,2.4)"));
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected a statement to patch");
    }

    let previousSource = sourceForCoordinate(coordinates[0] ?? "(1,2.4)");
    for (const coordinate of coordinates.slice(1)) {
      const nextSource = sourceForCoordinate(coordinate);
      const full = parseWithContext(nextSource);
      const incremental = session.evaluate({
        source: nextSource,
        activeFigureId: seeded.activeFigureId,
        includeContextDefinitions: true,
        patches: [computeSinglePatch(previousSource, nextSource)],
        changedSourceIds: [statementId],
        trigger: "drag-handle"
      });

      expect(incremental.stats.strategy).toBe("incremental");
      expect(incremental.stats.fallbackReason).toBeUndefined();
      expect(normalizeFigureForComparison(incremental.parse.figure)).toEqual(normalizeFigureForComparison(full.figure));
      previousSource = nextSource;
    }
  });

  it("patches multiple changed statements with stable source ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \coordinate (B) at (2,0);
  \draw (A) -- (B);
\end{tikzpicture}`;
    const seeded = parseWithContext(source);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const firstStatementId = seeded.figure.body[0]?.id;
    const secondStatementId = seeded.figure.body[1]?.id;
    expect(firstStatementId).toBeTruthy();
    expect(secondStatementId).toBeTruthy();
    if (!firstStatementId || !secondStatementId) {
      throw new Error("Expected both coordinate statements to exist");
    }

    const applied = applyReplacements(source, [
      {
        span: findSpan(source, "(0,0)"),
        replacement: "(0.5,0.25)"
      },
      {
        span: findSpan(source, "(2,0)"),
        replacement: "(2.75,-0.5)"
      }
    ]);
    const full = parseWithContext(applied.source);

    const incremental = session.evaluate({
      source: applied.source,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      patches: applied.patches,
      changedSourceIds: [firstStatementId, secondStatementId],
      trigger: "drag-element"
    });

    expect(incremental.stats.strategy).toBe("incremental");
    expect(incremental.stats.reparsedStatementCount).toBe(2);
    expect(normalizeFigureForComparison(incremental.parse.figure)).toEqual(normalizeFigureForComparison(full.figure));
    expect(incremental.parse.figures).toEqual(full.figures);
  });

  it("shifts later figure inventory spans when the active figure is not first", () => {
    const source = String.raw`\documentclass{article}
\begin{document}
\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture}
  \coordinate (B) at (0.2,0);
  \draw (B) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (0,0) -- (0,1);
\end{tikzpicture}
\end{document}`;
    const seededDocument = parseTikz(source, { recover: true });
    const activeFigureId = seededDocument.figures[1]?.id ?? null;
    expect(activeFigureId).toBe("figure:1");
    if (!activeFigureId) {
      throw new Error("Expected the middle figure to be addressable");
    }
    const seeded = parseWithContext(source, activeFigureId);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId, includeContextDefinitions: true });

    const nextSource = source.replace("(0.2,0)", "(12.345,0)");
    const full = parseWithContext(nextSource, activeFigureId);
    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected the active figure statement to exist");
    }

    const incremental = session.evaluate({
      source: nextSource,
      activeFigureId,
      includeContextDefinitions: true,
      patches: [computeSinglePatch(source, nextSource)],
      changedSourceIds: [statementId],
      trigger: "drag-element"
    });

    expect(incremental.stats.strategy).toBe("incremental");
    expect(incremental.parse.figures).toEqual(full.figures);
    expect(incremental.parse.activeFigureId).toBe(activeFigureId);
  });

  it("falls back when a patch touches the tikzpicture delimiter", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const seeded = parseWithContext(source);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const beginToken = "\\begin{tikzpicture}";
    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected a statement to exist");
    }

    const result = session.evaluate({
      source,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      patches: [
        {
          oldSpan: { from: 0, to: beginToken.length },
          newSpan: { from: 0, to: beginToken.length },
          replacement: beginToken
        }
      ],
      changedSourceIds: [statementId],
      trigger: "drag-element"
    });

    expect(result.stats.strategy).toBe("full");
    expect(result.stats.fallbackReason).toBe("patch-touches-figure-delimiter");
  });

  it("falls back when the active figure is unresolved during a drag", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (0,0) -- (0,1);
\end{tikzpicture}`;
    const seeded = parseWithContext(source);
    const nextSource = source.replace("(1,0)", "(1.1,0)");
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const result = session.evaluate({
      source: nextSource,
      activeFigureId: null,
      includeContextDefinitions: true,
      patches: [computeSinglePatch(source, nextSource)],
      changedSourceIds: [seeded.figure.body[0]?.id ?? "path:0"],
      trigger: "drag-element"
    });

    expect(result.stats.strategy).toBe("full");
    expect(result.stats.fallbackReason).toBe("active-figure-unresolved");
  });

  it("falls back when changed source ids do not resolve", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const nextSource = source.replace("(1,0)", "(1.5,0)");
    const seeded = parseWithContext(source);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const result = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      patches: [computeSinglePatch(source, nextSource)],
      changedSourceIds: ["missing-source-id"],
      trigger: "drag-element"
    });

    expect(result.stats.strategy).toBe("full");
    expect(result.stats.fallbackReason).toBe("patch-source-id-mismatch");
  });

  it("falls back when a changed statement cannot be reparsed as a statement-stable edit", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const replacement = "  \\node at (0,0) {changed};";
    const nextSource = source.replace("  \\draw (0,0) -- (1,0);", replacement);
    const seeded = parseWithContext(source);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected a statement to exist");
    }

    const statementSpan = seeded.figure.body[0]?.span;
    expect(statementSpan).toBeTruthy();
    if (!statementSpan) {
      throw new Error("Expected a statement span");
    }

    const result = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      patches: [
        {
          oldSpan: { ...statementSpan },
          newSpan: {
            from: statementSpan.from,
            to: statementSpan.from + replacement.length
          },
          replacement
        }
      ],
      changedSourceIds: [statementId],
      trigger: "drag-element"
    });

    expect(result.stats.strategy).toBe("full");
    expect(["statement-structure-changed", "statement-parse-error"]).toContain(result.stats.fallbackReason);
  });
});

function parseWithContext(source: string, activeFigureId?: string | null) {
  return parseTikz(source, {
    recover: true,
    activeFigureId,
    includeContextDefinitions: true
  });
}

function computeSinglePatch(oldSource: string, newSource: string): SourcePatch {
  let prefix = 0;
  const limit = Math.min(oldSource.length, newSource.length);
  while (prefix < limit && oldSource.charCodeAt(prefix) === newSource.charCodeAt(prefix)) {
    prefix += 1;
  }

  let oldSuffix = oldSource.length;
  let newSuffix = newSource.length;
  while (
    oldSuffix > prefix &&
    newSuffix > prefix &&
    oldSource.charCodeAt(oldSuffix - 1) === newSource.charCodeAt(newSuffix - 1)
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }

  return {
    oldSpan: { from: prefix, to: oldSuffix },
    newSpan: { from: prefix, to: newSuffix },
    replacement: newSource.slice(prefix, newSuffix)
  };
}

function findSpan(source: string, text: string, fromIndex = 0): Span {
  const from = source.indexOf(text, fromIndex);
  if (from < 0) {
    throw new Error(`Could not find "${text}" in source`);
  }
  return {
    from,
    to: from + text.length
  };
}

function applyReplacements(
  source: string,
  replacements: Array<{ span: Span; replacement: string }>
): { source: string; patches: SourcePatch[] } {
  const sorted = [...replacements].sort((left, right) => left.span.from - right.span.from);
  const patches: SourcePatch[] = [];
  let cursor = 0;
  let delta = 0;
  let output = "";

  for (const replacement of sorted) {
    output += source.slice(cursor, replacement.span.from);
    output += replacement.replacement;
    const newFrom = replacement.span.from + delta;
    const newTo = newFrom + replacement.replacement.length;
    patches.push({
      oldSpan: { ...replacement.span },
      newSpan: { from: newFrom, to: newTo },
      replacement: replacement.replacement
    });
    delta += replacement.replacement.length - (replacement.span.to - replacement.span.from);
    cursor = replacement.span.to;
  }

  output += source.slice(cursor);
  return {
    source: output,
    patches
  };
}

function normalizeFigureForComparison<T>(value: T): T {
  const clone = structuredClone(value);
  const visit = (current: unknown, parentKind: string | null): void => {
    if (!current || typeof current !== "object") {
      return;
    }
    if (Array.isArray(current)) {
      for (const entry of current) {
        visit(entry, parentKind);
      }
      return;
    }
    const record = current as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind : parentKind;
    if (typeof record.id === "string" && kind !== "Path" && kind !== "Scope") {
      delete record.id;
    }
    for (const child of Object.values(record)) {
      visit(child, kind);
    }
  };
  visit(clone, null);
  return clone;
}
