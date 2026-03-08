import type { OptionEntry } from "../../options/types.js";
import type { Matrix2D, ResolvedStyle } from "../types.js";

export type ApplyOutcome = {
  style: ResolvedStyle;
  transform: Matrix2D;
  diagnostics: string[];
};

export type ApplyEntryFn = (entry: OptionEntry, style: ResolvedStyle, transform: Matrix2D) => ApplyOutcome;
