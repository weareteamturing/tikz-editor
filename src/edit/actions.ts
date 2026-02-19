import type { EditHandle, Point } from "../semantic/types.js";
import type { PathItem, Statement, Span } from "../ast/types.js";
import type { SourcePatch } from "./types.js";
import { applyEditIntent } from "./apply.js";
import { rewriteCoordinate } from "./rewrite.js";
import { replaceSpan } from "./patch.js";
import {
  generateElementSource,
  insertElementIntoSource,
  type ElementTemplate
} from "./element-templates.js";
import type { OptionEntry, OptionListAst } from "../options/types.js";
import { resolvePropertyTarget } from "./property-target.js";
import { parseTikz } from "../parser/index.js";

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

export type EditAction =
  | { kind: "moveElement"; elementId: string; delta: Point }
  | { kind: "moveElements"; elementIds: string[]; delta: Point }
  | { kind: "moveHandle"; handleId: string; newWorld: Point }
  | { kind: "setProperty"; elementId: string; level: StyleLevel; key: string; value: string }
  | { kind: "addElement"; template: ElementTemplate; at: Point }
  | { kind: "deleteElement"; elementId: string }
  | { kind: "deleteElements"; elementIds: string[] }
  | { kind: "resizeElement"; elementId: string; role: ResizeRole; newWorld: Point };

export type EditActionResult =
  | { kind: "success"; newSource: string; patches: SourcePatch[] }
  | {
      kind: "partial";
      newSource: string;
      patches: SourcePatch[];
      skippedHandles: string[];
      reason: string;
    }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

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
    case "setProperty":
      return applySetProperty(source, action);
    case "addElement":
      return applyAddElement(source, action.template, action.at);
    case "deleteElement":
      return applyDeleteElements(source, [action.elementId]);
    case "deleteElements":
      return applyDeleteElements(source, action.elementIds);
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
