import { parseOptionListRaw } from "../../options/parse.js";
import { applyOptionMutationsToTarget, normalizeOptionKey, rewriteOptionListMutations, type OptionMutation } from "../option-mutations.js";
import { MATRIX_CELL_WRITABLE_KEYS } from "../matrix-editing.js";
import { TREE_CHILD_LAYOUT_WRITABLE_KEYS, TREE_CHILD_NODE_READONLY_KEYS } from "../tree-editing.js";
import { resolvePropertyTarget } from "../property-target.js";
import type { PropertyTarget } from "../property-target.js";
import { replaceSpan } from "../patch.js";
import type { Span } from "../../ast/types.js";
import type { SourcePatch } from "../types.js";
import { applyAdornmentSetProperty } from "./adornment-set-property.js";
import type { EditParseOptions } from "../parse-options.js";

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

export type SetPropertyAction = {
  elementId: string;
  key: string;
  value: string;
  clearKeys?: string[];
};

export function applySetPropertyAction(
  source: string,
  action: SetPropertyAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const resolved = resolvePropertyTarget(source, action.elementId, parseOptions);
  if (resolved.kind === "not-found") {
    return { kind: "unsupported", reason: resolved.reason };
  }

  if (resolved.target.kind === "node-adornment") {
    return applyAdornmentSetProperty(source, resolved.target, action as any);
  }

  if (resolved.target.kind === "tree-child") {
    return applyTreeChildSetProperty(source, resolved.target, action);
  }

  if (resolved.target.kind === "matrix-cell") {
    return applyMatrixCellSetProperty(source, resolved.target, action);
  }

  const key = normalizeOptionKey(action.key);
  if (key.length === 0) {
    return { kind: "error", message: "Cannot set an empty option key" };
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

function applyTreeChildSetProperty(
  source: string,
  target: PropertyTarget,
  action: SetPropertyAction
): EditActionResultLike {
  if (target.treeChildForeach) {
    return { kind: "unsupported", reason: "Tree child property editing is read-only for child foreach expansions." };
  }

  const key = normalizeOptionKey(action.key);
  if (key.length === 0) {
    return { kind: "error", message: "Cannot set an empty option key" };
  }
  const childOptionSite = key.length > 0 && TREE_CHILD_LAYOUT_WRITABLE_KEYS.has(key);
  const nodeOptionSite = key.length > 0 && !childOptionSite;
  if (!childOptionSite && !nodeOptionSite) {
    return { kind: "unsupported", reason: `Tree child property '${action.key}' is not editable yet.` };
  }
  if (TREE_CHILD_NODE_READONLY_KEYS.has(key)) {
    return { kind: "unsupported", reason: `Tree child property '${action.key}' is read-only.` };
  }

  const mutations = createOptionMutationsFromSetProperty(action, key);
  const removePrimaryKey = action.value.trim().length === 0;

  if (childOptionSite) {
    const result = applyOptionMutationsAtSite(source, mutations, removePrimaryKey, {
      options: target.treeChildOptions,
      optionsSpan: target.treeChildOptionsSpan,
      insertOffset: target.treeChildInsertOffset
    });
    return addTreeChildFallbackWarningIfNeeded(result, target);
  }

  const result = applyOptionMutationsAtSite(source, mutations, removePrimaryKey, {
    options: target.treeNodeOptions,
    optionsSpan: target.treeNodeOptionsSpan,
    insertOffset: target.treeNodeInsertOffset
  });
  return addTreeChildFallbackWarningIfNeeded(result, target);
}

function addTreeChildFallbackWarningIfNeeded(
  result: EditActionResultLike,
  target: PropertyTarget
): EditActionResultLike {
  if (!target.treeChildNodeSpanFallbackUsed || (result.kind !== "success" && result.kind !== "partial")) {
    return result;
  }
  return {
    kind: "partial",
    newSource: result.newSource,
    patches: result.patches,
    skippedHandles: [],
    reason: "Tree child edit applied using a source-span fallback. Verify the updated source."
  };
}

function applyMatrixCellSetProperty(
  source: string,
  target: PropertyTarget,
  action: SetPropertyAction
): EditActionResultLike {
  if (!target.matrixOfNodes) {
    return { kind: "unsupported", reason: "Cell property editing is only available for matrix node cells." };
  }

  const key = normalizeOptionKey(action.key);
  if (!MATRIX_CELL_WRITABLE_KEYS.has(key)) {
    return { kind: "unsupported", reason: `Matrix cell property '${action.key}' is not editable yet.` };
  }

  const normalizedValue = action.value.trim();
  const removePrimaryKey = normalizedValue.length === 0;
  const mutations = createOptionMutationsFromSetProperty(action, key);

  const cellSpan = target.cellSpan;
  const textSpan = target.textSpan;
  if (!cellSpan || !textSpan) {
    return { kind: "unsupported", reason: "Matrix cell source spans are unavailable." };
  }

  if (target.optionSpan) {
    const optionSpan = target.optionSpan;
    const currentOptions = parseOptionListRaw(source.slice(optionSpan.from, optionSpan.to), optionSpan.from);
    const replacement = rewriteOptionListMutations(currentOptions, mutations, undefined, "bracketed");
    if (replacement.length > 0) {
      if (source.slice(optionSpan.from, optionSpan.to) === replacement) {
        return { kind: "unsupported", reason: "setProperty would not change the source." };
      }
      const updated = replaceSpan(source, optionSpan, replacement);
      return {
        kind: "success",
        newSource: updated.source,
        patches: [{ oldSpan: optionSpan, newSpan: updated.changedSpan, replacement }]
      };
    }

    const prefixSpan = resolveMatrixCellOptionPrefixSpan(source, optionSpan, cellSpan, textSpan);
    if (!prefixSpan) {
      return { kind: "unsupported", reason: "Could not remove matrix-cell option prefix safely." };
    }
    const updated = replaceSpan(source, prefixSpan, "");
    if (updated.source === source) {
      return { kind: "unsupported", reason: "setProperty would not change the source." };
    }
    return {
      kind: "success",
      newSource: updated.source,
      patches: [{ oldSpan: prefixSpan, newSpan: updated.changedSpan, replacement: "" }]
    };
  }

  const setMutations = new Map<string, OptionMutation>();
  for (const [mutationKey, mutation] of mutations.entries()) {
    if (mutation.kind === "set") {
      setMutations.set(mutationKey, mutation);
    }
  }
  if (setMutations.size === 0) {
    return { kind: "unsupported", reason: "setProperty would not change the source." };
  }

  const seedOptions = parseOptionListRaw("[]", textSpan.from);
  const serializedOptions = rewriteOptionListMutations(seedOptions, setMutations, undefined, "bracketed");
  if (serializedOptions.length === 0) {
    return { kind: "unsupported", reason: "setProperty would not change the source." };
  }
  const insertion = `|${serializedOptions}| `;
  const insertionSpan: Span = { from: textSpan.from, to: textSpan.from };
  const updated = replaceSpan(source, insertionSpan, insertion);
  if (updated.source === source) {
    return { kind: "unsupported", reason: "setProperty would not change the source." };
  }
  return {
    kind: "success",
    newSource: updated.source,
    patches: [{ oldSpan: insertionSpan, newSpan: updated.changedSpan, replacement: insertion }]
  };
}

function createOptionMutationsFromSetProperty(
  action: SetPropertyAction,
  normalizedPrimaryKey: string
): Map<string, OptionMutation> {
  const normalizedValue = action.value.trim();
  const removePrimaryKey = normalizedValue.length === 0;
  const mutations = new Map<string, OptionMutation>();
  for (const rawClearKey of action.clearKeys ?? []) {
    const clearKey = normalizeOptionKey(rawClearKey);
    if (clearKey.length === 0) {
      continue;
    }
    if (clearKey === normalizedPrimaryKey && !removePrimaryKey) {
      continue;
    }
    mutations.set(clearKey, { kind: "remove" });
  }
  if (removePrimaryKey) {
    mutations.set(normalizedPrimaryKey, { kind: "remove" });
  } else {
    mutations.set(normalizedPrimaryKey, { kind: "set", value: action.value });
  }
  return mutations;
}

function applyOptionMutationsAtSite(
  source: string,
  mutations: Map<string, OptionMutation>,
  removePrimaryKey: boolean,
  site: {
    options?: PropertyTarget["options"];
    optionsSpan?: Span;
    insertOffset?: number;
  }
): EditActionResultLike {
  const { options, optionsSpan, insertOffset } = site;
  if (optionsSpan) {
    const parsedOptions = options ?? parseOptionListRaw(source.slice(optionsSpan.from, optionsSpan.to), optionsSpan.from);
    const replacement = rewriteOptionListMutations(parsedOptions, mutations, undefined, "bracketed");
    if (source.slice(optionsSpan.from, optionsSpan.to) === replacement) {
      return { kind: "unsupported", reason: "setProperty would not change the source." };
    }
    const updated = replaceSpan(source, optionsSpan, replacement);
    return {
      kind: "success",
      newSource: updated.source,
      patches: [{ oldSpan: optionsSpan, newSpan: updated.changedSpan, replacement }]
    };
  }

  if (insertOffset == null) {
    return { kind: "unsupported", reason: "No writable option site available for this target." };
  }

  if (removePrimaryKey) {
    return { kind: "unsupported", reason: "setProperty would not change the source." };
  }

  const setMutations = new Map<string, OptionMutation>();
  for (const [mutationKey, mutation] of mutations.entries()) {
    if (mutation.kind === "set") {
      setMutations.set(mutationKey, mutation);
    }
  }
  if (setMutations.size === 0) {
    return { kind: "unsupported", reason: "setProperty would not change the source." };
  }

  const seedOptions = parseOptionListRaw("[]", insertOffset);
  const serializedOptions = rewriteOptionListMutations(seedOptions, setMutations, undefined, "bracketed");
  if (serializedOptions.length === 0) {
    return { kind: "unsupported", reason: "setProperty would not change the source." };
  }
  const updated = replaceSpan(source, { from: insertOffset, to: insertOffset }, serializedOptions);
  return {
    kind: "success",
    newSource: updated.source,
    patches: [{ oldSpan: { from: insertOffset, to: insertOffset }, newSpan: updated.changedSpan, replacement: serializedOptions }]
  };
}

function resolveMatrixCellOptionPrefixSpan(
  source: string,
  optionSpan: Span,
  cellSpan: Span,
  textSpan: Span
): Span | null {
  let leftPipe = optionSpan.from - 1;
  while (leftPipe >= cellSpan.from && /\s/u.test(source[leftPipe] ?? "")) {
    leftPipe -= 1;
  }
  if (leftPipe < cellSpan.from || source[leftPipe] !== "|") {
    return null;
  }

  let rightPipe = optionSpan.to;
  while (rightPipe < cellSpan.to && /\s/u.test(source[rightPipe] ?? "")) {
    rightPipe += 1;
  }
  if (rightPipe >= cellSpan.to || source[rightPipe] !== "|") {
    return null;
  }

  let removalTo = rightPipe + 1;
  while (removalTo < textSpan.from && /\s/u.test(source[removalTo] ?? "")) {
    removalTo += 1;
  }
  return {
    from: leftPipe,
    to: removalTo
  };
}
