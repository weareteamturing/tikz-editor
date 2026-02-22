export { FeatureFlags } from "./ast/features.js";
export { parseTikz } from "./parser/index.js";
export { applyEdit, applyEditIntent } from "./edit/apply.js";
export { EditorSession } from "./edit/session.js";
export { collectTikzSnippetsFromDocs, extractTikzSnippetsFromSource } from "./corpus/extract.js";
export { evaluateTikzFigure } from "./semantic/index.js";
export { emitSvg } from "./svg/index.js";
export { renderTikzToSvg, renderTikzToSvgAsync } from "./render/index.js";
export { capabilityMatrix, FEATURE_IDS } from "./capabilities/index.js";
export { createMathJaxNodeTextEngine } from "./text/mathjax-engine.js";
export { collectSymbols } from "./completion/index.js";
export { EDIT_ACTION_IDS, getEditActionAvailability } from "./edit/action-availability.js";
export {
  buildSnapContext,
  snapSelectionTranslation,
  snapHandlePosition,
  snapKeyboardNudge,
  snapToolPointer,
  pickGridStepPt,
  snapToNextMultiple,
  resolveSnapSettings,
  collectSelectionGeometry,
  collectSelectionGeometryFromBounds,
  collectSourceWorldBounds,
  boundsFromPoints,
  selectionSnapPointsFromBounds
} from "./edit/snapping/index.js";

export type { ParseTikzOptions, ParseTikzResult } from "./parser/index.js";
export type { TikzEdit, ApplyEditResult, EditIntent, EditIntentResult, SourcePatch } from "./edit/types.js";
export type { TikzSnippet, TikzSnippetKind } from "./corpus/extract.js";
export type { EvaluateTikzResult } from "./semantic/index.js";
export type { EmitSvgResult, EmitSvgOptions, SvgViewBox } from "./svg/index.js";
export type { RenderTikzOptions, RenderTikzToSvgResult } from "./render/index.js";
export type { CapabilityMatrix, CapabilityRow, LayerStatus, FeatureId } from "./capabilities/index.js";
export type { DocumentSymbols } from "./completion/index.js";
export type {
  ActionAvailability,
  EditActionAvailability,
  EditActionId,
  GetEditActionAvailabilityInput
} from "./edit/action-availability.js";
export type * from "./edit/snapping/types.js";
export type * from "./text/types.js";
export type * from "./ast/types.js";
export type * from "./diagnostics/types.js";
export type * from "./semantic/index.js";
export type * from "./options/types.js";
