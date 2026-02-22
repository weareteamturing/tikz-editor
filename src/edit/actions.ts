import type { EditHandle, Point } from "../semantic/types.js";
import type { PathItem, Statement, Span } from "../ast/types.js";
import type { SourcePatch } from "./types.js";
import { applyEditIntent } from "./apply.js";
import { rewriteCoordinate } from "./rewrite.js";
import { replaceSpan } from "./patch.js";
import { PT_PER_CM } from "./format.js";
import {
  generateElementSource,
  insertElementIntoSource,
  type ElementTemplate
} from "./element-templates.js";
import type { OptionEntry, OptionListAst } from "../options/types.js";
import { resolvePropertyTarget } from "./property-target.js";
import { parseTikz } from "../parser/index.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import { planAlignDeltas, planDistributeDeltas, type AlignMode, type DistributeAxis } from "./arrange.js";
import { collectSourceWorldBounds } from "./snapping/index.js";
import { renameSnippetDeclaredNames } from "./name-conflicts.js";
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
  statementSnippet,
  type StatementRef
} from "./statement-ops.js";

export type ResizeRole =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top"
  | "bottom"
  | "left"
  | "right";

export type StyleLevel = "command" | "scope" | "named-style" | "preamble";
export type { ElementTemplate } from "./element-templates.js";
export type ReorderDirection = "sendToBack" | "sendBackward" | "bringForward" | "bringToFront";

export type EditAction =
  | { kind: "moveElement"; elementId: string; delta: Point }
  | { kind: "moveElements"; elementIds: string[]; delta: Point }
  | { kind: "alignElements"; elementIds: string[]; mode: AlignMode }
  | { kind: "distributeElements"; elementIds: string[]; axis: DistributeAxis }
  | { kind: "moveHandle"; handleId: string; newWorld: Point }
  | { kind: "setProperty"; elementId: string; level: StyleLevel; key: string; value: string }
  | { kind: "addElement"; template: ElementTemplate; at: Point }
  | { kind: "deleteElement"; elementId: string }
  | { kind: "deleteElements"; elementIds: string[] }
  | { kind: "pasteStatements"; snippets: string[]; anchorElementId?: string; delta?: Point }
  | { kind: "duplicateElements"; elementIds: string[]; delta?: Point }
  | { kind: "reorderElements"; elementIds: string[]; direction: ReorderDirection }
  | { kind: "resizeElement"; elementId: string; role: ResizeRole; newWorld: Point };

export type EditActionResult =
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

const DEFAULT_DUPLICATE_OFFSET_PT = 0.25 * PT_PER_CM;
const ARRANGE_EPSILON = 1e-6;

export function applyEditAction(
  source: string,
  editHandles: EditHandle[],
  action: EditAction
): EditActionResult {
  switch (action.kind) {
    case "moveHandle":
      return applyMoveHandle(source, editHandles, action.handleId, action.newWorld);
    case "moveElement":
      return applyMoveElements(source, editHandles, [action.elementId], action.delta);
    case "moveElements":
      return applyMoveElements(source, editHandles, action.elementIds, action.delta);
    case "alignElements":
      return applyAlignElements(source, action);
    case "distributeElements":
      return applyDistributeElements(source, action);
    case "setProperty":
      return applySetProperty(source, action);
    case "addElement":
      return applyAddElement(source, action.template, action.at);
    case "deleteElement":
      return applyDeleteElements(source, [action.elementId]);
    case "deleteElements":
      return applyDeleteElements(source, action.elementIds);
    case "pasteStatements":
      return applyPasteStatements(source, action);
    case "duplicateElements":
      return applyDuplicateElements(source, action);
    case "reorderElements":
      return applyReorderElements(source, action.elementIds, action.direction);
    case "resizeElement":
      return { kind: "unsupported", reason: `${action.kind} is not yet implemented` };
  }
}

function applyMoveHandle(
  source: string,
  editHandles: EditHandle[],
  handleId: string,
  newWorld: Point
): EditActionResult {
  const result = applyEditIntent(source, editHandles, { kind: "move", handleId, newWorld });
  if (result.kind === "success") {
    return { kind: "success", newSource: result.newSource, patches: result.patches };
  }
  if (result.kind === "unsupported") {
    return { kind: "unsupported", reason: result.reason };
  }
  return { kind: "error", message: result.message };
}

function applyMoveElements(
  source: string,
  editHandles: EditHandle[],
  elementIds: readonly string[],
  delta: Point
): EditActionResult {
  const normalizedIds = normalizeElementIds(elementIds);
  if (normalizedIds.length === 0) {
    return { kind: "unsupported", reason: "No element ids were provided for moveElements" };
  }

  const sourceIdSet = new Set(normalizedIds);
  const elementHandles = editHandles.filter((h) => sourceIdSet.has(h.sourceId));

  if (elementHandles.length === 0) {
    return { kind: "unsupported", reason: "No handles found for the selected element(s)" };
  }

  const rewritable = elementHandles.filter((h) => h.rewriteMode !== "unsupported");
  const skippedHandles = elementHandles
    .filter((h) => h.rewriteMode === "unsupported")
    .map((h) => h.id);

  if (rewritable.length === 0) {
    return {
      kind: "unsupported",
      reason: "All handles for the selected element(s) use unsupported coordinate forms"
    };
  }

  // Compute (span, replacement) pairs for all rewritable handles using the original source.
  // We use rewriteCoordinate directly (bypassing fingerprint check) since all handles are fresh
  // and we verify content matches before computing the replacement.
  type PendingReplacement = { span: { from: number; to: number }; text: string; handleId: string };
  const pending: PendingReplacement[] = [];

  for (const handle of rewritable) {
    const actualText = source.slice(handle.sourceSpan.from, handle.sourceSpan.to);
    if (actualText !== handle.sourceText) {
      skippedHandles.push(handle.id);
      continue;
    }

    const newWorld: Point = { x: handle.world.x + delta.x, y: handle.world.y + delta.y };
    const text = rewriteCoordinate(newWorld, handle, source);
    if (text !== null) {
      pending.push({ span: handle.sourceSpan, text, handleId: handle.id });
    } else {
      skippedHandles.push(handle.id);
    }
  }

  if (pending.length === 0) {
    return { kind: "unsupported", reason: "No coordinate rewrites succeeded" };
  }

  // Sort descending by span start so that lower-offset spans remain valid after each replacement.
  pending.sort((a, b) => b.span.from - a.span.from);

  let currentSource = source;
  const patches: SourcePatch[] = [];

  for (const { span, text } of pending) {
    const updated = replaceSpan(currentSource, span, text);
    patches.push({ oldSpan: span, newSpan: updated.changedSpan, replacement: text });
    currentSource = updated.source;
  }

  if (skippedHandles.length > 0) {
    return {
      kind: "partial",
      newSource: currentSource,
      patches,
      skippedHandles,
      reason: "Some handles use unsupported coordinate forms and were skipped"
    };
  }

  return { kind: "success", newSource: currentSource, patches };
}

function applyAlignElements(
  source: string,
  action: Extract<EditAction, { kind: "alignElements" }>
): EditActionResult {
  const normalizedIds = normalizeElementIds(action.elementIds);
  if (normalizedIds.length < 2) {
    return { kind: "unsupported", reason: "Align requires at least 2 selected elements." };
  }

  const parsed = parseTikz(source, { recover: true });
  const semantic = evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = collectSourceWorldBounds(semantic.scene.elements);
  const plan = planAlignDeltas(boundsBySource, normalizedIds, action.mode);
  if (plan.kind === "unsupported") {
    return plan;
  }

  return applyElementDeltaMapStrict(source, semantic.editHandles, normalizedIds, plan.deltas);
}

function applyDistributeElements(
  source: string,
  action: Extract<EditAction, { kind: "distributeElements" }>
): EditActionResult {
  const normalizedIds = normalizeElementIds(action.elementIds);
  if (normalizedIds.length < 3) {
    return { kind: "unsupported", reason: "Distribute requires at least 3 selected elements." };
  }

  const parsed = parseTikz(source, { recover: true });
  const semantic = evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = collectSourceWorldBounds(semantic.scene.elements);
  const plan = planDistributeDeltas(boundsBySource, normalizedIds, action.axis);
  if (plan.kind === "unsupported") {
    return plan;
  }

  return applyElementDeltaMapStrict(source, semantic.editHandles, normalizedIds, plan.deltas);
}

function applyElementDeltaMapStrict(
  source: string,
  editHandles: EditHandle[],
  elementIds: readonly string[],
  deltasBySource: ReadonlyMap<string, Point>
): EditActionResult {
  const normalizedIds = normalizeElementIds(elementIds);
  if (normalizedIds.length === 0) {
    return { kind: "unsupported", reason: "No element ids were provided for arrange operation." };
  }

  const sourceIdSet = new Set(normalizedIds);
  const selectedHandles = editHandles.filter((handle) => sourceIdSet.has(handle.sourceId));
  if (selectedHandles.length === 0) {
    return { kind: "unsupported", reason: "No handles found for the selected element(s)." };
  }

  const handlesBySource = new Map<string, EditHandle[]>();
  for (const handle of selectedHandles) {
    const existing = handlesBySource.get(handle.sourceId);
    if (existing) {
      existing.push(handle);
    } else {
      handlesBySource.set(handle.sourceId, [handle]);
    }
  }

  for (const sourceId of normalizedIds) {
    const handles = handlesBySource.get(sourceId) ?? [];
    if (handles.length === 0) {
      return {
        kind: "unsupported",
        reason: `No handles found for selected element: ${sourceId}.`
      };
    }
    if (handles.some((handle) => handle.rewriteMode === "unsupported")) {
      return {
        kind: "unsupported",
        reason: "One or more selected elements use unsupported coordinate forms."
      };
    }
  }

  type PendingReplacement = { span: { from: number; to: number }; text: string };
  const pending: PendingReplacement[] = [];
  const replacementBySpan = new Map<string, string>();

  for (const handle of selectedHandles) {
    const delta = deltasBySource.get(handle.sourceId) ?? { x: 0, y: 0 };
    if (Math.abs(delta.x) <= ARRANGE_EPSILON && Math.abs(delta.y) <= ARRANGE_EPSILON) {
      continue;
    }

    const actualText = source.slice(handle.sourceSpan.from, handle.sourceSpan.to);
    if (actualText !== handle.sourceText) {
      return {
        kind: "unsupported",
        reason: "Some selected handles are stale. Wait for recompute and try again."
      };
    }

    const text = rewriteCoordinate(
      {
        x: handle.world.x + delta.x,
        y: handle.world.y + delta.y
      },
      handle,
      source
    );
    if (text == null) {
      return {
        kind: "unsupported",
        reason: "Could not rewrite one or more selected coordinates."
      };
    }

    const spanKey = `${handle.sourceSpan.from}:${handle.sourceSpan.to}`;
    const existing = replacementBySpan.get(spanKey);
    if (existing != null) {
      if (existing !== text) {
        return {
          kind: "unsupported",
          reason: "Arrange operation found conflicting rewrites for a shared coordinate span."
        };
      }
      continue;
    }

    replacementBySpan.set(spanKey, text);
    pending.push({ span: handle.sourceSpan, text });
  }

  if (pending.length === 0) {
    return { kind: "unsupported", reason: "Arrange operation would not change the source." };
  }

  pending.sort((left, right) => {
    if (left.span.from !== right.span.from) {
      return right.span.from - left.span.from;
    }
    return right.span.to - left.span.to;
  });

  let currentSource = source;
  const patches: SourcePatch[] = [];
  for (const replacement of pending) {
    const updated = replaceSpan(currentSource, replacement.span, replacement.text);
    patches.push({
      oldSpan: replacement.span,
      newSpan: updated.changedSpan,
      replacement: replacement.text
    });
    currentSource = updated.source;
  }

  return {
    kind: "success",
    newSource: currentSource,
    patches
  };
}

function applyPasteStatements(
  source: string,
  action: Extract<EditAction, { kind: "pasteStatements" }>
): EditActionResult {
  const snippets = action.snippets
    .map((snippet) => snippet.replace(/\r\n?/g, "\n").trimEnd())
    .filter((snippet) => snippet.trim().length > 0);
  if (snippets.length === 0) {
    return { kind: "unsupported", reason: "No snippets were provided for pasteStatements." };
  }

  const delta = normalizeDuplicateDelta(action.delta);
  const shifted = offsetSnippetsByDelta(snippets, delta);
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

  const insertion = formatSnippetsForInsertion(renamedSnippets, insertionPoint.indent);
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

function applyDuplicateElements(
  source: string,
  action: Extract<EditAction, { kind: "duplicateElements" }>
): EditActionResult {
  const normalizedIds = normalizeElementIds(action.elementIds);
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
  const delta = normalizeDuplicateDelta(action.delta);

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
      const shifted = offsetSnippetsByDelta(snippets, delta);
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
      skippedHandles: uniqueStrings(partialSkippedHandles),
      reason: uniqueStrings(partialReasons).join(" "),
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

function applyReorderElements(
  source: string,
  elementIds: readonly string[],
  direction: ReorderDirection
): EditActionResult {
  const normalizedIds = normalizeElementIds(elementIds);
  if (normalizedIds.length === 0) {
    return { kind: "unsupported", reason: "No element ids were provided for reorderElements." };
  }

  const initialSnapshot = parseStatementSnapshot(source);
  const initialRefs = resolveStatementRefs(initialSnapshot, normalizedIds);
  if (initialRefs.length === 0) {
    return { kind: "unsupported", reason: "No reorderable statements were found for the selected element ids." };
  }

  const groups = groupStatementRefsByParent(initialRefs);
  const trackedSpansById = new Map<string, Span>();
  for (const ref of initialRefs) {
    trackedSpansById.set(ref.id, { ...ref.span });
  }

  let currentSource = source;
  const patches: SourcePatch[] = [];

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
      const parentRefs = snapshot.byParentKey.get(resolvedGroup.parentKey) ?? [];
      if (parentRefs.length <= 1) {
        continue;
      }

      const selectedIdSet = new Set(resolvedGroup.refs.map((ref) => ref.id));
      const currentOrder = parentRefs.map((ref) => ref.id);
      const nextOrder = reorderStatementIds(currentOrder, selectedIdSet, direction);
      if (arraysEqual(currentOrder, nextOrder)) {
        continue;
      }

      const replacement = buildParentReorderReplacement(snapshot.source, parentRefs, nextOrder);
      if (!replacement) {
        continue;
      }

      const applied = applyTextReplacements(currentSource, [
        {
          span: replacement.span,
          text: replacement.text
        }
      ]);
      const appliedReplacement = applied.applied[0];
      if (!appliedReplacement) {
        continue;
      }

      patches.push(...applied.patches);
      currentSource = applied.source;

      for (const [id, span] of trackedSpansById.entries()) {
        const [shifted] = shiftSpansAfterReplacement([span], appliedReplacement.oldSpan, appliedReplacement.newSpan);
        if (shifted) {
          trackedSpansById.set(id, shifted);
        }
      }

      for (const [id, span] of replacement.newSpansById.entries()) {
        if (!trackedSpansById.has(id)) {
          continue;
        }
        trackedSpansById.set(id, {
          from: appliedReplacement.newSpan.from + (span.from - replacement.span.from),
          to: appliedReplacement.newSpan.from + (span.to - replacement.span.from)
        });
      }
    }
  }

  const finalTrackedSpans = normalizedIds
    .map((id) => trackedSpansById.get(id))
    .filter((span): span is Span => span != null);
  const selectedSourceIds = mapSpansToStatementIds(currentSource, finalTrackedSpans);

  return {
    kind: "success",
    newSource: currentSource,
    patches,
    selectedSourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : undefined
  };
}

type ReorderReplacement = {
  span: Span;
  text: string;
  newSpansById: Map<string, Span>;
};

function buildParentReorderReplacement(
  source: string,
  parentRefs: readonly StatementRef[],
  orderedIds: readonly string[]
): ReorderReplacement | null {
  if (parentRefs.length === 0) {
    return null;
  }

  const sortedRefs = [...parentRefs].sort((left, right) => left.index - right.index);
  const refsById = new Map(sortedRefs.map((ref) => [ref.id, ref] as const));

  const replacementSpan: Span = {
    from: sortedRefs[0]!.span.from,
    to: sortedRefs[sortedRefs.length - 1]!.span.to
  };

  const indent = lineIndentAtOffset(source, sortedRefs[0]!.span.from);
  const separator = resolveReorderStatementSeparator(source, sortedRefs, indent);

  let text = "";
  let cursor = replacementSpan.from;
  const newSpansById = new Map<string, Span>();
  for (let index = 0; index < orderedIds.length; index += 1) {
    const id = orderedIds[index];
    const ref = refsById.get(id);
    if (!ref) {
      continue;
    }

    const statementText = source.slice(ref.span.from, ref.span.to);
    newSpansById.set(id, {
      from: cursor,
      to: cursor + statementText.length
    });

    text += statementText;
    cursor += statementText.length;

    if (index < orderedIds.length - 1) {
      text += separator;
      cursor += separator.length;
    }
  }

  return {
    span: replacementSpan,
    text,
    newSpansById
  };
}

function resolveReorderStatementSeparator(
  source: string,
  sortedRefs: readonly StatementRef[],
  indent: string
): string {
  const newline = detectPreferredNewline(source, sortedRefs[0]?.span.from ?? 0);
  for (let index = 0; index < sortedRefs.length - 1; index += 1) {
    const left = sortedRefs[index];
    const right = sortedRefs[index + 1];
    if (!left || !right) {
      continue;
    }

    const gap = source.slice(left.span.to, right.span.from);
    if (gap.includes("\n")) {
      return `${gap.includes("\r\n") ? "\r\n" : "\n"}${indent}`;
    }
  }

  return `${newline}${indent}`;
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

function reorderStatementIds(
  ids: readonly string[],
  selected: ReadonlySet<string>,
  direction: ReorderDirection
): string[] {
  if (ids.length <= 1 || selected.size === 0) {
    return [...ids];
  }

  if (direction === "sendToBack") {
    const selectedIds = ids.filter((id) => selected.has(id));
    const unselectedIds = ids.filter((id) => !selected.has(id));
    return [...selectedIds, ...unselectedIds];
  }

  if (direction === "bringToFront") {
    const selectedIds = ids.filter((id) => selected.has(id));
    const unselectedIds = ids.filter((id) => !selected.has(id));
    return [...unselectedIds, ...selectedIds];
  }

  const reordered = [...ids];
  if (direction === "sendBackward") {
    for (let index = 1; index < reordered.length; index += 1) {
      if (!selected.has(reordered[index]!) || selected.has(reordered[index - 1]!)) {
        continue;
      }
      [reordered[index - 1], reordered[index]] = [reordered[index]!, reordered[index - 1]!];
    }
    return reordered;
  }

  for (let index = reordered.length - 2; index >= 0; index -= 1) {
    if (!selected.has(reordered[index]!) || selected.has(reordered[index + 1]!)) {
      continue;
    }
    [reordered[index], reordered[index + 1]] = [reordered[index + 1]!, reordered[index]!];
  }
  return reordered;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

type OffsetSnippetsResult = {
  snippets: string[];
  partialReason?: string;
  skippedHandles: string[];
};

function offsetSnippetsByDelta(
  snippets: readonly string[],
  delta: Point
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
  const moved = applyMoveElements(wrappedSource, semantic.editHandles, rootIds, delta);

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

function normalizeDuplicateDelta(delta: Point | undefined): Point {
  if (!delta) {
    return { x: DEFAULT_DUPLICATE_OFFSET_PT, y: -DEFAULT_DUPLICATE_OFFSET_PT };
  }

  return {
    x: Number.isFinite(delta.x) ? delta.x : DEFAULT_DUPLICATE_OFFSET_PT,
    y: Number.isFinite(delta.y) ? delta.y : -DEFAULT_DUPLICATE_OFFSET_PT
  };
}

type DeleteTarget = {
  span: Span;
  scope: "statement" | "path-item";
};

function applyDeleteElements(source: string, elementIds: readonly string[]): EditActionResult {
  const normalizedIds = normalizeElementIds(elementIds);
  if (normalizedIds.length === 0) {
    return { kind: "unsupported", reason: "No element ids were provided for deleteElements" };
  }

  const parsed = parseTikz(source, { recover: true });
  const targets: DeleteTarget[] = [];
  for (const elementId of normalizedIds) {
    const target = resolveDeleteTarget(parsed.figure.body, elementId);
    if (target) {
      targets.push(target);
    }
  }

  const collapsedTargets = collapseDeleteTargets(targets);
  if (collapsedTargets.length === 0) {
    return { kind: "unsupported", reason: "No deletable source span was found for the selected element(s)" };
  }

  const sorted = [...collapsedTargets].sort((a, b) => {
    if (a.span.from !== b.span.from) {
      return b.span.from - a.span.from;
    }
    return b.span.to - a.span.to;
  });

  let currentSource = source;
  const patches: SourcePatch[] = [];

  for (const target of sorted) {
    const span = normalizeDeleteSpan(currentSource, target.span, target.scope);
    const updated = replaceSpan(currentSource, span, "");
    patches.push({
      oldSpan: span,
      newSpan: updated.changedSpan,
      replacement: ""
    });
    currentSource = updated.source;
  }

  return {
    kind: "success",
    newSource: currentSource,
    patches
  };
}

function resolveDeleteTarget(statements: Statement[], elementId: string): DeleteTarget | null {
  for (const statement of statements) {
    if (statement.id === elementId) {
      return { span: statement.span, scope: "statement" };
    }

    if (statement.kind === "Path") {
      const itemTarget = resolveDeleteTargetInPath(statement.items, elementId);
      if (itemTarget) {
        const substantiveCount = statement.items.filter((item) => item.kind !== "PathComment").length;
        if (substantiveCount <= 1) {
          return { span: statement.span, scope: "statement" };
        }
        return itemTarget;
      }
      continue;
    }

    if (statement.kind === "Scope") {
      const nested = resolveDeleteTarget(statement.body, elementId);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function resolveDeleteTargetInPath(items: PathItem[], elementId: string): DeleteTarget | null {
  for (const item of items) {
    if (item.id === elementId) {
      return { span: item.span, scope: "path-item" };
    }

    if ((item.kind === "ToOperation" || item.kind === "EdgeOperation") && item.nodes) {
      for (const node of item.nodes) {
        if (node.id === elementId) {
          return { span: node.span, scope: "path-item" };
        }
      }
    }
  }
  return null;
}

function collapseDeleteTargets(targets: DeleteTarget[]): DeleteTarget[] {
  if (targets.length <= 1) {
    return targets;
  }

  const sorted = [...targets].sort((a, b) => {
    if (a.span.from !== b.span.from) {
      return a.span.from - b.span.from;
    }
    return b.span.to - a.span.to;
  });

  const collapsed: DeleteTarget[] = [];
  for (const target of sorted) {
    const contained = collapsed.some(
      (existing) => target.span.from >= existing.span.from && target.span.to <= existing.span.to
    );
    if (contained) {
      continue;
    }
    collapsed.push(target);
  }
  return collapsed;
}

function normalizeDeleteSpan(source: string, span: Span, scope: DeleteTarget["scope"]): Span {
  let from = clampOffset(span.from, source.length);
  let to = clampOffset(span.to, source.length);
  if (to < from) {
    [from, to] = [to, from];
  }

  while (from > 0 && (source[from - 1] === " " || source[from - 1] === "\t")) {
    from -= 1;
  }
  while (to < source.length && (source[to] === " " || source[to] === "\t")) {
    to += 1;
  }

  if (scope === "statement") {
    if (to < source.length && source[to] === "\r") {
      to += 1;
    }
    if (to < source.length && source[to] === "\n") {
      to += 1;
    } else if (from > 0 && source[from - 1] === "\n") {
      from -= 1;
      if (from > 0 && source[from - 1] === "\r") {
        from -= 1;
      }
    }
  }

  return { from, to };
}

function clampOffset(value: number, sourceLength: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(sourceLength, Math.trunc(value)));
}

function normalizeElementIds(elementIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const elementId of elementIds) {
    const id = elementId.trim();
    if (id.length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function applySetProperty(
  source: string,
  action: Extract<EditAction, { kind: "setProperty" }>
): EditActionResult {
  if (action.level !== "command") {
    return {
      kind: "unsupported",
      reason: `setProperty currently supports only command level edits (received ${action.level})`
    };
  }

  const key = normalizeOptionKey(action.key);
  if (key.length === 0) {
    return { kind: "error", message: "Cannot set an empty option key" };
  }

  const resolved = resolvePropertyTarget(source, action.elementId);
  if (resolved.kind === "not-found") {
    return { kind: "unsupported", reason: resolved.reason };
  }

  const target = resolved.target;
  if (target.options && target.optionsSpan) {
    const replacement = rewriteOptionList(target.options, key, action.value);
    const updated = replaceSpan(source, target.optionsSpan, replacement);
    return {
      kind: "success",
      newSource: updated.source,
      patches: [
        {
          oldSpan: target.optionsSpan,
          newSpan: updated.changedSpan,
          replacement
        }
      ]
    };
  }

  const replacement = `[${serializeOptionEntry(key, action.value)}]`;
  const insertionSpan = {
    from: target.insertOffset,
    to: target.insertOffset
  };
  const updated = replaceSpan(source, insertionSpan, replacement);
  return {
    kind: "success",
    newSource: updated.source,
    patches: [
      {
        oldSpan: insertionSpan,
        newSpan: updated.changedSpan,
        replacement
      }
    ]
  };
}

function applyAddElement(
  source: string,
  template: ElementTemplate,
  at: Point
): EditActionResult {
  const snippet = generateElementSource(template, at);
  if (snippet.trim().length === 0) {
    return { kind: "error", message: "Failed to generate source for the requested element template." };
  }

  const newSource = insertElementIntoSource(source, snippet);
  if (newSource === source) {
    return { kind: "unsupported", reason: "The source insertion point could not be resolved." };
  }

  return {
    kind: "success",
    newSource,
    patches: [computeReplacementPatch(source, newSource)]
  };
}

function rewriteOptionList(options: OptionListAst, key: string, value: string): string {
  const replacementEntry = serializeOptionEntry(key, value);
  const parts: string[] = [];
  let replaced = false;

  for (const entry of options.entries) {
    const entryKey = optionEntryKey(entry);
    if (entryKey === key) {
      if (!replaced) {
        parts.push(replacementEntry);
        replaced = true;
      }
      continue;
    }

    const normalized = normalizeOptionEntryRaw(entry);
    if (normalized.length > 0) {
      parts.push(normalized);
    }
  }

  if (!replaced) {
    parts.push(replacementEntry);
  }

  return `[${parts.join(", ")}]`;
}

function optionEntryKey(entry: OptionEntry): string | null {
  if (entry.kind === "kv" || entry.kind === "flag") {
    return normalizeOptionKey(entry.key);
  }
  return null;
}

function normalizeOptionEntryRaw(entry: OptionEntry): string {
  const raw = entry.raw.trim();
  if (raw.length > 0) {
    return raw;
  }
  if (entry.kind === "kv") {
    return `${entry.key}=${entry.valueRaw}`;
  }
  if (entry.kind === "flag") {
    return entry.key;
  }
  return "";
}

function normalizeOptionKey(key: string): string {
  return key.trim().toLowerCase();
}

function serializeOptionEntry(key: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === "true") {
    return key;
  }
  return `${key}=${trimmed}`;
}

function computeReplacementPatch(oldSource: string, newSource: string): SourcePatch {
  if (oldSource === newSource) {
    return {
      oldSpan: { from: 0, to: 0 },
      newSpan: { from: 0, to: 0 },
      replacement: ""
    };
  }

  const oldLen = oldSource.length;
  const newLen = newSource.length;
  const minLen = Math.min(oldLen, newLen);

  let prefix = 0;
  while (prefix < minLen && oldSource.charCodeAt(prefix) === newSource.charCodeAt(prefix)) {
    prefix += 1;
  }

  let oldSuffix = oldLen;
  let newSuffix = newLen;
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
