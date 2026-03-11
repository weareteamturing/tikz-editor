import type { CoordinateItem, NodeItem, PathStatement, Span, Statement } from "../../ast/types.js";
import type { OptionEntry } from "../../options/types.js";
import { parseTikz } from "../../parser/index.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import type { EditHandle, Point } from "../../semantic/types.js";
import { collectSourceWorldBounds } from "../snapping/index.js";
import { localToSourceUnits, worldToLocal } from "../coords.js";
import { CM_PER_PT, formatNumber } from "../format.js";
import { replaceSpan } from "../patch.js";
import { resolvePropertyTarget } from "../property-target.js";
import { rewriteCoordinate } from "../rewrite.js";
import type { SourcePatch } from "../types.js";
import { planAlignDeltas, planDistributeDeltas, type AlignMode, type DistributeAxis } from "../arrange.js";
import { applyOptionMutationsToTarget, type OptionMutation } from "../option-mutations.js";

const ARRANGE_EPSILON = 1e-6;

type EditActionResultLike =
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

export type AlignElementsAction = { elementIds: string[]; mode: AlignMode };
export type DistributeElementsAction = { elementIds: string[]; axis: DistributeAxis };

export function applyMoveElementsAction(
  source: string,
  editHandles: EditHandle[],
  elementIds: readonly string[],
  delta: Point
): EditActionResultLike {
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
    if (handle.kind !== "node-position" || !matrixElementIdSet.has(handle.sourceRef.sourceId)) {
      continue;
    }
    if (!matrixPlacementHandlesBySource.has(handle.sourceRef.sourceId)) {
      matrixPlacementHandlesBySource.set(handle.sourceRef.sourceId, handle);
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

export function applyAlignElementsAction(
  source: string,
  action: AlignElementsAction
): EditActionResultLike {
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

export function applyDistributeElementsAction(
  source: string,
  action: DistributeElementsAction
): EditActionResultLike {
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

function applyMoveElementsUsingHandleRewrites(
  source: string,
  editHandles: EditHandle[],
  elementIds: readonly string[],
  delta: Point
): EditActionResultLike {
  const sourceIdSet = new Set(elementIds);
  const elementHandles = editHandles.filter((handle) => sourceIdSet.has(handle.sourceRef.sourceId));

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
    const actualText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
    if (actualText !== handle.sourceText) {
      skippedHandles.push(handle.id);
      continue;
    }

    const newWorld: Point = { x: handle.world.x + delta.x, y: handle.world.y + delta.y };
    const text = rewriteCoordinate(newWorld, handle, source);
    if (text != null) {
      pending.push({ span: handle.sourceRef.sourceSpan, text });
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
): EditActionResultLike {
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

function applyElementDeltaMapStrict(
  source: string,
  editHandles: EditHandle[],
  elementIds: readonly string[],
  deltasBySource: ReadonlyMap<string, Point>
): EditActionResultLike {
  const normalizedIds = normalizeElementIds(elementIds);
  if (normalizedIds.length === 0) {
    return { kind: "unsupported", reason: "No element ids were provided for arrange operation." };
  }

  const sourceIdSet = new Set(normalizedIds);
  const selectedHandles = editHandles.filter((handle) => sourceIdSet.has(handle.sourceRef.sourceId));
  if (selectedHandles.length === 0) {
    return { kind: "unsupported", reason: "No handles found for the selected element(s)." };
  }

  const handlesBySource = new Map<string, EditHandle[]>();
  for (const handle of selectedHandles) {
    const existing = handlesBySource.get(handle.sourceRef.sourceId);
    if (existing) {
      existing.push(handle);
    } else {
      handlesBySource.set(handle.sourceRef.sourceId, [handle]);
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
    const delta = deltasBySource.get(handle.sourceRef.sourceId) ?? { x: 0, y: 0 };
    if (Math.abs(delta.x) <= ARRANGE_EPSILON && Math.abs(delta.y) <= ARRANGE_EPSILON) {
      continue;
    }

    const actualText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
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

    const spanKey = `${handle.sourceRef.sourceSpan.from}:${handle.sourceRef.sourceSpan.to}`;
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
    pending.push({ span: handle.sourceRef.sourceSpan, text });
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

function normalizeElementIds(elementIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const elementId of elementIds) {
    if (typeof elementId !== "string") {
      continue;
    }
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
