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
  addNode: [
    { feature: "path_statement", layers: ["parser", "semantic", "svg"], label: "node statement pipeline" },
    { feature: "svg_text", layers: ["semantic", "svg"], label: "text node rendering" }
  ],
  addLine: [
    { feature: "path_operators_basic", layers: ["parser", "semantic", "svg"], label: "line path rendering" }
  ],
  addArrow: [
    { feature: "path_operators_basic", layers: ["parser", "semantic", "svg"], label: "line path rendering" },
    { feature: "arrow_tips", layers: ["parser", "semantic", "svg"], label: "arrow tip rendering" }
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
  number: [
    { feature: "path_statement", layers: ["edit"], label: "position editing" }
  ],
  color: [
    { feature: "options_structured", layers: ["edit"], label: "style option editing" }
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
  roundedCorners: [
    { feature: "options_structured", layers: ["edit"], label: "rounded corners editing" }
  ],
  arrowTip: [
    { feature: "options_structured", layers: ["edit"], label: "arrow option editing" },
    { feature: "arrow_tips", layers: ["semantic", "svg"], label: "arrow tip rendering" }
  ]
};

export function getToolCapabilityStatus(
  toolMode: ToolMode,
  matrix: CapabilityMatrix = capabilityMatrix
): CapabilitySummary {
  return evaluateChecks(TOOL_CHECKS[toolMode], matrix);
}

export function getInspectorPropertyCapabilityStatus(
  property: InspectorProperty,
  matrix: CapabilityMatrix = capabilityMatrix
): CapabilitySummary {
  return evaluateChecks(INSPECTOR_CHECKS[property.kind], matrix);
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
