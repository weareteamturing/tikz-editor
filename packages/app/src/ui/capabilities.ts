import {
  capabilityMatrix,
  type CapabilityMatrix,
  type CapabilityRow,
  type FeatureId
} from "tikz-editor/capabilities";
import type { InspectorProperty } from "tikz-editor/edit/inspector";
import type { ToolMode } from "../store/types";

type LayerKey = keyof Pick<CapabilityRow, "parser" | "semantic" | "svg" | "edit">;

type CapabilityCheck = {
  feature: FeatureId;
  layers: readonly LayerKey[];
  label: string;
};

type CapabilityStatus = "supported" | "partial" | "unsupported";

export type CapabilitySummary = {
  status: CapabilityStatus;
  reason: string;
};

const TOOL_CHECKS: Record<ToolMode, readonly CapabilityCheck[]> = {
  select: [
    { feature: "path_statement", layers: ["parser", "semantic", "svg", "edit"], label: "selection/move pipeline" }
  ],
  addBucket: [
    { feature: "options_structured", layers: ["edit"], label: "fill option editing" }
  ],
  addNode: [
    { feature: "path_statement", layers: ["parser", "semantic", "svg"], label: "node statement pipeline" },
    { feature: "svg_text", layers: ["semantic", "svg"], label: "text node rendering" }
  ],
  addPath: [
    { feature: "path_operators_basic", layers: ["parser", "semantic", "svg"], label: "polyline path rendering" },
    { feature: "path_operator_curves", layers: ["parser", "semantic", "svg"], label: "Bezier segment rendering" },
    { feature: "keyword_controls", layers: ["parser", "semantic", "svg"], label: "Bezier control-point parsing" },
    { feature: "path_cycle", layers: ["parser", "semantic", "svg"], label: "cycle closure rendering" }
  ],
  addFreehand: [
    { feature: "path_operators_basic", layers: ["parser", "semantic", "svg"], label: "path rendering" },
    { feature: "path_operator_curves", layers: ["parser", "semantic", "svg"], label: "Bezier curve rendering" },
    { feature: "keyword_controls", layers: ["parser", "semantic", "svg"], label: "Bezier control-point parsing" }
  ],
  addLine: [
    { feature: "path_operators_basic", layers: ["parser", "semantic", "svg"], label: "line path rendering" }
  ],
  addArrow: [
    { feature: "path_operators_basic", layers: ["parser", "semantic", "svg"], label: "line path rendering" },
    { feature: "arrow_tips", layers: ["parser", "semantic", "svg"], label: "arrow tip rendering" }
  ],
  addBezier: [
    { feature: "path_operator_curves", layers: ["parser", "semantic", "svg"], label: "Bezier curve path rendering" },
    { feature: "keyword_controls", layers: ["parser", "semantic", "svg"], label: "Bezier control-point parsing" }
  ],
  addGrid: [
    { feature: "keyword_grid", layers: ["parser", "semantic", "svg"], label: "grid keyword rendering" }
  ],
  addRect: [
    { feature: "shape_rectangle", layers: ["parser", "semantic", "svg"], label: "rectangle shape rendering" }
  ],
  addEllipse: [
    { feature: "shape_ellipse", layers: ["parser", "semantic", "svg"], label: "ellipse shape rendering" }
  ],
  addCircle: [
    { feature: "shape_circle", layers: ["parser", "semantic", "svg"], label: "circle shape rendering" }
  ]
};

const INSPECTOR_CHECKS: Record<InspectorProperty["kind"], readonly CapabilityCheck[]> = {
  text: [
    { feature: "options_structured", layers: ["edit"], label: "text option editing" },
    { feature: "svg_text", layers: ["semantic", "svg"], label: "text rendering" }
  ],
  number: [
    { feature: "options_structured", layers: ["edit"], label: "transform option editing" }
  ],
  length: [
    { feature: "options_structured", layers: ["edit"], label: "length option editing" }
  ],
  color: [
    { feature: "options_structured", layers: ["edit"], label: "style option editing" }
  ],
  nodeShape: [
    { feature: "options_structured", layers: ["edit"], label: "node shape option editing" }
  ],
  nodeFont: [
    { feature: "options_structured", layers: ["edit"], label: "node font option editing" },
    { feature: "svg_text", layers: ["semantic", "svg"], label: "text rendering" }
  ],
  lineWidth: [
    { feature: "options_structured", layers: ["edit"], label: "line width editing" }
  ],
  dashStyle: [
    { feature: "options_structured", layers: ["edit"], label: "dash style editing" }
  ],
  lineCap: [
    { feature: "options_structured", layers: ["edit"], label: "line cap editing" }
  ],
  lineJoin: [
    { feature: "options_structured", layers: ["edit"], label: "line join editing" }
  ],
  pathMorphingDecoration: [
    { feature: "options_structured", layers: ["edit"], label: "decoration option editing" },
    { feature: "decoration_pathmorphing", layers: ["semantic", "svg"], label: "path morphing rendering" }
  ],
  fillMode: [
    { feature: "options_structured", layers: ["edit"], label: "fill paint mode editing" },
    { feature: "path_shading", layers: ["semantic", "svg", "edit"], label: "gradient fill rendering/editing" },
    { feature: "path_patterns", layers: ["semantic", "svg", "edit"], label: "pattern fill rendering/editing" }
  ],
  fillShading: [
    { feature: "options_structured", layers: ["edit"], label: "shading option editing" },
    { feature: "path_shading", layers: ["semantic", "svg", "edit"], label: "gradient fill rendering/editing" }
  ],
  fillPattern: [
    { feature: "options_structured", layers: ["edit"], label: "pattern option editing" },
    { feature: "path_patterns", layers: ["semantic", "svg", "edit"], label: "pattern fill rendering/editing" }
  ],
  fillPatternOption: [
    { feature: "options_structured", layers: ["edit"], label: "pattern option editing" },
    { feature: "path_patterns", layers: ["semantic", "svg", "edit"], label: "pattern fill rendering/editing" }
  ],
  roundedCorners: [
    { feature: "options_structured", layers: ["edit"], label: "rounded corners editing" }
  ],
  arrowTip: [
    { feature: "options_structured", layers: ["edit"], label: "arrow option editing" },
    { feature: "arrow_tips", layers: ["semantic", "svg"], label: "arrow tip rendering" }
  ],
  shadowPreset: [
    { feature: "options_structured", layers: ["edit"], label: "shadow option editing" },
    { feature: "path_shadows", layers: ["semantic", "svg"], label: "shadow rendering" }
  ]
};

const NODE_SHAPE_FEATURE_BY_VALUE: Partial<
  Record<Exclude<Extract<InspectorProperty, { kind: "nodeShape" }>["value"], "custom">, FeatureId>
> = {
  rectangle: "shape_rectangle",
  circle: "shape_circle",
  ellipse: "shape_ellipse",
  diamond: "shape_diamond",
  trapezium: "shape_trapezium",
  coordinate: "named_coordinates"
};

export function getToolCapabilityStatus(
  toolMode: ToolMode,
  matrix: CapabilityMatrix = capabilityMatrix
): CapabilitySummary {
  const checks = TOOL_CHECKS[toolMode];
  if (!checks) {
    return {
      status: "unsupported",
      reason: `No capability checks registered for tool mode ${toolMode}.`
    };
  }
  return evaluateChecks(checks, matrix);
}

export function getInspectorPropertyCapabilityStatus(
  property: InspectorProperty,
  matrix: CapabilityMatrix = capabilityMatrix
): CapabilitySummary {
  const checks = [...INSPECTOR_CHECKS[property.kind]];
  if (property.kind === "nodeShape" && property.value !== "custom") {
    const shapeFeature = NODE_SHAPE_FEATURE_BY_VALUE[property.value];
    if (shapeFeature) {
      checks.push({
        feature: shapeFeature,
        layers: ["parser", "semantic", "svg", "edit"],
        label: `${property.value} node shape support`
      });
    }
  }
  return evaluateChecks(checks, matrix);
}

function evaluateChecks(
  checks: readonly CapabilityCheck[],
  matrix: CapabilityMatrix
): CapabilitySummary {
  const unsupported: string[] = [];
  const partial: string[] = [];

  for (const check of checks) {
    const row = matrix[check.feature];
    let status: CapabilityStatus = "supported";

    for (const layer of check.layers) {
      const layerStatus = row?.[layer];
      if (layerStatus === "none" || layerStatus == null) {
        status = "unsupported";
        break;
      }
      if (layerStatus === "partial") {
        status = "partial";
      }
    }

    if (status === "unsupported") {
      unsupported.push(check.label);
      continue;
    }
    if (status === "partial") {
      partial.push(check.label);
    }
  }

  if (unsupported.length > 0) {
    return {
      status: "unsupported",
      reason: `Unavailable in capability matrix: ${unsupported.join(", ")}.`
    };
  }

  if (partial.length > 0) {
    return {
      status: "partial",
      reason: `Partially supported: ${partial.join(", ")}.`
    };
  }

  return { status: "supported", reason: "Supported by current capability matrix." };
}
