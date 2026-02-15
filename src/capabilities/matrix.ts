import type { CapabilityMatrix } from "./types.js";

export const capabilityMatrix: CapabilityMatrix = {
  path_statement: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "stable",
    fixtures: ["basic_draw"]
  },
  scope_statement: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["scope_transform"]
  },
  foreach_statement: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["foreach_basic", "foreach_options_core"],
    notes: "Expanded during semantic evaluation with provenance metadata on generated scene elements."
  },
  foreach_path_operation: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["foreach_path_basic"]
  },
  foreach_node_operation: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["foreach_node_basic"]
  },
  unknown_statement: {
    parser: "stable",
    semantic: "partial",
    svg: "none",
    edit: "none",
    fixtures: ["unknown_statement"]
  },
  options_structured: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["option_styles"]
  },
  path_shading: {
    parser: "stable",
    semantic: "stable",
    svg: "partial",
    edit: "none",
    fixtures: ["shading_styles"],
    notes:
      "Core axis/radial/ball shading keys map to SVG gradients; advanced functional shadings currently fall back with SVG diagnostics."
  },
  path_shadows: {
    parser: "stable",
    semantic: "stable",
    svg: "partial",
    edit: "none",
    fixtures: ["shadow_styles"],
    notes:
      "General/drop/copy/double-copy/circular shadow presets resolve to semantic shadow layers and render via SVG duplicates; advanced fading variants remain partial."
  },
  arrow_tips: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["arrow_tips"]
  },
  path_operators_basic: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["basic_draw"]
  },
  path_operator_curves: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["curve_operator"]
  },
  path_cycle: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["cycle_polygon"]
  },
  shape_rectangle: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["rectangle_shape"]
  },
  shape_circle: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["circle_shape"]
  },
  shape_diamond: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["diamond_shape"]
  },
  shape_trapezium: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["trapezium_shape"]
  },
  matrix_node: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["matrix_basic"]
  },
  named_coordinates: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["coordinate_operation"]
  },
  to_operation: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["to_operation"]
  },
  svg_operation: {
    parser: "stable",
    semantic: "none",
    svg: "none",
    edit: "none",
    fixtures: ["svg_operation"]
  },
  let_operation: {
    parser: "stable",
    semantic: "none",
    svg: "none",
    edit: "none",
    fixtures: ["let_operation"]
  },
  keyword_ellipse: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["ellipse_keyword"]
  },
  keyword_arc: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["arc_keyword"]
  },
  keyword_grid: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["grid_keyword"]
  },
  keyword_to: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["to_operation"]
  },
  keyword_controls: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["curve_operator"]
  },
  keyword_and: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["curve_operator"]
  },
  svg_path: {
    parser: "none",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["basic_draw"]
  },
  svg_circle: {
    parser: "none",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["circle_shape"]
  },
  svg_text: {
    parser: "none",
    semantic: "stable",
    svg: "stable",
    edit: "stable",
    fixtures: ["node_text"]
  },
  render_pipeline: {
    parser: "none",
    semantic: "none",
    svg: "stable",
    edit: "none",
    fixtures: ["basic_draw", "circle_shape", "node_text"]
  }
};
