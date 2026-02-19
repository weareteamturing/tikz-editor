import type { Span } from "../ast/types.js";
import type { OptionListAst } from "../options/types.js";
import type { Matrix2D, ResolvedStyle } from "./types.js";

export type StyleChainKind = "global" | "named-style" | "every-node" | "every-shape" | "scope" | "command";

export type StyleSourceRef = {
  sourceId: string;
  sourceSpan?: Span;
  sourceKind: string;
  label?: string;
};

type StyleChainEntryBase = {
  kind: StyleChainKind;
  sourceRef?: StyleSourceRef;
  rawOptions: OptionListAst[];
  before: ResolvedStyle;
  after: ResolvedStyle;
  resolvedContributions: Partial<ResolvedStyle>;
};

export type StyleChainEntry =
  | (StyleChainEntryBase & {
      kind: "global" | "every-node" | "scope" | "command";
    })
  | (StyleChainEntryBase & {
      kind: "named-style";
      styleName: string;
    })
  | (StyleChainEntryBase & {
      kind: "every-shape";
      shape: string;
    });

export type StyleTraceLayerInput =
  | {
      kind: "global" | "every-node" | "scope" | "command";
      sourceRef?: StyleSourceRef;
      rawOptions: OptionListAst[];
    }
  | {
      kind: "named-style";
      sourceRef?: StyleSourceRef;
      styleName: string;
      rawOptions: OptionListAst[];
    }
  | {
      kind: "every-shape";
      sourceRef?: StyleSourceRef;
      shape: string;
      rawOptions: OptionListAst[];
    };

export type ResolvedStyleTrace = {
  style: ResolvedStyle;
  transform: Matrix2D;
  diagnostics: string[];
  expandedOptionLists: OptionListAst[];
  chain: StyleChainEntry[];
};

export function cloneStyleSourceRef(sourceRef: StyleSourceRef | undefined): StyleSourceRef | undefined {
  if (!sourceRef) {
    return undefined;
  }
  return {
    sourceId: sourceRef.sourceId,
    sourceSpan: sourceRef.sourceSpan
      ? {
          from: sourceRef.sourceSpan.from,
          to: sourceRef.sourceSpan.to
        }
      : undefined,
    sourceKind: sourceRef.sourceKind,
    label: sourceRef.label
  };
}

export function cloneStyleChain(chain: StyleChainEntry[]): StyleChainEntry[] {
  return chain.map((entry) => cloneStyleChainEntry(entry));
}

export function cloneStyleChainEntry(entry: StyleChainEntry): StyleChainEntry {
  if (entry.kind === "named-style") {
    return {
      ...cloneStyleChainEntryBase(entry),
      kind: "named-style",
      styleName: entry.styleName
    };
  }
  if (entry.kind === "every-shape") {
    return {
      ...cloneStyleChainEntryBase(entry),
      kind: "every-shape",
      shape: entry.shape
    };
  }
  return {
    ...cloneStyleChainEntryBase(entry),
    kind: entry.kind
  };
}

function cloneStyleChainEntryBase(entry: StyleChainEntryBase): StyleChainEntryBase {
  return {
    kind: entry.kind,
    sourceRef: cloneStyleSourceRef(entry.sourceRef),
    rawOptions: entry.rawOptions.map((list) => cloneOptionList(list)),
    before: cloneResolvedStyle(entry.before),
    after: cloneResolvedStyle(entry.after),
    resolvedContributions: cloneResolvedStyleContributions(entry.resolvedContributions)
  };
}

function cloneResolvedStyleContributions(contributions: Partial<ResolvedStyle>): Partial<ResolvedStyle> {
  const cloned: Partial<ResolvedStyle> = {};
  const clonedRecord = cloned as Record<keyof ResolvedStyle, ResolvedStyle[keyof ResolvedStyle]>;
  for (const key of Object.keys(contributions) as Array<keyof ResolvedStyle>) {
    const value = contributions[key];
    if (value !== undefined) {
      clonedRecord[key] = cloneDeepValue(value) as ResolvedStyle[keyof ResolvedStyle];
    }
  }
  return cloned;
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

export function cloneResolvedStyle(style: ResolvedStyle): ResolvedStyle {
  return cloneDeepValue(style);
}

export function diffResolvedStyle(before: ResolvedStyle, after: ResolvedStyle): Partial<ResolvedStyle> {
  const diff: Partial<ResolvedStyle> = {};
  const diffRecord = diff as Record<keyof ResolvedStyle, ResolvedStyle[keyof ResolvedStyle]>;
  for (const key of Object.keys(after) as Array<keyof ResolvedStyle>) {
    const nextValue = after[key];
    if (nextValue !== undefined && !resolvedStyleValueEquals(before[key], nextValue)) {
      diffRecord[key] = cloneDeepValue(nextValue) as ResolvedStyle[keyof ResolvedStyle];
    }
  }
  return diff;
}

export function resolvedStyleValueEquals(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!resolvedStyleValueEquals(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) {
      return false;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    for (const key of leftKeys) {
      if (!(key in right)) {
        return false;
      }
      if (!resolvedStyleValueEquals((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function cloneDeepValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneDeepValue(item)) as T;
  }
  if (isPlainObject(value)) {
    const cloned: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      cloned[key] = cloneDeepValue(nested);
    }
    return cloned as T;
  }
  return value;
}
