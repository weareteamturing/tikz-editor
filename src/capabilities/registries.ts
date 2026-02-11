import type { FeatureId } from "./feature-ids.js";

export const parserFeatureRegistry = [
  "path_statement",
  "scope_statement",
  "foreach_statement",
  "unknown_statement",
  "options_structured",
  "path_operators_basic",
  "path_operator_curves",
  "path_cycle",
  "shape_rectangle",
  "shape_circle",
  "named_coordinates",
  "to_operation",
  "svg_operation",
  "let_operation",
  "keyword_ellipse",
  "keyword_arc",
  "keyword_grid",
  "keyword_to",
  "keyword_controls",
  "keyword_and"
] as const satisfies readonly FeatureId[];

export const semanticFeatureRegistry = [
  "path_statement",
  "scope_statement",
  "foreach_statement",
  "unknown_statement",
  "options_structured",
  "path_operators_basic",
  "path_cycle",
  "shape_rectangle",
  "shape_circle",
  "named_coordinates",
  "to_operation",
  "keyword_ellipse",
  "keyword_arc",
  "keyword_grid",
  "keyword_to",
  "svg_path",
  "svg_circle",
  "svg_text"
] as const satisfies readonly FeatureId[];

export const svgFeatureRegistry = [
  "path_statement",
  "scope_statement",
  "options_structured",
  "path_operators_basic",
  "path_cycle",
  "shape_rectangle",
  "shape_circle",
  "named_coordinates",
  "to_operation",
  "keyword_ellipse",
  "keyword_arc",
  "keyword_grid",
  "keyword_to",
  "svg_path",
  "svg_circle",
  "svg_text",
  "render_pipeline"
] as const satisfies readonly FeatureId[];

export const editFeatureRegistry = [
  "path_statement",
  "scope_statement",
  "options_structured",
  "path_operators_basic",
  "path_cycle",
  "shape_rectangle",
  "shape_circle",
  "svg_text"
] as const satisfies readonly FeatureId[];
