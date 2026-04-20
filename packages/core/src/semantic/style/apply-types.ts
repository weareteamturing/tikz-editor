import type { WorldTransform } from "../../coords/transforms.js";
import type { OptionEntry } from "../../options/types.js";
import type { ResolvedStyle } from "../types.js";

export type ApplyOutcome = {
  style: ResolvedStyle;
  transform: WorldTransform;
  diagnostics: string[];
};

export type ApplyEntryFn = (entry: OptionEntry, style: ResolvedStyle, transform: WorldTransform) => ApplyOutcome;
