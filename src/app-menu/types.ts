export const APP_MENU_COMMAND_IDS = {
  OPEN_EXAMPLE: "file.open-example",
  /**
   * Legacy command id retained for compatibility with custom menu consumers.
   * In the playground UI this command remains a disabled no-op.
   */
  EXPORT_TIKZ: "file.export-tikz",
  EXPORT_SVG_DOWNLOAD: "file.export-svg-download",
  EXPORT_SVG_COPY: "file.export-svg-copy",
  UNDO: "edit.undo",
  REDO: "edit.redo",
  CUT: "edit.cut",
  COPY: "edit.copy",
  PASTE: "edit.paste",
  DELETE: "edit.delete",
  DUPLICATE: "edit.duplicate",
  SEND_TO_BACK: "edit.send-to-back",
  SEND_BACKWARD: "edit.send-backward",
  BRING_FORWARD: "edit.bring-forward",
  BRING_TO_FRONT: "edit.bring-to-front",
  ALIGN_LEFT: "edit.align-left",
  ALIGN_CENTER: "edit.align-center",
  ALIGN_RIGHT: "edit.align-right",
  ALIGN_TOP: "edit.align-top",
  ALIGN_MIDDLE: "edit.align-middle",
  ALIGN_BOTTOM: "edit.align-bottom",
  DISTRIBUTE_HORIZONTAL: "edit.distribute-horizontal",
  DISTRIBUTE_VERTICAL: "edit.distribute-vertical",
  INSERT_NODE: "insert.node",
  INSERT_LINE: "insert.line",
  INSERT_ARROW: "insert.arrow",
  INSERT_RECT: "insert.rect",
  INSERT_ELLIPSE: "insert.ellipse",
  INSERT_CIRCLE: "insert.circle",
  FIT_TO_CONTENT: "view.fit-to-content",
  TOGGLE_GRID: "view.toggle-grid",
  TOGGLE_SNAP_TO_GRID: "view.toggle-snap-to-grid",
  TOGGLE_RULERS: "view.toggle-rulers",
  TOGGLE_GUIDES: "view.toggle-guides",
  TOGGLE_SOURCE_PANEL: "view.toggle-source-panel",
  TOGGLE_INSPECTOR_PANEL: "view.toggle-inspector-panel",
  TOGGLE_DEV_PANEL: "view.toggle-dev-panel"
} as const;

export type AppMenuCommandId = (typeof APP_MENU_COMMAND_IDS)[keyof typeof APP_MENU_COMMAND_IDS];

export type AppMenuSeparatorItem = {
  kind: "separator";
};

export type AppMenuCommandItem = {
  kind: "command";
  commandId: AppMenuCommandId;
  label: string;
  accelerator?: string;
};

export type AppMenuSubmenuItem = {
  kind: "submenu";
  label: string;
  items: readonly AppMenuItem[];
};

export type AppMenuItem = AppMenuSeparatorItem | AppMenuCommandItem | AppMenuSubmenuItem;

export type AppMenuSectionId = "file" | "edit" | "insert" | "view";

export type AppMenuSection = {
  id: AppMenuSectionId;
  label: string;
  items: readonly AppMenuItem[];
};

export type AppMenuDefinition = readonly AppMenuSection[];
