import type { OptionEntry, OptionListAst } from "../../options/types.js";
import { parseStyleValueAsOptionList } from "./option-utils.js";

export type CustomStyleRegistry = Map<string, OptionListAst[]>;

type CustomStyleDefinitionKind = "style" | "append" | "prefix";

type CustomStyleDefinition = {
  name: string;
  kind: CustomStyleDefinitionKind;
};

const RESERVED_STYLE_DEFINITION_KEYS = new Set([
  "every path/.style",
  "every path/.append style",
  "every path/.prefix style",
  "every shadow/.style",
  "every shadow/.append style",
  "every shadow/.prefix style",
  "every node/.style",
  "every node/.append style",
  "every node/.prefix style",
  "every rectangle node/.style",
  "every rectangle node/.append style",
  "every rectangle node/.prefix style",
  "every circle node/.style",
  "every circle node/.append style",
  "every circle node/.prefix style",
  "every diamond node/.style",
  "every diamond node/.append style",
  "every diamond node/.prefix style",
  "every trapezium node/.style",
  "every trapezium node/.append style",
  "every trapezium node/.prefix style",
  "every isosceles triangle node/.style",
  "every isosceles triangle node/.append style",
  "every isosceles triangle node/.prefix style",
  "every kite node/.style",
  "every kite node/.append style",
  "every kite node/.prefix style",
  "every dart node/.style",
  "every dart node/.append style",
  "every dart node/.prefix style",
  "every circular sector node/.style",
  "every circular sector node/.append style",
  "every circular sector node/.prefix style",
  "every cylinder node/.style",
  "every cylinder node/.append style",
  "every cylinder node/.prefix style",
  "every cloud node/.style",
  "every cloud node/.append style",
  "every cloud node/.prefix style",
  "every starburst node/.style",
  "every starburst node/.append style",
  "every starburst node/.prefix style",
  "every signal node/.style",
  "every signal node/.append style",
  "every signal node/.prefix style",
  "every tape node/.style",
  "every tape node/.append style",
  "every tape node/.prefix style",
  "every rectangle callout node/.style",
  "every rectangle callout node/.append style",
  "every rectangle callout node/.prefix style",
  "every ellipse callout node/.style",
  "every ellipse callout node/.append style",
  "every ellipse callout node/.prefix style",
  "every cloud callout node/.style",
  "every cloud callout node/.append style",
  "every cloud callout node/.prefix style",
  "every single arrow node/.style",
  "every single arrow node/.append style",
  "every single arrow node/.prefix style",
  "every double arrow node/.style",
  "every double arrow node/.append style",
  "every double arrow node/.prefix style"
]);

export function cloneCustomStyleRegistry(registry: CustomStyleRegistry): CustomStyleRegistry {
  const cloned: CustomStyleRegistry = new Map();
  for (const [name, entries] of registry.entries()) {
    cloned.set(name, [...entries]);
  }
  return cloned;
}

export function walkOptionEntriesWithCustomStyles(
  optionLists: OptionListAst[],
  customStyles: CustomStyleRegistry,
  onEntry: (entry: OptionEntry) => void,
  diagnostics: string[]
): void {
  for (const list of optionLists) {
    for (const entry of list.entries) {
      walkEntry(entry, customStyles, onEntry, diagnostics, new Set());
    }
  }
}

export function applyCustomStyleDefinition(
  customStyles: CustomStyleRegistry,
  styleName: string,
  kind: CustomStyleDefinitionKind,
  optionList: OptionListAst
): void {
  const normalizedName = normalizeCustomStyleName(styleName);
  if (normalizedName.length === 0) {
    return;
  }

  const existing = customStyles.get(normalizedName) ?? [];
  if (kind === "style") {
    customStyles.set(normalizedName, [optionList]);
    return;
  }

  if (kind === "append") {
    customStyles.set(normalizedName, [...existing, optionList]);
    return;
  }

  customStyles.set(normalizedName, [optionList, ...existing]);
}

function walkEntry(
  entry: OptionEntry,
  customStyles: CustomStyleRegistry,
  onEntry: (entry: OptionEntry) => void,
  diagnostics: string[],
  activeStyles: Set<string>
): void {
  if (entry.kind === "kv") {
    const definition = parseCustomStyleDefinition(entry.key);
    if (definition) {
      const nested = parseStyleValueAsOptionList(entry.valueRaw);
      if (!nested) {
        diagnostics.push(`invalid-style-value:${entry.valueRaw}`);
        return;
      }
      applyCustomStyleDefinition(customStyles, definition.name, definition.kind, nested);
      return;
    }
  }

  const invocation = resolveCustomStyleInvocation(entry, customStyles);
  if (invocation) {
    if (activeStyles.has(invocation.name)) {
      diagnostics.push(`custom-style-recursion:${invocation.name}`);
      return;
    }

    const nextActive = new Set(activeStyles);
    nextActive.add(invocation.name);
    for (const nestedList of invocation.lists) {
      for (const nestedEntry of nestedList.entries) {
        walkEntry(nestedEntry, customStyles, onEntry, diagnostics, nextActive);
      }
    }
    return;
  }

  onEntry(entry);
}

function resolveCustomStyleInvocation(
  entry: OptionEntry,
  customStyles: CustomStyleRegistry
): { name: string; lists: OptionListAst[] } | null {
  const key =
    entry.kind === "flag"
      ? entry.key
      : entry.kind === "kv" && entry.valueRaw.trim().length === 0
        ? entry.key
        : null;
  if (!key) {
    return null;
  }

  const normalizedName = normalizeCustomStyleName(key);
  if (normalizedName.length === 0) {
    return null;
  }

  const lists = customStyles.get(normalizedName);
  if (!lists || lists.length === 0) {
    return null;
  }

  return { name: normalizedName, lists };
}

function parseCustomStyleDefinition(key: string): CustomStyleDefinition | null {
  const normalizedKey = key.trim().toLowerCase();
  if (RESERVED_STYLE_DEFINITION_KEYS.has(normalizedKey)) {
    return null;
  }

  const match = normalizedKey.match(
    /^(.*)\/\.(append style|prefix style|style(?:\s+\d+\s+args|\s+args)?|estyle)$/
  );
  if (!match) {
    return null;
  }

  const rawName = match[1] ?? "";
  const rawSuffix = match[2] ?? "";
  const name = normalizeCustomStyleName(rawName);
  if (name.length === 0) {
    return null;
  }

  if (rawSuffix === "append style") {
    return { name, kind: "append" };
  }
  if (rawSuffix === "prefix style") {
    return { name, kind: "prefix" };
  }

  return { name, kind: "style" };
}

function normalizeCustomStyleName(raw: string): string {
  let normalized = raw.trim().toLowerCase();
  if (normalized.startsWith("/tikz/")) {
    normalized = normalized.slice("/tikz/".length);
  } else if (normalized === "/tikz") {
    normalized = "";
  }

  while (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }
  return normalized.trim();
}
