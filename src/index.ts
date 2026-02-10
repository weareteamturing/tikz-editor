export { FeatureFlags } from "./ast/features.js";
export { parseTikz } from "./parser/index.js";
export { applyEdit } from "./edit/apply.js";
export { collectTikzSnippetsFromDocs, extractTikzSnippetsFromSource } from "./corpus/extract.js";

export type { ParseTikzOptions, ParseTikzResult } from "./parser/index.js";
export type { TikzEdit, ApplyEditResult } from "./edit/types.js";
export type { TikzSnippet, TikzSnippetKind } from "./corpus/extract.js";
export type * from "./ast/types.js";
export type * from "./diagnostics/types.js";
