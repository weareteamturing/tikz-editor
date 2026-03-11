import { applyOptionMutationsToTarget, normalizeOptionKey, type OptionMutation } from "../option-mutations.js";
import { resolvePropertyTarget } from "../property-target.js";
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
