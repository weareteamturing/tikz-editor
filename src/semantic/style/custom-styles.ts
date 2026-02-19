import type { OptionEntry, OptionListAst } from "../../options/types.js";
import type { Span } from "../../ast/types.js";
import { parseStyleValueAsOptionList } from "./option-utils.js";
import type { StyleSourceRef } from "../style-chain.js";
import { cloneStyleSourceRef } from "../style-chain.js";

export type CustomStyleRegistry = Map<string, CustomStyleLayer[]>;

type CustomStyleDefinitionKind = "style" | "append" | "prefix";

export type CustomStyleLayer = {
  options: OptionListAst;
  sourceRef: StyleSourceRef;
};

export type CustomStyleDefinition = {
  name: string;
  kind: CustomStyleDefinitionKind;
};

export type CustomStyleInvocation = {
  name: string;
  layers: CustomStyleLayer[];
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

const BUILTIN_CUSTOM_STYLE_DEFINITIONS: Array<{ name: string; source: string }> = [
  { name: "help lines", source: "color=gray,very thin" },
  { name: "every edge quotes", source: "auto" }
];

const BUILTIN_CUSTOM_STYLE_REGISTRY_ENTRIES: Array<[string, CustomStyleLayer[]]> = BUILTIN_CUSTOM_STYLE_DEFINITIONS.flatMap(
  ({ name, source }) => {
    const parsed = parseStyleValueAsOptionList(source);
    if (!parsed) {
      return [];
    }
    const normalizedName = normalizeCustomStyleName(name);
    return [
      [
        normalizedName,
        [
          {
            options: parsed,
            sourceRef: {
              sourceId: `builtin-style:${normalizedName}`,
              sourceKind: "builtin-style",
              label: normalizedName
            }
          }
        ]
      ]
    ];
  }
);

export function createDefaultCustomStyleRegistry(): CustomStyleRegistry {
  const registry: CustomStyleRegistry = new Map();
  for (const [name, layers] of BUILTIN_CUSTOM_STYLE_REGISTRY_ENTRIES) {
    registry.set(name, layers.map((layer) => cloneCustomStyleLayer(layer)));
  }
  return registry;
}

export function cloneCustomStyleRegistry(registry: CustomStyleRegistry): CustomStyleRegistry {
  const cloned: CustomStyleRegistry = new Map();
  for (const [name, layers] of registry.entries()) {
    cloned.set(name, layers.map((layer) => cloneCustomStyleLayer(layer)));
  }
  return cloned;
}

export function walkOptionEntriesWithCustomStyles(
  optionLists: OptionListAst[],
  customStyles: CustomStyleRegistry,
  onEntry: (entry: OptionEntry) => void,
  diagnostics: string[],
  sourceRef?: StyleSourceRef
): void {
  for (const list of optionLists) {
    for (const entry of list.entries) {
      walkEntry(entry, customStyles, onEntry, diagnostics, new Set(), sourceRef);
    }
  }
}

export function applyCustomStyleDefinition(
  customStyles: CustomStyleRegistry,
  styleName: string,
  kind: CustomStyleDefinitionKind,
  optionList: OptionListAst,
  sourceRef?: StyleSourceRef
): void {
  const normalizedName = normalizeCustomStyleName(styleName);
  if (normalizedName.length === 0) {
    return;
  }

  const definitionSourceRef =
    cloneStyleSourceRef(sourceRef) ??
    ({
      sourceId: `custom-style:${normalizedName}:unknown`,
      sourceKind: "custom-style-definition",
      label: normalizedName
    } satisfies StyleSourceRef);
  const layer: CustomStyleLayer = {
    options: optionList,
    sourceRef: definitionSourceRef
  };

  const existing = customStyles.get(normalizedName) ?? [];
  if (kind === "style") {
    customStyles.set(normalizedName, [layer]);
    return;
  }

  if (kind === "append") {
    customStyles.set(normalizedName, [...existing, layer]);
    return;
  }

  customStyles.set(normalizedName, [layer, ...existing]);
}

export function resolveCustomStyleInvocation(entry: OptionEntry, customStyles: CustomStyleRegistry): CustomStyleInvocation | null {
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

  const layers = customStyles.get(normalizedName);
  if (!layers || layers.length === 0) {
    return null;
  }

  return {
    name: normalizedName,
    layers
  };
}

export function parseCustomStyleDefinition(key: string): CustomStyleDefinition | null {
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

export function normalizeCustomStyleName(raw: string): string {
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

function walkEntry(
  entry: OptionEntry,
  customStyles: CustomStyleRegistry,
  onEntry: (entry: OptionEntry) => void,
  diagnostics: string[],
  activeStyles: Set<string>,
  sourceRef?: StyleSourceRef
): void {
  if (entry.kind === "kv") {
    const definition = parseCustomStyleDefinition(entry.key);
    if (definition) {
      const valueStart = resolveValueStartOffset(entry);
      const nested = parseStyleValueAsOptionList(entry.valueRaw, valueStart);
      if (!nested) {
        diagnostics.push(`invalid-style-value:${entry.valueRaw}`);
        return;
      }
      applyCustomStyleDefinition(
        customStyles,
        definition.name,
        definition.kind,
        nested,
        deriveEntrySourceRef(sourceRef, entry.span, definition.name)
      );
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
    for (const layer of invocation.layers) {
      for (const nestedEntry of layer.options.entries) {
        walkEntry(nestedEntry, customStyles, onEntry, diagnostics, nextActive, layer.sourceRef);
      }
    }
    return;
  }

  onEntry(entry);
}

function deriveEntrySourceRef(
  baseSourceRef: StyleSourceRef | undefined,
  entrySpan: Span,
  label: string
): StyleSourceRef {
  const sourceId = baseSourceRef?.sourceId ?? "__unknown__";
  return {
    sourceId,
    sourceSpan: entrySpan,
    sourceKind: baseSourceRef?.sourceKind ?? "custom-style-definition",
    label
  };
}

function resolveValueStartOffset(entry: Extract<OptionEntry, { kind: "kv" }>): number {
  const rawIndex = entry.raw.indexOf(entry.valueRaw);
  if (rawIndex >= 0) {
    return entry.span.from + rawIndex;
  }
  return entry.span.from;
}

function cloneCustomStyleLayer(layer: CustomStyleLayer): CustomStyleLayer {
  return {
    options: cloneOptionList(layer.options),
    sourceRef:
      cloneStyleSourceRef(layer.sourceRef) ??
      ({
        sourceId: "__unknown__",
        sourceKind: "custom-style-definition"
      } satisfies StyleSourceRef)
  };
}

function cloneOptionList(optionList: OptionListAst): OptionListAst {
  return {
    span: {
      from: optionList.span.from,
      to: optionList.span.to
    },
    raw: optionList.raw,
    entries: optionList.entries.map((entry) => ({
      ...entry,
      span: {
        from: entry.span.from,
        to: entry.span.to
      }
    }))
  };
}
