import type { OptionEntry, OptionListAst } from "../../options/types.js";
import type { Matrix2D, ResolvedStyle } from "../types.js";
import { parseArrowSpecification } from "./arrows.js";
import { applyFlagEntry } from "./apply-flag.js";
import type { ApplyOutcome } from "./apply-types.js";
import { applyKvEntry } from "./apply-kv.js";
import type { CustomStyleRegistry } from "./custom-styles.js";
import { walkOptionEntriesWithCustomStyles } from "./custom-styles.js";
import { commandDefaultStyle, defaultStyle, DEFAULT_TEXT_FONT_SIZE } from "./defaults.js";
import { extractCircleRadius } from "./extract-circle-radius.js";
import { parseStyleValueAsOptionList } from "./option-utils.js";

export type ResolvedContextDelta = {
  style: ResolvedStyle;
  transform: Matrix2D;
  diagnostics: string[];
  expandedOptionLists: OptionListAst[];
};

export function resolveContextDelta(
  baseStyle: ResolvedStyle,
  baseTransform: Matrix2D,
  optionLists: OptionListAst[],
  customStyles: CustomStyleRegistry = new Map()
): ResolvedContextDelta {
  const diagnostics: string[] = [];
  let style = { ...baseStyle };
  let transform = baseTransform;
  const expandedEntries: OptionEntry[] = [];

  walkOptionEntriesWithCustomStyles(
    optionLists,
    customStyles,
    (entry) => {
      expandedEntries.push(entry);
      const outcome = applyOptionEntry(entry, style, transform);
      style = outcome.style;
      transform = outcome.transform;
      diagnostics.push(...outcome.diagnostics);
    },
    diagnostics
  );

  const expandedOptionLists = buildExpandedOptionLists(optionLists, expandedEntries);

  return { style, transform, diagnostics, expandedOptionLists };
}

function applyOptionEntry(
  entry: OptionEntry,
  style: ResolvedStyle,
  transform: Matrix2D
): ApplyOutcome {
  if (entry.kind === "unknown") {
    const parsedArrow = parseArrowSpecification(entry.raw, style);
    if (parsedArrow) {
      return { style: { ...style, markerStart: parsedArrow.start, markerEnd: parsedArrow.end }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [] };
  }

  if (entry.kind === "flag") {
    if (entry.key === "every shadow") {
      let nextStyle = style;
      let nextTransform = transform;
      const diagnostics: string[] = [];
      for (const list of style.everyShadowStyles) {
        for (const nestedEntry of list.entries) {
          const outcome = applyOptionEntry(nestedEntry, nextStyle, nextTransform);
          nextStyle = outcome.style;
          nextTransform = outcome.transform;
          diagnostics.push(...outcome.diagnostics);
        }
      }
      return { style: nextStyle, transform: nextTransform, diagnostics };
    }

    if (
      entry.key === "general shadow" ||
      entry.key === "drop shadow" ||
      entry.key === "copy shadow" ||
      entry.key === "double copy shadow" ||
      entry.key === "circular drop shadow" ||
      entry.key === "circular glow"
    ) {
      return applyKvEntry(entry.key, "", style, transform, applyOptionEntry);
    }

    return applyFlagEntry(entry.key, entry.raw, style, transform);
  }

  return applyKvEntry(entry.key, entry.valueRaw, style, transform, applyOptionEntry);
}

function buildExpandedOptionLists(optionLists: OptionListAst[], entries: OptionEntry[]): OptionListAst[] {
  if (entries.length === 0) {
    return [];
  }

  const spanFrom = optionLists.reduce((min, list) => Math.min(min, list.span.from), Number.POSITIVE_INFINITY);
  const spanTo = optionLists.reduce((max, list) => Math.max(max, list.span.to), 0);
  return [
    {
      span: {
        from: Number.isFinite(spanFrom) ? spanFrom : 0,
        to: spanTo
      },
      raw: optionLists.map((list) => list.raw).join(", "),
      entries
    }
  ];
}

export { DEFAULT_TEXT_FONT_SIZE, defaultStyle, commandDefaultStyle, extractCircleRadius, parseStyleValueAsOptionList };
