import type { Span } from "../ast/types.js";
import type { SemanticContext } from "./context.js";
import type { EvaluatedCoordinate } from "./coords/evaluate.js";
import type { EditHandle } from "./types.js";

export function createEditHandle(
  evaluated: EvaluatedCoordinate,
  sourceSpan: Span,
  sourceId: string,
  kind: "node-position" | "path-point",
  context: SemanticContext,
  opts: {
    rewriteTargetHandleId?: string;
  } = {}
): EditHandle | null {
  if (!evaluated.world) return null;

  const rewriteMode = determineRewriteMode(evaluated);
  const sourceText = context.source.slice(sourceSpan.from, sourceSpan.to);

  return {
    // Keep IDs stable across coordinate text rewrites by avoiding source-span offsets.
    // This allows ongoing drags to continue after recompute snapshots.
    id: `handle:${sourceId}:${kind}:${context.editHandles.length}`,
    sourceId,
    kind,
    world: evaluated.world,
    local: evaluated.local ?? undefined,
    transform: evaluated.transform,
    sourceSpan,
    sourceText,
    sourceFingerprint: context.sourceFingerprint,
    coordinateForm: evaluated.coordinateForm,
    relativePrefix: evaluated.relativePrefix,
    relativeBaseWorld: evaluated.relativePrefix ? context.currentPoint ?? undefined : undefined,
    rewriteMode,
    rewriteTargetHandleId: opts.rewriteTargetHandleId
  };
}

function determineRewriteMode(evaluated: EvaluatedCoordinate): "direct" | "delta" | "unsupported" {
  if (evaluated.relativePrefix) return "delta";
  const form = evaluated.coordinateForm;
  if (form === "cartesian" || form === "polar" || form === "xyz") return "direct";
  // named, calc, explicit (perpendicular/intersection/canvas), unknown
  return "unsupported";
}
