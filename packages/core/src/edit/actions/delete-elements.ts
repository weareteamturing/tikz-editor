import type { PathItem, Span, Statement } from "../../ast/types.js";
import { replaceSpan } from "../patch.js";
import { resolvePropertyTarget } from "../property-target.js";
import type { SourcePatch } from "../types.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";

type EditActionResultLike =
  | { kind: "success"; newSource: string; patches: SourcePatch[]; selectedSourceIds?: string[]; changedSourceIds?: string[] }
  | { kind: "unsupported"; reason: string };

type DeleteTarget = {
  span: Span;
  scope: "statement" | "path-item";
};

export function applyDeleteElementsAction(
  source: string,
  elementIds: readonly string[],
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const normalizedIds = normalizeElementIds(elementIds);
  if (normalizedIds.length === 0) {
    return { kind: "unsupported", reason: "No element ids were provided for deleteElements" };
  }

  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
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
    patches,
    selectedSourceIds: []
  };
}

export function applyDeleteAdornmentAction(
  source: string,
  targetId: string,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const resolved = resolvePropertyTarget(source, targetId, parseOptions);
  if (resolved.kind !== "found" || resolved.target.kind !== "node-adornment" || !resolved.target.optionSpan) {
    return { kind: "unsupported", reason: "Selected adornment could not be resolved for deletion." };
  }

  const deleteSpan = normalizeAdornmentDeleteSpan(source, resolved.target.optionSpan);
  const updated = replaceSpan(source, deleteSpan, "");
  return {
    kind: "success",
    newSource: updated.source,
    selectedSourceIds: [],
    patches: [
      {
        oldSpan: deleteSpan,
        newSpan: updated.changedSpan,
        replacement: ""
      }
    ],
    changedSourceIds: [resolved.target.ownerSourceId ?? resolved.target.ownerId ?? targetId]
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

function normalizeAdornmentDeleteSpan(source: string, span: Span): Span {
  let from = span.from;
  let to = span.to;

  while (to < source.length && /\s/u.test(source[to] ?? "")) {
    to += 1;
  }
  if ((source[to] ?? "") === ",") {
    to += 1;
    while (to < source.length && /\s/u.test(source[to] ?? "")) {
      to += 1;
    }
    return { from, to };
  }

  while (from > 0 && /\s/u.test(source[from - 1] ?? "")) {
    from -= 1;
  }
  if ((source[from - 1] ?? "") === ",") {
    from -= 1;
    while (from > 0 && /\s/u.test(source[from - 1] ?? "")) {
      from -= 1;
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
