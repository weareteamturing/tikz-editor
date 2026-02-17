import type { Span } from "../ast/types.js";
import type { SemanticContext } from "./context.js";
import type { EvaluatedCoordinate } from "./coords/evaluate.js";
import type { EditHandle } from "./types.js";

export function createEditHandle(
  evaluated: EvaluatedCoordinate,
  sourceSpan: Span,
  kind: "node-position" | "path-point",
  context: SemanticContext
): EditHandle | null {
  if (!evaluated.world) return null;

  const rewriteMode = determineRewriteMode(evaluated);

  return {
    id: `handle-${sourceSpan.from}-${sourceSpan.to}`,
    kind,
    world: evaluated.world,
    local: evaluated.local ?? undefined,
    transform: evaluated.transform,
    sourceSpan,
    coordinateForm: evaluated.coordinateForm,
    relativePrefix: evaluated.relativePrefix,
    relativeBaseWorld: evaluated.relativePrefix ? context.currentPoint ?? undefined : undefined,
    rewriteMode,
  };
}

function determineRewriteMode(evaluated: EvaluatedCoordinate): "direct" | "delta" | "unsupported" {
  if (evaluated.relativePrefix) return "delta";
  const form = evaluated.coordinateForm;
  if (form === "cartesian" || form === "polar" || form === "xyz") return "direct";
  // named, calc, explicit (perpendicular/intersection/canvas), unknown
  return "unsupported";
}
