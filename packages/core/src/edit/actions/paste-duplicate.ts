import type { EditHandle, Point } from "../../semantic/types.js";
import type { Span } from "../../ast/types.js";
import { parseTikz } from "../../parser/index.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import {
  applyTextReplacements,
  formatSnippetsForInsertion,
  groupStatementRefsByParent,
  lineIndentAtOffset,
  mapSpansToStatementIds,
  parseStatementSnapshot,
  resolveRootInsertionPoint,
  resolveStatementRefs,
  shiftSpansAfterReplacement,
  statementSnippet
} from "../statement-ops.js";
import { renameSnippetDeclaredNames } from "../name-conflicts.js";
import type { SourcePatch } from "../types.js";

export type PasteStatementsAction = {
  snippets: string[];
  anchorElementId?: string;
  delta?: Point;
};

export type DuplicateElementsAction = {
  elementIds: string[];
  delta?: Point;
};

type EditActionResultLike =
  | { kind: "success"; newSource: string; patches: SourcePatch[]; selectedSourceIds?: string[] }
  | {
      kind: "partial";
      newSource: string;
      patches: SourcePatch[];
      skippedHandles: string[];
      reason: string;
      selectedSourceIds?: string[];
    }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

type MoveElementsResultLike =
  | { kind: "success"; newSource: string }
  | { kind: "partial"; newSource: string; skippedHandles: string[]; reason: string }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

type PasteDuplicateDeps = {
  applyMoveElements: (
    source: string,
    editHandles: EditHandle[],
    elementIds: readonly string[],
    delta: Point
  ) => MoveElementsResultLike;
  normalizeElementIds: (elementIds: readonly string[]) => string[];
  uniqueStrings: (values: readonly string[]) => string[];
  defaultDuplicateOffsetPt: number;
};

type OffsetSnippetsResult = {
  snippets: string[];
  partialReason?: string;
  skippedHandles: string[];
};

export function applyPasteStatementsAction(
  source: string,
  action: PasteStatementsAction,
  deps: PasteDuplicateDeps
): EditActionResultLike {
  const snippets = action.snippets
    .map((snippet) => snippet.replace(/\r\n?/g, "\n").trimEnd())
    .filter((snippet) => snippet.trim().length > 0);
  if (snippets.length === 0) {
    return { kind: "unsupported", reason: "No snippets were provided for pasteStatements." };
  }

  const delta = normalizeDuplicateDelta(action.delta, deps.defaultDuplicateOffsetPt);
  const shifted = offsetSnippetsByDelta(snippets, delta, deps);
  const renamedSnippets = renameSnippetDeclaredNames(source, shifted.snippets);

  const snapshot = parseStatementSnapshot(source);
  const anchorId = action.anchorElementId?.trim();
  const anchorRef = anchorId ? snapshot.byId.get(anchorId) : undefined;

  const insertionPoint = anchorRef
    ? {
        offset: anchorRef.span.to,
        indent: lineIndentAtOffset(source, anchorRef.span.from)
      }
    : resolveRootInsertionPoint(source);

  const insertion = formatSnippetsForInsertion(renamedSnippets, insertionPoint.indent, {
    trailingNewline: !anchorRef,
    newline: detectPreferredNewline(source, insertionPoint.offset)
  });
  if (insertion.text.length === 0 || insertion.snippetSpans.length === 0) {
    return { kind: "unsupported", reason: "No non-empty statements were available to paste." };
  }

  const applied = applyTextReplacements(source, [
    {
      span: { from: insertionPoint.offset, to: insertionPoint.offset },
      text: insertion.text
    }
  ]);
  const appliedInsertion = applied.applied[0];
  if (!appliedInsertion) {
    return { kind: "error", message: "Failed to apply pasted source snippets." };
  }

  const insertedSpans = insertion.snippetSpans.map((span) => ({
    from: appliedInsertion.newSpan.from + span.from,
    to: appliedInsertion.newSpan.from + span.to
  }));
  const selectedSourceIds = mapSpansToStatementIds(applied.source, insertedSpans);

  if (shifted.partialReason) {
    return {
      kind: "partial",
      newSource: applied.source,
      patches: applied.patches,
      skippedHandles: shifted.skippedHandles,
      reason: shifted.partialReason,
      selectedSourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : undefined
    };
  }

  return {
    kind: "success",
    newSource: applied.source,
    patches: applied.patches,
    selectedSourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : undefined
  };
}

export function applyDuplicateElementsAction(
  source: string,
  action: DuplicateElementsAction,
  deps: PasteDuplicateDeps
): EditActionResultLike {
  const normalizedIds = deps.normalizeElementIds(action.elementIds);
  if (normalizedIds.length === 0) {
    return { kind: "unsupported", reason: "No element ids were provided for duplicateElements." };
  }

  const initialSnapshot = parseStatementSnapshot(source);
  const initialRefs = resolveStatementRefs(initialSnapshot, normalizedIds);
  if (initialRefs.length === 0) {
    return { kind: "unsupported", reason: "No duplicable statements were found for the selected element ids." };
  }

  const groups = groupStatementRefsByParent(initialRefs);
  let currentSource = source;
  const patches: SourcePatch[] = [];
  let insertedSpans: Span[] = [];
  const partialReasons: string[] = [];
  const partialSkippedHandles: string[] = [];
  const delta = normalizeDuplicateDelta(action.delta, deps.defaultDuplicateOffsetPt);

  for (const group of groups) {
    const snapshot = parseStatementSnapshot(currentSource);
    const currentRefs = resolveStatementRefs(
      snapshot,
      group.refs.map((ref) => ref.id)
    );
    if (currentRefs.length === 0) {
      continue;
    }

    const resolvedGroups = groupStatementRefsByParent(currentRefs);
    for (const resolvedGroup of resolvedGroups) {
      const orderedRefs = [...resolvedGroup.refs].sort((left, right) => left.index - right.index);
      const snippets = orderedRefs.map((ref) => statementSnippet(currentSource, ref));
      const shifted = offsetSnippetsByDelta(snippets, delta, deps);
      const renamedSnippets = renameSnippetDeclaredNames(currentSource, shifted.snippets);
      if (shifted.partialReason) {
        partialReasons.push(shifted.partialReason);
        partialSkippedHandles.push(...shifted.skippedHandles);
      }

      const anchor = orderedRefs[orderedRefs.length - 1];
      if (!anchor) {
        continue;
      }

      const insertion = formatSnippetsForInsertion(
        renamedSnippets,
        lineIndentAtOffset(currentSource, anchor.span.from)
      );
      if (insertion.text.length === 0 || insertion.snippetSpans.length === 0) {
        continue;
      }

      const applied = applyTextReplacements(currentSource, [
        {
          span: { from: anchor.span.to, to: anchor.span.to },
          text: insertion.text
        }
      ]);
      const appliedInsertion = applied.applied[0];
      if (!appliedInsertion) {
        continue;
      }

      patches.push(...applied.patches);
      currentSource = applied.source;
      insertedSpans = shiftSpansAfterReplacement(insertedSpans, appliedInsertion.oldSpan, appliedInsertion.newSpan);
      insertedSpans.push(
        ...insertion.snippetSpans.map((span) => ({
          from: appliedInsertion.newSpan.from + span.from,
          to: appliedInsertion.newSpan.from + span.to
        }))
      );
    }
  }

  if (insertedSpans.length === 0) {
    return { kind: "unsupported", reason: "Duplicate operation produced no inserted statements." };
  }

  const selectedSourceIds = mapSpansToStatementIds(currentSource, insertedSpans);
  if (partialReasons.length > 0) {
    return {
      kind: "partial",
      newSource: currentSource,
      patches,
      skippedHandles: deps.uniqueStrings(partialSkippedHandles),
      reason: deps.uniqueStrings(partialReasons).join(" "),
      selectedSourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : undefined
    };
  }

  return {
    kind: "success",
    newSource: currentSource,
    patches,
    selectedSourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : undefined
  };
}

function offsetSnippetsByDelta(
  snippets: readonly string[],
  delta: Point,
  deps: PasteDuplicateDeps
): OffsetSnippetsResult {
  const normalized = snippets
    .map((snippet) => snippet.replace(/\r\n?/g, "\n").trimEnd())
    .filter((snippet) => snippet.trim().length > 0);
  if (normalized.length === 0) {
    return { snippets: [], skippedHandles: [] };
  }
  if (Math.abs(delta.x) <= 1e-9 && Math.abs(delta.y) <= 1e-9) {
    return { snippets: normalized, skippedHandles: [] };
  }

  const wrappedSource = wrapSnippetsInFigure(normalized);
  const wrappedSnapshot = parseStatementSnapshot(wrappedSource);
  const rootRefs = wrappedSnapshot.byParentKey.get("root") ?? [];
  const rootIds = rootRefs.map((ref) => ref.id);
  if (rootIds.length === 0) {
    return { snippets: normalized, skippedHandles: [] };
  }

  const parsed = parseTikz(wrappedSource, { recover: true });
  const semantic = evaluateTikzFigure(parsed.figure, wrappedSource);
  const moved = deps.applyMoveElements(wrappedSource, semantic.editHandles, rootIds, delta);

  if (moved.kind !== "success" && moved.kind !== "partial") {
    return {
      snippets: normalized,
      skippedHandles: [],
      partialReason:
        moved.kind === "unsupported"
          ? `Could not offset all pasted/duplicated statements: ${moved.reason}`
          : `Could not offset all pasted/duplicated statements: ${moved.message}`
    };
  }

  const movedSnapshot = parseStatementSnapshot(moved.newSource);
  const movedRootRefs = movedSnapshot.byParentKey.get("root") ?? [];
  const movedSnippets = movedRootRefs.map((ref) => statementSnippet(moved.newSource, ref));
  if (movedSnippets.length !== normalized.length) {
    return {
      snippets: normalized,
      skippedHandles: moved.kind === "partial" ? moved.skippedHandles : [],
      partialReason:
        moved.kind === "partial"
          ? `Some pasted/duplicated coordinates could not be offset: ${moved.reason}`
          : "Some pasted/duplicated statements could not be offset."
    };
  }

  if (moved.kind === "partial") {
    return {
      snippets: movedSnippets,
      partialReason: `Some pasted/duplicated coordinates could not be offset: ${moved.reason}`,
      skippedHandles: moved.skippedHandles
    };
  }

  return {
    snippets: movedSnippets,
    skippedHandles: []
  };
}

function wrapSnippetsInFigure(snippets: readonly string[]): string {
  const body = snippets.map((snippet) => `  ${snippet}`).join("\n");
  return `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;
}

function normalizeDuplicateDelta(delta: Point | undefined, defaultDuplicateOffsetPt: number): Point {
  if (!delta) {
    return { x: defaultDuplicateOffsetPt, y: -defaultDuplicateOffsetPt };
  }

  return {
    x: Number.isFinite(delta.x) ? delta.x : defaultDuplicateOffsetPt,
    y: Number.isFinite(delta.y) ? delta.y : -defaultDuplicateOffsetPt
  };
}

function detectPreferredNewline(source: string, aroundOffset: number): string {
  const windowStart = Math.max(0, aroundOffset - 256);
  const windowEnd = Math.min(source.length, aroundOffset + 256);
  const window = source.slice(windowStart, windowEnd);
  if (window.includes("\r\n")) {
    return "\r\n";
  }
  return "\n";
}
