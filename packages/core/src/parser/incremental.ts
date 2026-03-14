import type { Tree } from "@lezer/common";

import { FeatureFlags } from "../ast/features.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { TikzFigure, TikzFigureInventoryItem, Span, Statement } from "../ast/types.js";
import type { ParseTikzOptions, ParseTikzResult } from "./index.js";
import type { SourcePatch } from "../edit/types.js";
import {
  getCachedContextDefinitions,
  resolveActiveFigureSpan
} from "./shared.js";
import { parseTikz } from "./index.js";
import { collectContextDefinitions } from "../transform/cst-to-ast.js";

export type IncrementalParseTrigger = "drag-element" | "drag-handle" | "other";

export type IncrementalParseFallbackReason =
  | "non-drag-trigger"
  | "missing-patches"
  | "no-previous-cache"
  | "source-unchanged-active-figure-mismatch"
  | "active-figure-unresolved"
  | "active-figure-mismatch"
  | "global-diagnostics"
  | "patch-outside-active-figure"
  | "patch-touches-figure-delimiter"
  | "patch-source-id-mismatch"
  | "patch-overlaps-unknown-statement"
  | "statement-structure-changed"
  | "statement-parse-error"
  | "statement-global-diagnostics"
  | "runtime-error";

export type IncrementalParseStats = {
  strategy: "full" | "incremental" | "reused";
  fallbackReason?: IncrementalParseFallbackReason;
  reparsedStatementCount: number;
  reusedStatementCount: number;
};

export type IncrementalParseEvaluateInput = {
  source: string;
  activeFigureId?: string | null;
  includeContextDefinitions?: boolean;
  patches?: readonly SourcePatch[] | null;
  changedSourceIds?: readonly string[];
  trigger?: IncrementalParseTrigger;
};

export type IncrementalParseEvaluateResult = {
  parse: ParseTikzResult;
  stats: IncrementalParseStats;
};

export type IncrementalParseSession = {
  evaluate: (input: IncrementalParseEvaluateInput) => IncrementalParseEvaluateResult;
  prime: (parse: ParseTikzResult, options?: Pick<ParseTikzOptions, "activeFigureId" | "includeContextDefinitions">) => void;
  reset: () => void;
};

type StatementRef = {
  sourceId: string;
  span: Span;
  parentPath: number[];
  index: number;
};

type ParseDiagnosticPartition = {
  localBySourceId: Map<string, Diagnostic[]>;
  global: Diagnostic[];
};

type CachedIncrementalParseState = {
  source: string;
  activeFigureId: string | null;
  includeContextDefinitions: boolean;
  figures: TikzFigureInventoryItem[];
  activeFigureSpan: Span | null;
  contextDefinitions: Statement[];
  figure: TikzFigure;
  statementRefsBySourceId: Map<string, StatementRef>;
  diagnosticPartition: ParseDiagnosticPartition;
  tree: Tree;
  treeFresh: boolean;
};

const SNIPPET_PREFIX = "\\begin{tikzpicture}\n";
const SNIPPET_SUFFIX = "\n\\end{tikzpicture}";
const BEGIN_TIKZ_PATTERN = /\\begin\{tikzpicture\*?\}/u;
const END_TIKZ_PATTERN = /\\end\{tikzpicture\*?\}/u;

export function createIncrementalParseSession(): IncrementalParseSession {
  let cached: CachedIncrementalParseState | null = null;

  const prime = (
    parse: ParseTikzResult,
    options: Pick<ParseTikzOptions, "activeFigureId" | "includeContextDefinitions"> = {}
  ): void => {
    cached = buildCache(parse, {
      activeFigureId: options.activeFigureId ?? parse.activeFigureId,
      includeContextDefinitions: options.includeContextDefinitions ?? false,
      treeFresh: true
    });
  };

  const evaluate = (input: IncrementalParseEvaluateInput): IncrementalParseEvaluateResult => {
    const activeFigureId = input.activeFigureId;
    const includeContextDefinitions = input.includeContextDefinitions ?? false;
    const trigger = input.trigger ?? "other";
    const patches = normalizePatches(input.patches ?? []);
    const changedSourceIds = normalizeSourceIds(input.changedSourceIds ?? []);

    if (
      cached &&
      cached.source === input.source &&
      cached.activeFigureId === (activeFigureId ?? cached.activeFigureId) &&
      cached.includeContextDefinitions === includeContextDefinitions &&
      patches.length === 0
    ) {
      return {
        parse: createParseResultFromCache(cached, input.source),
        stats: {
          strategy: "reused",
          reparsedStatementCount: 0,
          reusedStatementCount: cached.statementRefsBySourceId.size
        }
      };
    }

    const fallback = decideFallbackReason({
      cached,
      inputSource: input.source,
      activeFigureId,
      includeContextDefinitions,
      patches,
      changedSourceIds,
      trigger
    });
    if (fallback) {
      const parse = parseTikz(input.source, {
        recover: true,
        activeFigureId,
        includeContextDefinitions
      });
      cached = buildCache(parse, {
        activeFigureId: activeFigureId ?? parse.activeFigureId,
        includeContextDefinitions,
        treeFresh: true
      });
      return {
        parse,
        stats: {
          strategy: "full",
          fallbackReason: fallback,
          reparsedStatementCount: countStatements(parse.figure.body),
          reusedStatementCount: 0
        }
      };
    }

    if (!cached) {
      const parse = parseTikz(input.source, {
        recover: true,
        activeFigureId,
        includeContextDefinitions
      });
      cached = buildCache(parse, {
        activeFigureId: activeFigureId ?? parse.activeFigureId,
        includeContextDefinitions,
        treeFresh: true
      });
      return {
        parse,
        stats: {
          strategy: "full",
          fallbackReason: "no-previous-cache",
          reparsedStatementCount: countStatements(parse.figure.body),
          reusedStatementCount: 0
        }
      };
    }

    try {
      const changedRefs = new Map<string, StatementRef>();
      for (const sourceId of changedSourceIds) {
        const ref = cached.statementRefsBySourceId.get(sourceId);
        if (!ref) {
          return fallbackToFull(input.source, activeFigureId, includeContextDefinitions, "patch-source-id-mismatch");
        }
        changedRefs.set(sourceId, ref);
      }

      for (const patch of patches) {
        const owner = findContainingStatementRef(cached.statementRefsBySourceId, patch.oldSpan);
        if (!owner) {
          return fallbackToFull(input.source, activeFigureId, includeContextDefinitions, "patch-overlaps-unknown-statement");
        }
        if (!changedRefs.has(owner.sourceId)) {
          return fallbackToFull(input.source, activeFigureId, includeContextDefinitions, "patch-source-id-mismatch");
        }
      }

      const nextFigures = shiftFigureInventory(cached.figures, patches);
      const nextActiveFigureSpan = resolveActiveFigureSpan(
        nextFigures.map((figure) => figure.span),
        activeFigureId ?? cached.activeFigureId
      );
      if (!nextActiveFigureSpan) {
        return fallbackToFull(input.source, activeFigureId, includeContextDefinitions, "active-figure-unresolved");
      }

      const nextFigure = shiftSpansDeep(structuredClone(cached.figure), patches);
      const changedSourceIdSet = new Set(changedSourceIds);
      const statementReplacementDiagnostics = new Map<string, Diagnostic[]>();

      for (const sourceId of changedSourceIds) {
        const previousRef = cached.statementRefsBySourceId.get(sourceId);
        if (!previousRef) {
          return fallbackToFull(input.source, activeFigureId, includeContextDefinitions, "patch-source-id-mismatch");
        }
        const nextSpan = shiftSpanThroughPatches(previousRef.span, patches);
        const snippet = input.source.slice(nextSpan.from, nextSpan.to);
        const parsedSnippet = parseStatementSnippet(snippet);
        if (parsedSnippet.parse.figure.body.length !== 1) {
          return fallbackToFull(input.source, activeFigureId, includeContextDefinitions, "statement-structure-changed");
        }
        if (parsedSnippet.hasParseError) {
          return fallbackToFull(input.source, activeFigureId, includeContextDefinitions, "statement-parse-error");
        }

        const replacement = parsedSnippet.parse.figure.body[0];
        if (!replacement || replacement.kind !== getStatementAtPath(nextFigure, previousRef.parentPath, previousRef.index)?.kind) {
          return fallbackToFull(input.source, activeFigureId, includeContextDefinitions, "statement-structure-changed");
        }

        const rebasedStatement = shiftSpansDeep(structuredClone(replacement), nextSpan.from - SNIPPET_PREFIX.length);
        rebasedStatement.id = sourceId;
        setStatementAtPath(nextFigure, previousRef.parentPath, previousRef.index, rebasedStatement);

        const partition = partitionDiagnostics(parsedSnippet.parse.diagnostics, parsedSnippet.parse.figure.body);
        if (partition.global.length > 0) {
          return fallbackToFull(input.source, activeFigureId, includeContextDefinitions, "statement-global-diagnostics");
        }
        const localDiagnostics = partition.localBySourceId.get(replacement.id) ?? [];
        statementReplacementDiagnostics.set(
          sourceId,
          localDiagnostics.map((diagnostic) => shiftDiagnostic(diagnostic, nextSpan.from - SNIPPET_PREFIX.length))
        );
      }

      nextFigure.span = nextActiveFigureSpan;
      const nextIndex = buildStatementIndex(nextFigure.body);
      const nextDiagnosticPartition = shiftDiagnosticPartition(
        cached.diagnosticPartition,
        patches,
        statementReplacementDiagnostics,
        changedSourceIdSet
      );

      const nextCache: CachedIncrementalParseState = {
        source: input.source,
        activeFigureId: activeFigureId ?? cached.activeFigureId,
        includeContextDefinitions,
        figures: nextFigures,
        activeFigureSpan: nextActiveFigureSpan,
        contextDefinitions: includeContextDefinitions
          ? getCachedContextDefinitions(input.source.slice(0, nextActiveFigureSpan.from), collectContextDefinitions)
          : [],
        figure: nextFigure,
        statementRefsBySourceId: nextIndex,
        diagnosticPartition: nextDiagnosticPartition,
        tree: cached.tree,
        treeFresh: false
      };
      cached = nextCache;
      return {
        parse: createParseResultFromCache(nextCache, input.source),
        stats: {
          strategy: "incremental",
          reparsedStatementCount: changedSourceIds.length,
          reusedStatementCount: Math.max(0, nextIndex.size - changedSourceIds.length)
        }
      };
    } catch (_error) {
      return fallbackToFull(input.source, activeFigureId, includeContextDefinitions, "runtime-error");
    }
  };

  function fallbackToFull(
    source: string,
    activeFigureId: string | null | undefined,
    includeContextDefinitions: boolean,
    reason: IncrementalParseFallbackReason
  ): IncrementalParseEvaluateResult {
    const parse = parseTikz(source, {
      recover: true,
      activeFigureId,
      includeContextDefinitions
    });
    cached = buildCache(parse, {
      activeFigureId: activeFigureId ?? parse.activeFigureId,
      includeContextDefinitions,
      treeFresh: true
    });
    return {
      parse,
      stats: {
        strategy: "full",
        fallbackReason: reason,
        reparsedStatementCount: countStatements(parse.figure.body),
        reusedStatementCount: 0
      }
    };
  }

  return {
    evaluate,
    prime,
    reset: () => {
      cached = null;
    }
  };
}

function decideFallbackReason(input: {
  cached: CachedIncrementalParseState | null;
  inputSource: string;
  activeFigureId: string | null | undefined;
  includeContextDefinitions: boolean;
  patches: SourcePatch[];
  changedSourceIds: string[];
  trigger: IncrementalParseTrigger;
}): IncrementalParseFallbackReason | null {
  if (input.trigger !== "drag-element" && input.trigger !== "drag-handle") {
    return "non-drag-trigger";
  }
  if (!input.cached) {
    return "no-previous-cache";
  }
  if (input.activeFigureId === null) {
    return input.cached.figures.length > 1
      ? "active-figure-unresolved"
      : "active-figure-mismatch";
  }
  if ((input.activeFigureId ?? input.cached.activeFigureId) !== input.cached.activeFigureId) {
    return input.inputSource === input.cached.source
      ? "source-unchanged-active-figure-mismatch"
      : "active-figure-mismatch";
  }
  if (input.includeContextDefinitions !== input.cached.includeContextDefinitions) {
    return "active-figure-mismatch";
  }
  if (input.patches.length === 0) {
    return "missing-patches";
  }
  if (input.changedSourceIds.length === 0) {
    return "patch-source-id-mismatch";
  }
  if (input.cached.diagnosticPartition.global.length > 0) {
    return "global-diagnostics";
  }
  const activeFigureSpan = input.cached.activeFigureSpan;
  if (!activeFigureSpan) {
    return "active-figure-unresolved";
  }
  const delimiterSpans = resolveFigureDelimiterSpans(input.cached.source, activeFigureSpan);
  for (const patch of input.patches) {
    if (
      patch.oldSpan.from < activeFigureSpan.from ||
      patch.oldSpan.to > activeFigureSpan.to
    ) {
      return "patch-outside-active-figure";
    }
    if (
      spansOverlap(patch.oldSpan, delimiterSpans.begin) ||
      spansOverlap(patch.oldSpan, delimiterSpans.end)
    ) {
      return "patch-touches-figure-delimiter";
    }
  }
  return null;
}

function parseStatementSnippet(snippet: string): {
  parse: ParseTikzResult;
  hasParseError: boolean;
} {
  const source = `${SNIPPET_PREFIX}${snippet}\n${SNIPPET_SUFFIX.slice(1)}`;
  const parse = parseTikz(source, { recover: true });
  return {
    parse,
    hasParseError: parse.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  };
}

function createParseResultFromCache(cache: CachedIncrementalParseState, source: string): ParseTikzResult {
  return {
    source,
    tree: cache.tree,
    figure: cache.figure,
    figures: cache.figures,
    activeFigureId: cache.activeFigureId,
    diagnostics: collectDiagnostics(cache.diagnosticPartition),
    features: FeatureFlags
  };
}

function buildCache(
  parse: ParseTikzResult,
  options: {
    activeFigureId: string | null | undefined;
    includeContextDefinitions: boolean;
    treeFresh: boolean;
  }
): CachedIncrementalParseState {
  const activeFigureSpan = resolveActiveFigureSpan(
    parse.figures.map((figure) => figure.span),
    options.activeFigureId ?? parse.activeFigureId
  );
  const partition = partitionDiagnostics(parse.diagnostics, parse.figure.body);
  return {
    source: parse.source,
    activeFigureId: options.activeFigureId ?? parse.activeFigureId,
    includeContextDefinitions: options.includeContextDefinitions,
    figures: structuredClone(parse.figures),
    activeFigureSpan,
    contextDefinitions:
      options.includeContextDefinitions && activeFigureSpan
        ? getCachedContextDefinitions(parse.source.slice(0, activeFigureSpan.from), collectContextDefinitions)
        : [],
    figure: structuredClone(parse.figure),
    statementRefsBySourceId: buildStatementIndex(parse.figure.body),
    diagnosticPartition: partition,
    tree: parse.tree,
    treeFresh: options.treeFresh
  };
}

function buildStatementIndex(statements: readonly Statement[], parentPath: number[] = []): Map<string, StatementRef> {
  const refs = new Map<string, StatementRef>();
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (!statement) {
      continue;
    }
    refs.set(statement.id, {
      sourceId: statement.id,
      span: statement.span,
      parentPath,
      index
    });
    if (statement.kind === "Scope") {
      const nested = buildStatementIndex(statement.body, [...parentPath, index]);
      for (const [sourceId, ref] of nested) {
        refs.set(sourceId, ref);
      }
    }
  }
  return refs;
}

function partitionDiagnostics(
  diagnostics: readonly Diagnostic[],
  statements: readonly Statement[]
): ParseDiagnosticPartition {
  const refs = [...buildStatementIndex(statements).values()];
  const localBySourceId = new Map<string, Diagnostic[]>();
  const global: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    let bestRef: StatementRef | null = null;
    for (const ref of refs) {
      if (ref.span.from <= diagnostic.span.from && ref.span.to >= diagnostic.span.to) {
        if (!bestRef || width(ref.span) < width(bestRef.span)) {
          bestRef = ref;
        }
      }
    }
    if (!bestRef) {
      global.push(structuredClone(diagnostic));
      continue;
    }
    const existing = localBySourceId.get(bestRef.sourceId);
    if (existing) {
      existing.push(structuredClone(diagnostic));
    } else {
      localBySourceId.set(bestRef.sourceId, [structuredClone(diagnostic)]);
    }
  }
  return {
    localBySourceId,
    global
  };
}

function shiftFigureInventory(
  figures: readonly TikzFigureInventoryItem[],
  patches: readonly SourcePatch[]
): TikzFigureInventoryItem[] {
  return figures.map((figure) => shiftSpansDeep(structuredClone(figure), patches));
}

function shiftDiagnosticPartition(
  partition: ParseDiagnosticPartition,
  patches: readonly SourcePatch[],
  replacements: ReadonlyMap<string, Diagnostic[]>,
  changedSourceIds: ReadonlySet<string>
): ParseDiagnosticPartition {
  const localBySourceId = new Map<string, Diagnostic[]>();
  for (const [sourceId, diagnostics] of partition.localBySourceId) {
    if (changedSourceIds.has(sourceId)) {
      localBySourceId.set(sourceId, structuredClone(replacements.get(sourceId) ?? []));
      continue;
    }
    localBySourceId.set(
      sourceId,
      diagnostics.map((diagnostic) => shiftDiagnosticThroughPatches(diagnostic, patches))
    );
  }
  return {
    localBySourceId,
    global: partition.global.map((diagnostic) => shiftDiagnosticThroughPatches(diagnostic, patches))
  };
}

function collectDiagnostics(partition: ParseDiagnosticPartition): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const localDiagnostics of partition.localBySourceId.values()) {
    diagnostics.push(...localDiagnostics.map((diagnostic) => structuredClone(diagnostic)));
  }
  diagnostics.push(...partition.global.map((diagnostic) => structuredClone(diagnostic)));
  diagnostics.sort((left, right) => {
    if (left.span.from !== right.span.from) {
      return left.span.from - right.span.from;
    }
    return left.span.to - right.span.to;
  });
  return diagnostics;
}

function shiftSpansDeep<T>(value: T, patchesOrDelta: readonly SourcePatch[] | number): T {
  const clone = structuredClone(value);
  const patches = typeof patchesOrDelta === "number" ? null : patchesOrDelta;
  const delta = typeof patchesOrDelta === "number" ? patchesOrDelta : 0;
  const visited = new WeakSet<object>();
  const visit = (current: unknown): void => {
    if (!current || typeof current !== "object") {
      return;
    }
    if (visited.has(current)) {
      return;
    }
    visited.add(current);
    if (Array.isArray(current)) {
      for (const entry of current) {
        visit(entry);
      }
      return;
    }
    if (
      "from" in current &&
      "to" in current &&
      typeof (current as { from?: unknown }).from === "number" &&
      typeof (current as { to?: unknown }).to === "number"
    ) {
      const span = current as { from: number; to: number };
      const next = patches ? shiftSpanThroughPatches(span, patches) : shiftSpan(span, delta);
      span.from = next.from;
      span.to = next.to;
    }
    for (const child of Object.values(current)) {
      visit(child);
    }
  };
  visit(clone);
  return clone;
}

function shiftDiagnosticThroughPatches(diagnostic: Diagnostic, patches: readonly SourcePatch[]): Diagnostic {
  return {
    ...diagnostic,
    span: shiftSpanThroughPatches(diagnostic.span, patches)
  };
}

function shiftDiagnostic(diagnostic: Diagnostic, delta: number): Diagnostic {
  return {
    ...diagnostic,
    span: shiftSpan(diagnostic.span, delta)
  };
}

function shiftSpan(span: Span, delta: number): Span {
  return {
    from: span.from + delta,
    to: span.to + delta
  };
}

function shiftSpanThroughPatches(span: Span, patches: readonly SourcePatch[]): Span {
  let next = { ...span };
  for (const patch of patches) {
    next = shiftSpanThroughSinglePatch(next, patch);
  }
  return next;
}

function shiftSpanThroughSinglePatch(span: Span, patch: SourcePatch): Span {
  const oldSpan = patch.oldSpan;
  const newSpan = patch.newSpan;
  const delta = width(newSpan) - width(oldSpan);
  if (span.to <= oldSpan.from) {
    return span;
  }
  if (span.from >= oldSpan.to) {
    return {
      from: span.from + delta,
      to: span.to + delta
    };
  }
  if (span.from >= oldSpan.from && span.to <= oldSpan.to) {
    if (span.from === oldSpan.from && span.to === oldSpan.to) {
      return { ...newSpan };
    }
    const relativeFrom = span.from - oldSpan.from;
    const relativeTo = span.to - oldSpan.from;
    return {
      from: newSpan.from + Math.min(relativeFrom, width(newSpan)),
      to: newSpan.from + Math.min(relativeTo, width(newSpan))
    };
  }
  return {
    from: span.from,
    to: span.to + delta
  };
}

function width(span: Span): number {
  return span.to - span.from;
}

function spansOverlap(left: Span, right: Span): boolean {
  return left.from < right.to && right.from < left.to;
}

function resolveFigureDelimiterSpans(source: string, figureSpan: Span): {
  begin: Span;
  end: Span;
} {
  const figureSource = source.slice(figureSpan.from, figureSpan.to);
  const beginMatch = BEGIN_TIKZ_PATTERN.exec(figureSource);
  const endMatch = END_TIKZ_PATTERN.exec(figureSource);
  const beginLength = beginMatch?.[0]?.length ?? 0;
  const endLength = endMatch?.[0]?.length ?? 0;
  return {
    begin: {
      from: figureSpan.from,
      to: figureSpan.from + beginLength
    },
    end: {
      from: Math.max(figureSpan.from, figureSpan.to - endLength),
      to: figureSpan.to
    }
  };
}

function getStatementAtPath(figure: TikzFigure, parentPath: readonly number[], index: number): Statement | null {
  const body = getBodyAtPath(figure, parentPath);
  return body[index] ?? null;
}

function setStatementAtPath(figure: TikzFigure, parentPath: readonly number[], index: number, statement: Statement): void {
  const body = getBodyAtPath(figure, parentPath);
  body[index] = statement;
}

function getBodyAtPath(figure: TikzFigure, parentPath: readonly number[]): Statement[] {
  let body = figure.body;
  for (const scopeIndex of parentPath) {
    const statement = body[scopeIndex];
    if (!statement || statement.kind !== "Scope") {
      throw new Error(`Expected scope at path ${parentPath.join("/")}`);
    }
    body = statement.body;
  }
  return body;
}

function findContainingStatementRef(
  refsBySourceId: ReadonlyMap<string, StatementRef>,
  span: Span
): StatementRef | null {
  let best: StatementRef | null = null;
  for (const ref of refsBySourceId.values()) {
    if (ref.span.from <= span.from && ref.span.to >= span.to) {
      if (!best || width(ref.span) < width(best.span)) {
        best = ref;
      }
    }
  }
  return best;
}

function normalizeSourceIds(sourceIds: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const sourceId of sourceIds) {
    const normalized = sourceId.trim();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
  }
  return [...unique];
}

function normalizePatches(patches: readonly SourcePatch[]): SourcePatch[] {
  return [...patches]
    .filter((patch) => patch.oldSpan.from <= patch.oldSpan.to && patch.newSpan.from <= patch.newSpan.to)
    .sort((left, right) => left.oldSpan.from - right.oldSpan.from);
}

function countStatements(statements: readonly Statement[]): number {
  let count = 0;
  for (const statement of statements) {
    count += 1;
    if (statement.kind === "Scope") {
      count += countStatements(statement.body);
    }
  }
  return count;
}
