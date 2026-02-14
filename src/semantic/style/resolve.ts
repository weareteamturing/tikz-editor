import type { OptionEntry, OptionListAst } from "../../options/types.js";
import type { Matrix2D, ResolvedStyle } from "../types.js";
import { parseArrowSpecification } from "./arrows.js";
import { applyFlagEntry } from "./apply-flag.js";
import type { ApplyOutcome } from "./apply-types.js";
import { applyKvEntry } from "./apply-kv.js";
import { commandDefaultStyle, defaultStyle, DEFAULT_TEXT_FONT_SIZE } from "./defaults.js";
import { extractCircleRadius } from "./extract-circle-radius.js";
import { parseStyleValueAsOptionList } from "./option-utils.js";

export type ResolvedContextDelta = {
  style: ResolvedStyle;
  transform: Matrix2D;
  diagnostics: string[];
};

export function resolveContextDelta(baseStyle: ResolvedStyle, baseTransform: Matrix2D, optionLists: OptionListAst[]): ResolvedContextDelta {
  const diagnostics: string[] = [];
  let style = { ...baseStyle };
  let transform = baseTransform;

  for (const list of optionLists) {
    for (const entry of list.entries) {
      const outcome = applyOptionEntry(entry, style, transform);
      style = outcome.style;
      transform = outcome.transform;
      diagnostics.push(...outcome.diagnostics);
    }
  }

  return { style, transform, diagnostics };
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
    return applyFlagEntry(entry.key, entry.raw, style, transform);
  }

  return applyKvEntry(entry.key, entry.valueRaw, style, transform, applyOptionEntry);
}

export { DEFAULT_TEXT_FONT_SIZE, defaultStyle, commandDefaultStyle, extractCircleRadius, parseStyleValueAsOptionList };
