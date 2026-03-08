export { App } from "./ui/App";
export { APP_MENU_COMMAND_IDS, APP_MENU_DEFINITION } from "./app-menu/index.js";
export { CANVAS_CONTEXT_MENU_DEFINITION } from "./context-menu/index.js";
export { setActiveEditorPlatform, getActiveEditorPlatform } from "./platform/current.js";

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
  CanvasContextMenuTarget,
  CanvasContextMenuCommandId,
  CanvasContextMenuDefinition
} from "./context-menu/index.js";
export type {
  AssistantApi,
  AssistantChatContent,
  AssistantDynamicToolResult,
  AssistantEvent,
  AssistantItem,
  AssistantPendingApproval,
  AssistantThreadState,
  AssistantThreadSummary,
  AssistantTurnStatus,
  EditorPlatform,
  MenuCommandOrigin,
  MenuCommandHandler
} from "./platform/types.js";
export type { DocumentFileRef } from "./store/types.js";
