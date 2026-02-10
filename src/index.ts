export { FeatureFlags } from "./features.js";
export { parseTikz } from "./parser/index.js";
export { applyEdit } from "./roundtrip/edit.js";
export { collectTikzSnippetsFromDocs, extractTikzSnippetsFromSource } from "./corpus/extract.js";

export type { ParseTikzOptions, ParseTikzResult } from "./parser/index.js";
export type { TikzEdit, ApplyEditResult } from "./roundtrip/edit.js";
export type { TikzSnippet, TikzSnippetKind } from "./corpus/extract.js";
export type * from "./ir/types.js";
export type * from "./diagnostics/types.js";
