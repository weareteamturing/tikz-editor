import type {
  EditHandle,
  EvaluateOptions,
  Point,
  SceneCircle,
  SceneElement,
  SceneEllipse,
  ScenePath,
  ScenePathShapeHint
} from "../semantic/types.js";
import type { CoordinateItem, NodeItem, PathItem, PathOptionItem, PathStatement, Statement, Span } from "../ast/types.js";
import type { SourcePatch } from "./types.js";
import { applyEditIntent } from "./apply.js";
import { rewriteCoordinate } from "./rewrite.js";
import { replaceSpan } from "./patch.js";
import { CM_PER_PT, PT_PER_CM, formatNumber } from "./format.js";
import {
  generateElementSource,
  insertElementIntoSource,
  type ElementTemplate
} from "./element-templates.js";
import type { OptionEntry } from "../options/types.js";
import { resolvePropertyTarget, type PropertyTarget } from "./property-target.js";
import { parseTikz } from "../parser/index.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import { parseCircleRadiusFromCoordinateRaw, parseEllipseRadiiFromCoordinateRaw } from "../semantic/path/parsers.js";
import { parseLength } from "../semantic/coords/parse-length.js";
import { applyMatrix } from "../semantic/transform.js";
import { planAlignDeltas, planDistributeDeltas, type AlignMode, type DistributeAxis } from "./arrange.js";
import { collectSourceWorldBounds } from "./snapping/index.js";
import { localToSourceUnits, worldToLocal } from "./coords.js";
import { renameSnippetDeclaredNames } from "./name-conflicts.js";
import {
  applyOptionMutationsToTarget,
  normalizeOptionKey,
  rewriteOptionListMutations,
  serializeOptionEntry,
  type OptionMutation,
  type OptionMutationApplyResult
} from "./option-mutations.js";
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
  | {
      kind: "setProperty";
      elementId: string;
      level: StyleLevel;
      key: string;
      value: string;
      clearKeys?: string[];
    }
  | { kind: "addElement"; template: ElementTemplate; at: Point }
  | { kind: "deleteElement"; elementId: string }
  | { kind: "deleteElements"; elementIds: string[] }
  | { kind: "pasteStatements"; snippets: string[]; anchorElementId?: string; delta?: Point }
  | { kind: "duplicateElements"; elementIds: string[]; delta?: Point }
  | { kind: "reorderElements"; elementIds: string[]; direction: ReorderDirection }
  | {
      kind: "resizeElement";
      elementId: string;
      role: ResizeRole;
      newWorld: Point;
      preserveAspect?: boolean;
      preserveAspectRatio?: number;
    };

export type EditActionResult =
  | { kind: "success"; newSource: string; patches: SourcePatch[]; selectedSourceIds?: string[]; changedSourceIds?: string[] }
  | {
      kind: "partial";
      newSource: string;
      patches: SourcePatch[];
      skippedHandles: string[];
      reason: string;
      selectedSourceIds?: string[];
      changedSourceIds?: string[];
    }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

const DEFAULT_DUPLICATE_OFFSET_PT = 0.25 * PT_PER_CM;
const ARRANGE_EPSILON = 1e-6;
const RESIZE_EPSILON = 1e-3;

type EditActionApplyOptions = {
  evaluateOptions?: EvaluateOptions;
};

export function applyEditAction(
  source: string,
  editHandles: EditHandle[],
  action: EditAction,
  options: EditActionApplyOptions = {}
): EditActionResult {
  const evaluateOptions = options.evaluateOptions;
  const result = (() : EditActionResult => {
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
        return applyResizeElement(source, action, evaluateOptions);
    }
  })();
  return withChangedSourceIds(result, action, editHandles);
}

function applyMoveHandle(
  source: string,
  editHandles: EditHandle[],
  handleId: string,
  newWorld: Point
): EditActionResult {
  const result = applyEditIntent(source, editHandles, { kind: "move", handleId, newWorld });
  if (result.kind === "success") {
    return {
      kind: "success",
      newSource: result.newSource,
      patches: result.patches,
      changedSourceIds: result.changedSourceIds
    };
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

  const parsed = parseTikz(source, { recover: true });
  const matrixElementIds = normalizedIds.filter((elementId) => {
    const statement = findPathStatementById(parsed.figure.body, elementId);
    return statement != null && isMatrixPathStatement(statement);
  });
  const matrixElementIdSet = new Set(matrixElementIds);
  const nonMatrixElementIds = normalizedIds.filter((elementId) => !matrixElementIdSet.has(elementId));

  const matrixPlacementHandlesBySource = new Map<string, EditHandle>();
  for (const handle of editHandles) {
    if (handle.kind !== "node-position" || !matrixElementIdSet.has(handle.sourceId)) {
      continue;
    }
    if (!matrixPlacementHandlesBySource.has(handle.sourceId)) {
      matrixPlacementHandlesBySource.set(handle.sourceId, handle);
    }
  }

  let currentSource = source;
  const patches: SourcePatch[] = [];
  const skippedHandles: string[] = [];
  const reasons: string[] = [];
  let movedAny = false;

  if (nonMatrixElementIds.length > 0) {
    const byHandles = applyMoveElementsUsingHandleRewrites(currentSource, editHandles, nonMatrixElementIds, delta);
    if (byHandles.kind === "error") {
      return byHandles;
    }
    if (byHandles.kind === "success" || byHandles.kind === "partial") {
      currentSource = byHandles.newSource;
      patches.push(...byHandles.patches);
      movedAny = true;
      if (byHandles.kind === "partial") {
        skippedHandles.push(...byHandles.skippedHandles);
        reasons.push(byHandles.reason);
      }
    } else {
      reasons.push(byHandles.reason);
    }
  }

  if (matrixElementIds.length > 0) {
    const byMatrixPlacement = applyMoveMatrixElementsWithPlacementRewrite(
      currentSource,
      matrixElementIds,
      delta,
      matrixPlacementHandlesBySource
    );
    if (byMatrixPlacement.kind === "error") {
      return byMatrixPlacement;
    }
    if (byMatrixPlacement.kind === "success" || byMatrixPlacement.kind === "partial") {
      currentSource = byMatrixPlacement.newSource;
      patches.push(...byMatrixPlacement.patches);
      movedAny = true;
      if (byMatrixPlacement.kind === "partial") {
        reasons.push(byMatrixPlacement.reason);
      }
    } else {
      reasons.push(byMatrixPlacement.reason);
    }
  }

  if (!movedAny) {
    return {
      kind: "unsupported",
      reason: reasons[0] ?? "No coordinate rewrites succeeded"
    };
  }

  const uniqueReasons = uniqueStrings(reasons);
  if (uniqueReasons.length > 0 || skippedHandles.length > 0) {
    return {
      kind: "partial",
      newSource: currentSource,
      patches,
      skippedHandles: uniqueStrings(skippedHandles),
      reason:
        uniqueReasons.length > 0
          ? uniqueReasons.join(" ")
          : "Some handles use unsupported coordinate forms and were skipped"
    };
  }

  return { kind: "success", newSource: currentSource, patches };
}

function applyMoveElementsUsingHandleRewrites(
  source: string,
  editHandles: EditHandle[],
  elementIds: readonly string[],
  delta: Point
): EditActionResult {
  const sourceIdSet = new Set(elementIds);
  const elementHandles = editHandles.filter((handle) => sourceIdSet.has(handle.sourceId));

  if (elementHandles.length === 0) {
    return { kind: "unsupported", reason: "No handles found for the selected element(s)" };
  }

  const rewritable = elementHandles.filter((handle) => handle.rewriteMode !== "unsupported");
  const skippedHandles = elementHandles
    .filter((handle) => handle.rewriteMode === "unsupported")
    .map((handle) => handle.id);

  if (rewritable.length === 0) {
    return {
      kind: "unsupported",
      reason: "All handles for the selected element(s) use unsupported coordinate forms"
    };
  }

  type PendingReplacement = { span: { from: number; to: number }; text: string };
  const pending: PendingReplacement[] = [];

  for (const handle of rewritable) {
    const actualText = source.slice(handle.sourceSpan.from, handle.sourceSpan.to);
    if (actualText !== handle.sourceText) {
      skippedHandles.push(handle.id);
      continue;
    }

    const newWorld: Point = { x: handle.world.x + delta.x, y: handle.world.y + delta.y };
    const text = rewriteCoordinate(newWorld, handle, source);
    if (text != null) {
      pending.push({ span: handle.sourceSpan, text });
    } else {
      skippedHandles.push(handle.id);
    }
  }

  if (pending.length === 0) {
    return { kind: "unsupported", reason: "No coordinate rewrites succeeded" };
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

function applyMoveMatrixElementsWithPlacementRewrite(
  source: string,
  elementIds: readonly string[],
  delta: Point,
  placementHandlesBySource: ReadonlyMap<string, EditHandle>
): EditActionResult {
  let currentSource = source;
  const patches: SourcePatch[] = [];
  const failedElementIds: string[] = [];
  const failureReasons: string[] = [];

  for (const elementId of elementIds) {
    const placementHandle = placementHandlesBySource.get(elementId);
    const rewrite = rewriteSingleMatrixPlacement(currentSource, elementId, delta, placementHandle);
    if (rewrite.kind === "unsupported") {
      failedElementIds.push(elementId);
      failureReasons.push(rewrite.reason);
      continue;
    }

    currentSource = rewrite.source;
    patches.push(rewrite.patch);
  }

  if (patches.length === 0) {
    return {
      kind: "unsupported",
      reason:
        failureReasons[0] ??
        "No matrix placement rewrite succeeded"
    };
  }

  if (failedElementIds.length > 0) {
    return {
      kind: "partial",
      newSource: currentSource,
      patches,
      skippedHandles: [],
      reason: `Could not move some matrix elements (${failedElementIds.join(", ")}): ${uniqueStrings(failureReasons).join(" ")}`
    };
  }

  return {
    kind: "success",
    newSource: currentSource,
    patches
  };
}

type MatrixPlacementRewriteResult =
  | { kind: "success"; source: string; patch: SourcePatch }
  | { kind: "unsupported"; reason: string };

function rewriteSingleMatrixPlacement(
  source: string,
  elementId: string,
  delta: Point,
  placementHandle: EditHandle | undefined
): MatrixPlacementRewriteResult {
  const parsed = parseTikz(source, { recover: true });
  const statement = findPathStatementById(parsed.figure.body, elementId);
  if (!statement) {
    return { kind: "unsupported", reason: `Matrix statement ${elementId} was not found` };
  }
  if (!isMatrixPathStatement(statement)) {
    return { kind: "unsupported", reason: `${elementId} is not a matrix statement` };
  }

  const matrixNode = findPrimaryMatrixNodeItem(statement);
  if (!matrixNode) {
    return { kind: "unsupported", reason: `Matrix node item for ${elementId} was not found` };
  }

  const semantic = evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = collectSourceWorldBounds(semantic.scene.elements);
  const bounds = boundsBySource.get(elementId);
  if (!bounds) {
    return { kind: "unsupported", reason: `Could not resolve semantic bounds for matrix ${elementId}` };
  }

  const nextCenterWorld: Point = {
    x: (bounds.minX + bounds.maxX) / 2 + delta.x,
    y: (bounds.minY + bounds.maxY) / 2 + delta.y
  };
  const nextCoordinate = formatPlacementCoordinateFromWorld(nextCenterWorld, placementHandle?.transform);

  const inlineAtCoordinate = findInlineAtCoordinateItem(statement);
  if (inlineAtCoordinate) {
    const rewrittenInline = replaceSourceSpan(source, inlineAtCoordinate.span, nextCoordinate);
    if (rewrittenInline) {
      return { kind: "success", ...rewrittenInline };
    }
    return {
      kind: "unsupported",
      reason: `Matrix ${elementId} placement already matches the requested position`
    };
  }

  const atOptionEntry = matrixNode.options?.entries.find(
    (entry): entry is Extract<OptionEntry, { kind: "kv" }> => entry.kind === "kv" && entry.key === "at"
  );
  if (atOptionEntry) {
    const serializedValue = serializeAtOptionValue(atOptionEntry.valueRaw, nextCoordinate);
    const replacement = `at=${serializedValue}`;
    const rewrittenOption = replaceSourceSpan(source, atOptionEntry.span, replacement);
    if (rewrittenOption) {
      return { kind: "success", ...rewrittenOption };
    }
    return {
      kind: "unsupported",
      reason: `Matrix ${elementId} placement already matches the requested position`
    };
  }

  const insertionMutations = new Map<string, OptionMutation>([["at", { kind: "set", value: nextCoordinate }]]);
  if (matrixNode.optionsSpan) {
    const existingOptions = source.slice(matrixNode.optionsSpan.from, matrixNode.optionsSpan.to);
    const replacement = appendOptionEntryToListRaw(existingOptions, `at=${nextCoordinate}`);
    const rewrittenOptions = replaceSourceSpan(source, matrixNode.optionsSpan, replacement);
    if (rewrittenOptions) {
      return { kind: "success", ...rewrittenOptions };
    }
  }

  const matrixTarget = resolvePropertyTarget(source, matrixNode.id);
  if (matrixTarget.kind === "found") {
    const rewritten = applyOptionMutationsToTarget(source, matrixTarget.target, insertionMutations);
    if (rewritten) {
      return {
        kind: "success",
        source: rewritten.source,
        patch: rewritten.patch
      };
    }
  }

  return {
    kind: "unsupported",
    reason: `Could not rewrite matrix placement for ${elementId}`
  };
}

function replaceSourceSpan(
  source: string,
  span: Span,
  replacement: string
): { source: string; patch: SourcePatch } | null {
  const previous = source.slice(span.from, span.to);
  if (previous === replacement) {
    return null;
  }
  const updated = replaceSpan(source, span, replacement);
  return {
    source: updated.source,
    patch: {
      oldSpan: span,
      newSpan: updated.changedSpan,
      replacement
    }
  };
}

function serializeAtOptionValue(existingRaw: string, nextCoordinate: string): string {
  const trimmed = existingRaw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return `{${nextCoordinate}}`;
  }
  return nextCoordinate;
}

function appendOptionEntryToListRaw(optionsRaw: string, entry: string): string {
  const trimmed = optionsRaw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return `[${entry}]`;
  }

  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return `[${entry}]`;
  }

  return `[${inner}, ${entry}]`;
}

function formatPlacementCoordinateFromWorld(world: Point, transform?: EditHandle["transform"]): string {
  if (transform) {
    const local = worldToLocal(world, transform);
    if (local) {
      const inSourceUnits = localToSourceUnits(local);
      return `(${formatNumber(inSourceUnits.x)},${formatNumber(inSourceUnits.y)})`;
    }
  }

  return `(${formatNumber(world.x * CM_PER_PT)},${formatNumber(world.y * CM_PER_PT)})`;
}

function findPrimaryMatrixNodeItem(statement: PathStatement): NodeItem | null {
  for (const item of statement.items) {
    if (item.kind === "Node" && isMatrixNodeItem(item)) {
      return item;
    }
  }
  return null;
}

function findInlineAtCoordinateItem(statement: PathStatement): CoordinateItem | null {
  for (let index = 0; index < statement.items.length - 1; index += 1) {
    const item = statement.items[index];
    const next = statement.items[index + 1];
    if (!item || !next) {
      continue;
    }
    if (item.kind === "PathKeyword" && item.keyword === "at" && next.kind === "Coordinate") {
      return next;
    }
  }
  return null;
}

function isMatrixPathStatement(statement: PathStatement): boolean {
  return statement.items.some((item) => item.kind === "Node" && isMatrixNodeItem(item));
}

function isMatrixNodeItem(item: NodeItem): boolean {
  for (const entry of item.options?.entries ?? []) {
    if (entry.kind !== "flag" && entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "matrix" || entry.key === "matrix of nodes" || entry.key === "matrix of math nodes") {
      return true;
    }
  }
  return false;
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

function withChangedSourceIds(
  result: EditActionResult,
  action: EditAction,
  editHandles: EditHandle[]
): EditActionResult {
  if (result.kind !== "success" && result.kind !== "partial") {
    return result;
  }

  if (result.changedSourceIds && result.changedSourceIds.length > 0) {
    return result;
  }

  const changedSourceIds = inferChangedSourceIds(result, action, editHandles);
  if (changedSourceIds.length === 0) {
    return result;
  }

  return {
    ...result,
    changedSourceIds
  };
}

function inferChangedSourceIds(
  result: Extract<EditActionResult, { kind: "success" | "partial" }>,
  action: EditAction,
  editHandles: EditHandle[]
): string[] {
  switch (action.kind) {
    case "moveElement":
      return normalizeElementIds([action.elementId]);
    case "moveElements":
      return normalizeElementIds(action.elementIds);
    case "alignElements":
      return normalizeElementIds(action.elementIds);
    case "distributeElements":
      return normalizeElementIds(action.elementIds);
    case "moveHandle": {
      const handle = editHandles.find((candidate) => candidate.id === action.handleId);
      return handle ? normalizeElementIds([handle.sourceId]) : [];
    }
    case "addElement":
    case "pasteStatements":
      return normalizeElementIds(result.selectedSourceIds ?? []);
    case "duplicateElements":
      return normalizeElementIds(result.selectedSourceIds ?? action.elementIds);
    case "deleteElement":
      return normalizeElementIds([action.elementId]);
    case "deleteElements":
      return normalizeElementIds(action.elementIds);
    case "reorderElements":
      return normalizeElementIds(action.elementIds);
    case "setProperty":
      return [];
    case "resizeElement":
      return normalizeElementIds([action.elementId]);
  }
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

  const normalizedValue = action.value.trim();
  const removePrimaryKey = normalizedValue.length === 0;
  const mutations = new Map<string, OptionMutation>();
  for (const rawClearKey of action.clearKeys ?? []) {
    const clearKey = normalizeOptionKey(rawClearKey);
    if (clearKey.length === 0) {
      continue;
    }
    if (clearKey === key && !removePrimaryKey) {
      continue;
    }
    mutations.set(clearKey, { kind: "remove" });
  }
  if (removePrimaryKey) {
    mutations.set(key, { kind: "remove" });
  } else {
    mutations.set(key, { kind: "set", value: action.value });
  }
  const rewritten = applyOptionMutationsToTarget(source, resolved.target, mutations);
  if (!rewritten) {
    return { kind: "unsupported", reason: "setProperty would not change the source." };
  }

  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch]
  };
}

function applyResizeElement(
  source: string,
  action: Extract<EditAction, { kind: "resizeElement" }>,
  evaluateOptions: EvaluateOptions | undefined
): EditActionResult {
  const elementId = action.elementId.trim();
  if (elementId.length === 0) {
    return { kind: "unsupported", reason: "Missing element id for resizeElement." };
  }

  const resolved = resolvePropertyTarget(source, elementId);
  if (resolved.kind === "not-found") {
    return { kind: "unsupported", reason: resolved.reason };
  }

  const parsed = parseTikz(source, { recover: true });
  const semantic = evaluateTikzFigure(parsed.figure, source, evaluateOptions);
  const hasNodePositionHandle = semantic.editHandles.some(
    (handle) => handle.sourceId === elementId && handle.kind === "node-position"
  );
  if (!hasNodePositionHandle) {
    const rectangleContext = resolvePathRectangleResizeContext(
      parsed.figure.body,
      semantic.scene.elements,
      semantic.editHandles,
      elementId
    );
    if (rectangleContext.kind === "found") {
      return applyResizePathRectangle(source, action, rectangleContext);
    }
    if (rectangleContext.kind === "unsupported") {
      return rectangleContext;
    }

    return applyResizePathCircleOrEllipse(
      source,
      action,
      parsed.figure.body,
      semantic.scene.elements,
      semantic.editHandles
    );
  }

  const resizeTarget = resolveResizePropertyTarget(source, parsed.figure.body, elementId, resolved.target);
  const currentBoundsBySource = collectSourceWorldBounds(semantic.scene.elements);
  const currentBounds = currentBoundsBySource.get(elementId);
  if (!currentBounds) {
    return { kind: "unsupported", reason: "No geometry bounds were found for the selected node." };
  }

  const center = {
    x: (currentBounds.minX + currentBounds.maxX) / 2,
    y: (currentBounds.minY + currentBounds.maxY) / 2
  };
  const rotation = resolveNodeResizeRotationDegrees(semantic.scene.elements, elementId);

  const floorMutations = new Map<string, OptionMutation>([
    ["minimum width", { kind: "remove" }],
    ["minimum height", { kind: "remove" }]
  ]);
  const floorRewrite = applyOptionMutationsToTarget(source, resizeTarget, floorMutations);
  const floorSource = floorRewrite ? floorRewrite.source : source;
  const floorParsed = parseTikz(floorSource, { recover: true });
  const floorSemantic = evaluateTikzFigure(floorParsed.figure, floorSource, evaluateOptions);
  const floorBoundsBySource = collectSourceWorldBounds(floorSemantic.scene.elements);
  const floorBounds = floorBoundsBySource.get(elementId);
  if (!floorBounds) {
    return { kind: "unsupported", reason: "Could not resolve intrinsic node bounds for resize." };
  }

  const affectsWidth = action.role.includes("left") || action.role.includes("right");
  const affectsHeight = action.role.includes("top") || action.role.includes("bottom");
  if (!affectsWidth && !affectsHeight) {
    return { kind: "unsupported", reason: `Unsupported resize role: ${action.role}` };
  }

  const pointerDelta = {
    x: action.newWorld.x - center.x,
    y: action.newWorld.y - center.y
  };
  const localPointerDelta = rotateVector(pointerDelta, -rotation);
  const requestedWidth = 2 * Math.abs(localPointerDelta.x);
  const requestedHeight = 2 * Math.abs(localPointerDelta.y);
  const intrinsicWidth = floorBounds.maxX - floorBounds.minX;
  const intrinsicHeight = floorBounds.maxY - floorBounds.minY;

  const resizeMutations = new Map<string, OptionMutation>();
  if (affectsWidth) {
    if (requestedWidth > intrinsicWidth + RESIZE_EPSILON) {
      resizeMutations.set("minimum width", { kind: "set", value: `${formatNumber(requestedWidth)}pt` });
    } else {
      resizeMutations.set("minimum width", { kind: "remove" });
    }
  }

  if (affectsHeight) {
    if (requestedHeight > intrinsicHeight + RESIZE_EPSILON) {
      resizeMutations.set("minimum height", { kind: "set", value: `${formatNumber(requestedHeight)}pt` });
    } else {
      resizeMutations.set("minimum height", { kind: "remove" });
    }
  }

  const rewritten = applyOptionMutationsToTarget(source, resizeTarget, resizeMutations);
  if (!rewritten) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch]
  };
}

type PathShapeResizeSyntax = {
  keyword: "circle" | "ellipse";
  keywordSpan: Span;
  optionItems: PathOptionItem[];
  payloadCoordinate: CoordinateItem | null;
};

type PathShapeResizeContext = {
  kind: "found";
  shapeKind: "circle" | "ellipse";
  center: Point;
  syntax: PathShapeResizeSyntax;
  centerHandle: EditHandle;
};

type RectangleCornerRole = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type PathRectangleResizeContext = {
  kind: "found";
  startHandle: EditHandle;
  oppositeHandle: EditHandle;
};

type PathRectangleResizeResolution =
  | PathRectangleResizeContext
  | { kind: "not-rectangle" }
  | { kind: "unsupported"; reason: string };

function applyResizePathRectangle(
  source: string,
  action: Extract<EditAction, { kind: "resizeElement" }>,
  context: PathRectangleResizeContext
): EditActionResult {
  const affectsWidth = action.role.includes("left") || action.role.includes("right");
  const affectsHeight = action.role.includes("top") || action.role.includes("bottom");
  if (!affectsWidth && !affectsHeight) {
    return { kind: "unsupported", reason: `Unsupported resize role: ${action.role}` };
  }

  const transform = context.startHandle.transform;
  const localPointer = worldToLocal(action.newWorld, transform);
  const startLocal = context.startHandle.local ?? worldToLocal(context.startHandle.world, transform);
  const oppositeLocal = context.oppositeHandle.local ?? worldToLocal(context.oppositeHandle.world, transform);
  if (!localPointer || !startLocal || !oppositeLocal) {
    return { kind: "unsupported", reason: "Could not resolve local geometry for rectangle resize." };
  }

  const roleCorners = resolveRectangleRoleCorners(startLocal, oppositeLocal);
  const currentMinX = Math.min(startLocal.x, oppositeLocal.x);
  const currentMaxX = Math.max(startLocal.x, oppositeLocal.x);
  const currentMinY = Math.min(startLocal.y, oppositeLocal.y);
  const currentMaxY = Math.max(startLocal.y, oppositeLocal.y);

  let minX = currentMinX;
  let maxX = currentMaxX;
  let minY = currentMinY;
  let maxY = currentMaxY;

  if (isRectangleCornerRole(action.role)) {
    const fixedLocal = roleCorners[oppositeRectangleCornerRole(action.role)];
    minX = Math.min(fixedLocal.x, localPointer.x);
    maxX = Math.max(fixedLocal.x, localPointer.x);
    minY = Math.min(fixedLocal.y, localPointer.y);
    maxY = Math.max(fixedLocal.y, localPointer.y);
  } else if (action.role === "left" || action.role === "right") {
    const fixedX = action.role === "left"
      ? (roleCorners["top-right"].x + roleCorners["bottom-right"].x) / 2
      : (roleCorners["top-left"].x + roleCorners["bottom-left"].x) / 2;
    minX = Math.min(fixedX, localPointer.x);
    maxX = Math.max(fixedX, localPointer.x);
  } else if (action.role === "top" || action.role === "bottom") {
    const fixedY = action.role === "top"
      ? (roleCorners["bottom-left"].y + roleCorners["bottom-right"].y) / 2
      : (roleCorners["top-left"].y + roleCorners["top-right"].y) / 2;
    minY = Math.min(fixedY, localPointer.y);
    maxY = Math.max(fixedY, localPointer.y);
  }

  const startUsesMinX = startLocal.x <= oppositeLocal.x;
  const startUsesMinY = startLocal.y <= oppositeLocal.y;

  const nextStartLocal: Point = {
    x: startUsesMinX ? minX : maxX,
    y: startUsesMinY ? minY : maxY
  };
  const nextOppositeLocal: Point = {
    x: startUsesMinX ? maxX : minX,
    y: startUsesMinY ? maxY : minY
  };

  const nextStartWorld = applyMatrix(transform, nextStartLocal);
  const nextOppositeWorld = applyMatrix(transform, nextOppositeLocal);
  let oppositeRewriteHandle = context.oppositeHandle;
  if (
    oppositeRewriteHandle.rewriteMode === "delta" &&
    oppositeRewriteHandle.relativeBaseWorld &&
    pointDistanceSquared(oppositeRewriteHandle.relativeBaseWorld, context.startHandle.world) <= 1e-6
  ) {
    oppositeRewriteHandle = {
      ...oppositeRewriteHandle,
      relativeBaseWorld: nextStartWorld
    };
  }

  const rewriteTargets: Array<{ handle: EditHandle; newWorld: Point }> = [
    { handle: context.startHandle, newWorld: nextStartWorld },
    { handle: oppositeRewriteHandle, newWorld: nextOppositeWorld }
  ];

  const replacementBySpan = new Map<string, { span: Span; text: string }>();
  for (const target of rewriteTargets) {
    const handle = target.handle;
    const actualText = source.slice(handle.sourceSpan.from, handle.sourceSpan.to);
    if (actualText !== handle.sourceText) {
      return { kind: "unsupported", reason: "Some selected handles are stale. Wait for recompute and try again." };
    }

    const text = rewriteCoordinate(target.newWorld, handle, source);
    if (text == null) {
      return { kind: "unsupported", reason: "Could not rewrite one or more rectangle coordinates." };
    }
    if (text === actualText) {
      continue;
    }

    const spanKey = `${handle.sourceSpan.from}:${handle.sourceSpan.to}`;
    const existing = replacementBySpan.get(spanKey);
    if (existing) {
      if (existing.text !== text) {
        return { kind: "unsupported", reason: "Rectangle resize produced conflicting rewrites for a shared coordinate." };
      }
      continue;
    }

    replacementBySpan.set(spanKey, {
      span: handle.sourceSpan,
      text
    });
  }

  const replacements = [...replacementBySpan.values()];
  if (replacements.length === 0) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  const applied = applyTextReplacements(source, replacements);
  if (applied.source === source) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  return {
    kind: "success",
    newSource: applied.source,
    patches: applied.patches
  };
}

function resolvePathRectangleResizeContext(
  statements: readonly Statement[],
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  elementId: string
): PathRectangleResizeResolution {
  const pathStatement = findPathStatementById(statements, elementId);
  if (!pathStatement) {
    return { kind: "not-rectangle" };
  }

  const sourceElements = elements.filter((element) => element.sourceId === elementId);
  const nonTextElements = sourceElements.filter((element) => element.kind !== "Text");
  if (nonTextElements.length !== 1) {
    return { kind: "not-rectangle" };
  }

  const rectangle = nonTextElements[0];
  if (!rectangle || rectangle.kind !== "Path") {
    return { kind: "not-rectangle" };
  }
  if (resolveScenePathShapeHint(rectangle, pathStatement) !== "rectangle") {
    return { kind: "not-rectangle" };
  }

  const pathPointHandles = editHandles.filter(
    (handle) => handle.sourceId === elementId && handle.kind === "path-point"
  );
  if (pathPointHandles.length !== 2) {
    return {
      kind: "unsupported",
      reason: "Resize requires rectangles with explicit start and target coordinates."
    };
  }

  const [startHandle, oppositeHandle] = pathPointHandles;
  if (!startHandle || !oppositeHandle) {
    return {
      kind: "unsupported",
      reason: "Resize requires rectangles with explicit start and target coordinates."
    };
  }

  if (startHandle.rewriteMode === "unsupported" || oppositeHandle.rewriteMode === "unsupported") {
    return {
      kind: "unsupported",
      reason: "Rectangle resize requires rewritable rectangle coordinates."
    };
  }

  if (
    startHandle.sourceSpan.from === oppositeHandle.sourceSpan.from &&
    startHandle.sourceSpan.to === oppositeHandle.sourceSpan.to
  ) {
    return {
      kind: "unsupported",
      reason: "Rectangle resize cannot target shared coordinate spans."
    };
  }

  if (!transformsApproximatelyEqual(startHandle.transform, oppositeHandle.transform)) {
    return {
      kind: "unsupported",
      reason: "Rectangle resize requires matching coordinate transforms."
    };
  }

  return {
    kind: "found",
    startHandle,
    oppositeHandle
  };
}

function resolveScenePathShapeHint(
  path: ScenePath,
  pathStatement: Extract<Statement, { kind: "Path" }>
): ScenePathShapeHint | null {
  return path.shapeHint ?? resolvePathShapeHintFromItems(pathStatement.items);
}

function resolvePathShapeHintFromItems(items: readonly PathItem[]): ScenePathShapeHint | null {
  const hints = new Set<ScenePathShapeHint>();
  collectPathShapeHints(items, hints);
  if (hints.size !== 1) {
    return null;
  }
  return [...hints][0] ?? null;
}

function collectPathShapeHints(items: readonly PathItem[], hints: Set<ScenePathShapeHint>): void {
  for (const item of items) {
    if (item.kind === "PathKeyword") {
      if (item.keyword === "rectangle") {
        hints.add("rectangle");
      } else if (item.keyword === "circle") {
        hints.add("circle");
      } else if (item.keyword === "ellipse") {
        hints.add("ellipse");
      }
      continue;
    }
    if (item.kind === "ChildOperation") {
      collectPathShapeHints(item.body, hints);
    }
  }
}

function applyResizePathCircleOrEllipse(
  source: string,
  action: Extract<EditAction, { kind: "resizeElement" }>,
  statements: readonly Statement[],
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[]
): EditActionResult {
  const elementId = action.elementId.trim();
  const context = resolvePathShapeResizeContext(statements, elements, editHandles, elementId);
  if (context.kind === "unsupported") {
    return context;
  }

  const affectsWidth = action.role.includes("left") || action.role.includes("right");
  const affectsHeight = action.role.includes("top") || action.role.includes("bottom");
  if (!affectsWidth && !affectsHeight) {
    return { kind: "unsupported", reason: `Unsupported resize role: ${action.role}` };
  }

  const localPointer = worldToLocal(action.newWorld, context.centerHandle.transform);
  const localCenter =
    context.centerHandle.local ?? worldToLocal(context.center, context.centerHandle.transform);
  if (!localPointer || !localCenter) {
    return { kind: "unsupported", reason: "Could not resolve local geometry for circle/ellipse resize." };
  }

  const localDx = Math.abs(localPointer.x - localCenter.x);
  const localDy = Math.abs(localPointer.y - localCenter.y);
  const currentLocalRadii = resolveCurrentLocalShapeRadii(context.syntax);
  if ((!affectsWidth || !affectsHeight) && !currentLocalRadii) {
    return { kind: "unsupported", reason: "Resize requires explicit circle/ellipse radii for single-axis drags." };
  }

  let nextRxLocal = affectsWidth ? localDx : (currentLocalRadii?.rx ?? localDx);
  let nextRyLocal = affectsHeight ? localDy : (currentLocalRadii?.ry ?? localDy);
  if (context.shapeKind === "circle") {
    const currentRadius = currentLocalRadii?.rx ?? Math.max(nextRxLocal, nextRyLocal);
    const nextRadius = Math.max(
      affectsWidth ? localDx : currentRadius,
      affectsHeight ? localDy : currentRadius
    );
    nextRxLocal = nextRadius;
    nextRyLocal = nextRadius;
  } else if (context.shapeKind === "ellipse" && action.preserveAspect) {
    const fallbackAspectRatio =
      currentLocalRadii && currentLocalRadii.rx > RESIZE_EPSILON && currentLocalRadii.ry > RESIZE_EPSILON
        ? currentLocalRadii.ry / currentLocalRadii.rx
        : null;
    const fixedAspectRatio =
      Number.isFinite(action.preserveAspectRatio) && (action.preserveAspectRatio ?? 0) > RESIZE_EPSILON
        ? action.preserveAspectRatio!
        : fallbackAspectRatio;
    if (!fixedAspectRatio || fixedAspectRatio <= RESIZE_EPSILON) {
      return { kind: "unsupported", reason: "Resize requires explicit ellipse radii to preserve aspect ratio." };
    }

    if (affectsWidth && affectsHeight) {
      nextRxLocal = Math.max(localDx, localDy / fixedAspectRatio);
      nextRyLocal = nextRxLocal * fixedAspectRatio;
    } else if (affectsWidth) {
      nextRxLocal = localDx;
      nextRyLocal = nextRxLocal * fixedAspectRatio;
    } else {
      nextRyLocal = localDy;
      nextRxLocal = nextRyLocal / fixedAspectRatio;
    }
  }

  nextRxLocal = Math.max(nextRxLocal, RESIZE_EPSILON);
  nextRyLocal = Math.max(nextRyLocal, RESIZE_EPSILON);

  const payloadRewrite = rewriteShapePayloadCoordinate(context.syntax, nextRxLocal, nextRyLocal);
  if (payloadRewrite) {
    const rewritten = applySpanTextReplacement(source, payloadRewrite.span, payloadRewrite.text);
    if (!rewritten) {
      return { kind: "unsupported", reason: "Resize would not change node constraints." };
    }
    return {
      kind: "success",
      newSource: rewritten.source,
      patches: [rewritten.patch]
    };
  }

  const radiusMutations = buildShapeRadiusMutations(context, nextRxLocal, nextRyLocal);
  const optionTarget = pickPathShapeResizeOptionTarget(context.syntax.optionItems);
  if (optionTarget) {
    const replacement = rewriteOptionListMutations(optionTarget.options, radiusMutations);
    const rewritten = applySpanTextReplacement(source, optionTarget.span, replacement);
    if (!rewritten) {
      return { kind: "unsupported", reason: "Resize would not change node constraints." };
    }
    return {
      kind: "success",
      newSource: rewritten.source,
      patches: [rewritten.patch]
    };
  }

  const entries: string[] = [];
  for (const [key, mutation] of radiusMutations.entries()) {
    if (mutation.kind === "set") {
      entries.push(serializeOptionEntry(key, mutation.value));
    }
  }
  if (entries.length === 0) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  const inserted = `[${entries.join(", ")}]`;
  const rewritten = applySpanTextReplacement(source, {
    from: context.syntax.keywordSpan.to,
    to: context.syntax.keywordSpan.to
  }, inserted);
  if (!rewritten) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch]
  };
}

function resolvePathShapeResizeContext(
  statements: readonly Statement[],
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  elementId: string
): PathShapeResizeContext | { kind: "unsupported"; reason: string } {
  const pathStatement = findPathStatementById(statements, elementId);
  if (!pathStatement) {
    return { kind: "unsupported", reason: "resizeElement currently supports only node-like or shape-path elements." };
  }

  const sourceElements = elements.filter((element) => element.sourceId === elementId);
  const nonTextElements = sourceElements.filter((element) => element.kind !== "Text");
  const explicitShapeElements = nonTextElements.filter(
    (element): element is SceneCircle | SceneEllipse => element.kind === "Circle" || element.kind === "Ellipse"
  );

  let shapeKind: "circle" | "ellipse" | null = null;
  let center: Point | null = null;
  let requireSingleCenterHandle = false;

  if (explicitShapeElements.length === 1 && nonTextElements.length === 1) {
    const explicitShape = explicitShapeElements[0]!;
    shapeKind = explicitShape.kind === "Circle" ? "circle" : "ellipse";
    center = explicitShape.center;
  } else if (explicitShapeElements.length === 0 && nonTextElements.length === 1 && nonTextElements[0]?.kind === "Path") {
    const pathElement = nonTextElements[0];
    const hint = resolveScenePathShapeHint(pathElement, pathStatement);
    if (hint === "circle" || hint === "ellipse") {
      shapeKind = hint;
      requireSingleCenterHandle = true;
    }
  }

  if (!shapeKind) {
    return { kind: "unsupported", reason: "Resize supports exactly one circle/ellipse primitive per statement." };
  }

  const syntax = resolvePathShapeResizeSyntax(pathStatement.items);
  if (!syntax) {
    return { kind: "unsupported", reason: "Could not resolve editable circle/ellipse source syntax." };
  }

  const candidateHandles = editHandles.filter(
    (handle) => handle.sourceId === elementId && handle.kind === "path-point"
  );
  if (candidateHandles.length === 0) {
    return { kind: "unsupported", reason: "No editable center handle was found for this circle/ellipse." };
  }
  if (requireSingleCenterHandle && candidateHandles.length !== 1) {
    return { kind: "unsupported", reason: "Resize requires circle/ellipse paths with explicit center coordinates." };
  }

  let centerHandle = candidateHandles[0]!;
  if (center) {
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const handle of candidateHandles) {
      const dx = handle.world.x - center.x;
      const dy = handle.world.y - center.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        centerHandle = handle;
      }
    }
  }

  return {
    kind: "found",
    shapeKind,
    center: center ?? centerHandle.world,
    syntax,
    centerHandle
  };
}

function resolvePathShapeResizeSyntax(items: readonly PathItem[]): PathShapeResizeSyntax | null {
  const keywordItems = items.filter(
    (item): item is Extract<PathItem, { kind: "PathKeyword" }> =>
      item.kind === "PathKeyword" && (item.keyword === "circle" || item.keyword === "ellipse")
  );
  if (keywordItems.length !== 1) {
    return null;
  }
  const keywordItem = keywordItems[0]!;
  const keywordIndex = items.findIndex((item) => item.id === keywordItem.id);
  if (keywordIndex < 0) {
    return null;
  }

  const optionItems: PathOptionItem[] = [];
  let payloadCoordinate: CoordinateItem | null = null;
  for (let index = keywordIndex + 1; index < items.length; index += 1) {
    const next = items[index];
    if (!next || next.kind === "PathComment") {
      continue;
    }
    if (next.kind === "PathOption" && !payloadCoordinate) {
      optionItems.push(next);
      continue;
    }
    if (next.kind === "Coordinate" && !payloadCoordinate) {
      const parsed =
        keywordItem.keyword === "circle"
          ? parseCircleRadiusFromCoordinateRaw(next.raw) != null
          : parseEllipseRadiiFromCoordinateRaw(next.raw) != null;
      if (parsed) {
        payloadCoordinate = next;
      }
      break;
    }
    break;
  }

  return {
    keyword: keywordItem.keyword === "ellipse" ? "ellipse" : "circle",
    keywordSpan: keywordItem.span,
    optionItems,
    payloadCoordinate
  };
}

function resolveCurrentLocalShapeRadii(
  syntax: PathShapeResizeSyntax
): { rx: number; ry: number } | null {
  const payload = syntax.payloadCoordinate;
  if (payload) {
    if (syntax.keyword === "circle") {
      const radius = parseCircleRadiusFromCoordinateRaw(payload.raw);
      if (radius != null) {
        return { rx: radius, ry: radius };
      }
    } else {
      const radii = parseEllipseRadiiFromCoordinateRaw(payload.raw);
      if (radii) {
        return radii;
      }
    }
  }

  if (syntax.keyword === "circle") {
    let radius: number | null = null;
    let radii: { rx: number; ry: number } | null = null;
    for (const item of syntax.optionItems) {
      const parsed = parseCircleRadiiFromOptionItem(item);
      if (parsed.kind === "radius") {
        radius = parsed.radius;
        radii = null;
      } else if (parsed.kind === "radii") {
        radius = null;
        radii = { rx: parsed.rx, ry: parsed.ry };
      }
    }
    if (radius != null) {
      return { rx: radius, ry: radius };
    }
    return radii;
  }

  let radii: { rx: number; ry: number } | null = null;
  for (const item of syntax.optionItems) {
    const parsed = parseEllipseRadiiFromOptionItem(item);
    if (parsed) {
      radii = parsed;
    }
  }
  return radii;
}

function parseCircleRadiiFromOptionItem(
  item: PathOptionItem
): { kind: "none" } | { kind: "radius"; radius: number } | { kind: "radii"; rx: number; ry: number } {
  let radius: number | null = null;
  let rx: number | null = null;
  let ry: number | null = null;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "radius") {
      radius = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "x radius") {
      rx = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "y radius") {
      ry = parseLength(entry.valueRaw, "cm");
    }
  }

  if (radius != null) {
    return { kind: "radius", radius };
  }
  if (rx != null && ry != null) {
    return { kind: "radii", rx, ry };
  }
  return { kind: "none" };
}

function parseEllipseRadiiFromOptionItem(item: PathOptionItem): { rx: number; ry: number } | null {
  let rx: number | null = null;
  let ry: number | null = null;
  let radius: number | null = null;
  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "x radius") {
      rx = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "y radius") {
      ry = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "radius") {
      radius = parseLength(entry.valueRaw, "cm");
    }
  }
  if (radius != null) {
    return { rx: radius, ry: radius };
  }
  if (rx != null && ry != null) {
    return { rx, ry };
  }
  return null;
}

function rewriteShapePayloadCoordinate(
  syntax: PathShapeResizeSyntax,
  nextRxLocal: number,
  nextRyLocal: number
): { span: Span; text: string } | null {
  if (!syntax.payloadCoordinate) {
    return null;
  }

  if (syntax.keyword === "circle") {
    if (parseCircleRadiusFromCoordinateRaw(syntax.payloadCoordinate.raw) == null) {
      return null;
    }
    return {
      span: syntax.payloadCoordinate.span,
      text: formatCircleRadiusCoordinateRaw(syntax.payloadCoordinate.raw, nextRxLocal)
    };
  }

  if (parseEllipseRadiiFromCoordinateRaw(syntax.payloadCoordinate.raw) == null) {
    return null;
  }
  return {
    span: syntax.payloadCoordinate.span,
    text: formatEllipseRadiiCoordinateRaw(syntax.payloadCoordinate.raw, nextRxLocal, nextRyLocal)
  };
}

function formatCircleRadiusCoordinateRaw(oldRaw: string, radiusPt: number): string {
  const value = `${formatNumber(radiusPt * CM_PER_PT)}cm`;
  const exact = oldRaw.match(/^\((\s*)([^)]*)(\s*)\)$/s);
  if (exact) {
    return `(${exact[1]}${value}${exact[3]})`;
  }
  return `(${value})`;
}

function formatEllipseRadiiCoordinateRaw(oldRaw: string, rxPt: number, ryPt: number): string {
  const rx = `${formatNumber(rxPt * CM_PER_PT)}cm`;
  const ry = `${formatNumber(ryPt * CM_PER_PT)}cm`;
  const exact = oldRaw.match(/^\((\s*)([^)]*?)(\s+and\s+)([^)]*?)(\s*)\)$/is);
  if (exact) {
    return `(${exact[1]}${rx}${exact[3]}${ry}${exact[5]})`;
  }
  return `(${rx} and ${ry})`;
}

function buildShapeRadiusMutations(
  context: PathShapeResizeContext,
  nextRxLocal: number,
  nextRyLocal: number
): Map<string, OptionMutation> {
  const mutations = new Map<string, OptionMutation>();
  if (context.shapeKind === "circle") {
    const radiusValue = `${formatNumber(nextRxLocal * CM_PER_PT)}cm`;
    mutations.set("radius", { kind: "set", value: radiusValue });
    mutations.set("x radius", { kind: "remove" });
    mutations.set("y radius", { kind: "remove" });
    return mutations;
  }

  mutations.set("x radius", { kind: "set", value: `${formatNumber(nextRxLocal * CM_PER_PT)}cm` });
  mutations.set("y radius", { kind: "set", value: `${formatNumber(nextRyLocal * CM_PER_PT)}cm` });
  mutations.set("radius", { kind: "remove" });
  return mutations;
}

function pickPathShapeResizeOptionTarget(
  optionItems: readonly PathOptionItem[]
): PathOptionItem | null {
  if (optionItems.length === 0) {
    return null;
  }
  for (let index = optionItems.length - 1; index >= 0; index -= 1) {
    const item = optionItems[index];
    if (!item) {
      continue;
    }
    const hasRadiusEntry = item.options.entries.some(
      (entry) =>
        entry.kind === "kv" &&
        (entry.key === "radius" || entry.key === "x radius" || entry.key === "y radius")
    );
    if (hasRadiusEntry) {
      return item;
    }
  }
  return optionItems[optionItems.length - 1] ?? null;
}

function applySpanTextReplacement(
  source: string,
  span: Span,
  replacement: string
): OptionMutationApplyResult | null {
  const previous = source.slice(span.from, span.to);
  if (previous === replacement) {
    return null;
  }
  const updated = replaceSpan(source, span, replacement);
  return {
    source: updated.source,
    patch: {
      oldSpan: span,
      newSpan: updated.changedSpan,
      replacement
    }
  };
}

function resolveRectangleRoleCorners(
  startLocal: Point,
  oppositeLocal: Point
): Record<RectangleCornerRole, Point> {
  const minX = Math.min(startLocal.x, oppositeLocal.x);
  const maxX = Math.max(startLocal.x, oppositeLocal.x);
  const minY = Math.min(startLocal.y, oppositeLocal.y);
  const maxY = Math.max(startLocal.y, oppositeLocal.y);

  return {
    "top-left": { x: minX, y: maxY },
    "top-right": { x: maxX, y: maxY },
    "bottom-left": { x: minX, y: minY },
    "bottom-right": { x: maxX, y: minY }
  };
}

function isRectangleCornerRole(role: ResizeRole): role is RectangleCornerRole {
  return role === "top-left" || role === "top-right" || role === "bottom-left" || role === "bottom-right";
}

function oppositeRectangleCornerRole(role: RectangleCornerRole): RectangleCornerRole {
  switch (role) {
    case "top-left":
      return "bottom-right";
    case "top-right":
      return "bottom-left";
    case "bottom-left":
      return "top-right";
    case "bottom-right":
      return "top-left";
  }
}

function pointDistanceSquared(left: Point, right: Point): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function resolveNodeResizeRotationDegrees(elements: readonly SceneElement[], sourceId: string): number {
  const sourceElements = elements.filter((element) => element.sourceId === sourceId);
  const textElements = sourceElements.filter(
    (element): element is Extract<SceneElement, { kind: "Text" }> => element.kind === "Text"
  );
  if (textElements.length === 1) {
    return normalizeDegrees(textElements[0]?.rotation ?? 0);
  }

  const ellipseElements = sourceElements.filter(
    (element): element is Extract<SceneElement, { kind: "Ellipse" }> => element.kind === "Ellipse"
  );
  if (ellipseElements.length === 1) {
    return normalizeDegrees(ellipseElements[0]?.rotation ?? 0);
  }

  return 0;
}

function rotateVector(vector: Point, degrees: number): Point {
  if (Math.abs(degrees) <= 1e-9) {
    return vector;
  }
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos
  };
}

function normalizeDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) {
    return 0;
  }
  const normalized = ((degrees % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

function transformsApproximatelyEqual(
  left: EditHandle["transform"],
  right: EditHandle["transform"],
  epsilon = 1e-9
): boolean {
  return (
    Math.abs(left.a - right.a) <= epsilon &&
    Math.abs(left.b - right.b) <= epsilon &&
    Math.abs(left.c - right.c) <= epsilon &&
    Math.abs(left.d - right.d) <= epsilon &&
    Math.abs(left.e - right.e) <= epsilon &&
    Math.abs(left.f - right.f) <= epsilon
  );
}

function resolveResizePropertyTarget(
  source: string,
  statements: readonly Statement[],
  elementId: string,
  defaultTarget: PropertyTarget
): PropertyTarget {
  if (defaultTarget.kind !== "path-statement") {
    return defaultTarget;
  }

  const pathStatement = findPathStatementById(statements, elementId);
  if (!pathStatement) {
    return defaultTarget;
  }

  const nodeIds = collectPathNodeIds(pathStatement.items);
  if (nodeIds.length !== 1) {
    return defaultTarget;
  }

  const nodeTarget = resolvePropertyTarget(source, nodeIds[0]!);
  if (nodeTarget.kind === "found") {
    return nodeTarget.target;
  }

  return defaultTarget;
}

function findPathStatementById(
  statements: readonly Statement[],
  elementId: string
): Extract<Statement, { kind: "Path" }> | null {
  for (const statement of statements) {
    if (statement.kind === "Path" && statement.id === elementId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, elementId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function collectPathNodeIds(items: readonly PathItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.kind === "Node") {
      ids.push(item.id);
      continue;
    }

    if (
      (item.kind === "ToOperation" || item.kind === "EdgeOperation" || item.kind === "EdgeFromParentOperation") &&
      item.nodes
    ) {
      ids.push(...item.nodes.map((node) => node.id));
      continue;
    }

    if (item.kind === "ChildOperation") {
      ids.push(...collectPathNodeIds(item.body));
    }
  }

  return [...new Set(ids)];
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
