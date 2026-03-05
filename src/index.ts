export { FeatureFlags } from "./ast/features.js";
export { parseTikz } from "./parser/index.js";
export { applyEdit, applyEditIntent } from "./edit/apply.js";
export { EditorSession } from "./edit/session.js";
export { collectTikzSnippetsFromDocs, extractTikzSnippetsFromSource } from "./corpus/extract.js";
export {
  evaluateTikzFigure,
  createIncrementalSemanticSession,
  collectGeometryInvalidation
} from "./semantic/index.js";
export { emitSvg, emitSvgModel, serializeSvgModel, serializeSvgModelAsync, diffSvgModels } from "./svg/index.js";
export { renderTikzToSvg, renderTikzToSvgAsync } from "./render/index.js";
export { capabilityMatrix, FEATURE_IDS } from "./capabilities/index.js";
export { createMathJaxNodeTextEngine } from "./text/mathjax-engine.js";
export { collectSymbols } from "./completion/index.js";
export { CANVAS_CONTEXT_MENU_DEFINITION } from "./context-menu/index.js";
export {
  createSvgExportArtifact,
  normalizeSvgExportFileName,
  SVG_EXPORT_MIME_TYPE,
  DEFAULT_SVG_EXPORT_FILE_NAME
} from "./export/index.js";
export { EDIT_ACTION_IDS, getEditActionAvailability } from "./edit/action-availability.js";
export { APP_MENU_DEFINITION, APP_MENU_COMMAND_IDS } from "./app-menu/index.js";
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
export type {
  EmitSvgResult,
  EmitSvgOptions,
  SvgViewBox,
  SvgRenderModel,
  SvgRenderPart,
  SvgPatchOp,
  SvgDiffHints
} from "./svg/index.js";
export type { RenderTikzOptions, RenderTikzToSvgResult } from "./render/index.js";
export type { CapabilityMatrix, CapabilityRow, LayerStatus, FeatureId } from "./capabilities/index.js";
export type { DocumentSymbols } from "./completion/index.js";
export type {
  CanvasContextMenuTarget,
  CanvasContextMenuCommandId,
  CanvasContextMenuDefinition
} from "./context-menu/index.js";
export type { SvgExportArtifact, CreateSvgExportArtifactOptions } from "./export/index.js";
export type {
  AppMenuDefinition,
  AppMenuSection,
  AppMenuSectionId,
  AppMenuItem,
  AppMenuCommandItem,
  AppMenuSubmenuItem,
  AppMenuSeparatorItem,
  AppMenuCommandId
} from "./app-menu/index.js";
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
