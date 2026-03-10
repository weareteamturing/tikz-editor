export const APP_MENU_COMMAND_IDS = {
  NEW_DOCUMENT: "file.new-document",
  OPEN_DOCUMENT: "file.open-document",
  IMPORT_SVG: "file.import-svg",
  SAVE_DOCUMENT: "file.save-document",
  SAVE_DOCUMENT_AS: "file.save-document-as",
  CLOSE_DOCUMENT: "file.close-document",
  CLOSE_ALL_DOCUMENTS: "file.close-all-documents",
  OPEN_EXAMPLE: "file.open-example",
  EXPORT_SVG_DOWNLOAD: "file.export-svg-download",
  EXPORT_STANDALONE_LATEX_DOWNLOAD: "file.export-standalone-latex-download",
  EXPORT_PDF_DOWNLOAD: "file.export-pdf-download",
  EXPORT_PNG_DOWNLOAD: "file.export-png-download",
  EXPORT_SVG_COPY: "file.export-svg-copy",
  UNDO: "edit.undo",
  REDO: "edit.redo",
  FORMAT_TIKZ: "edit.format-tikz",
  CUT: "edit.cut",
  COPY: "edit.copy",
  PASTE: "edit.paste",
  DELETE: "edit.delete",
  DUPLICATE: "edit.duplicate",
  ROTATE_LEFT_90: "edit.rotate-left-90",
  ROTATE_RIGHT_90: "edit.rotate-right-90",
  FLIP_HORIZONTAL: "edit.flip-horizontal",
  FLIP_VERTICAL: "edit.flip-vertical",
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
  INSERT_PATH: "insert.path",
  INSERT_FREEHAND: "insert.freehand",
  INSERT_LINE: "insert.line",
  INSERT_ARROW: "insert.arrow",
  INSERT_BEZIER: "insert.bezier",
  INSERT_GRID: "insert.grid",
  INSERT_RECT: "insert.rect",
  INSERT_ELLIPSE: "insert.ellipse",
  INSERT_CIRCLE: "insert.circle",
  ADD_LABEL: "insert.add-label",
  ADD_PIN: "insert.add-pin",
  FIT_TO_CONTENT: "view.fit-to-content",
  TOGGLE_GRID: "view.toggle-grid",
  TOGGLE_SNAP_TO_GRID: "view.toggle-snap-to-grid",
  TOGGLE_RULERS: "view.toggle-rulers",
  TOGGLE_GUIDES: "view.toggle-guides",
  TOGGLE_SOURCE_PANEL: "view.toggle-source-panel",
  TOGGLE_INSPECTOR_PANEL: "view.toggle-inspector-panel",
  TOGGLE_ASSISTANT_PANEL: "view.toggle-assistant-panel",
  INTERRUPT_ASSISTANT_TURN: "view.interrupt-assistant-turn",
  TOGGLE_DEV_PANEL: "view.toggle-dev-panel",
  OPEN_PGF_TIKZ_MANUAL: "help.open-pgf-tikz-manual",
  SHOW_COMPILED_PICTURE: "file.show-compiled-picture",
  OPEN_SETTINGS: "file.open-settings"
} as const;

export type AppMenuCommandId = (typeof APP_MENU_COMMAND_IDS)[keyof typeof APP_MENU_COMMAND_IDS];

export type AppMenuPlatformTarget = "web" | "desktop";

type AppMenuPlatformScoped = {
  platforms?: readonly AppMenuPlatformTarget[];
};

export type AppMenuSeparatorItem = {
  kind: "separator";
} & AppMenuPlatformScoped;

export type AppMenuCommandItem = {
  kind: "command";
  commandId: AppMenuCommandId;
  label: string;
  accelerator?: string;
} & AppMenuPlatformScoped;

export type AppMenuSubmenuItem = {
  kind: "submenu";
  label: string;
  items: readonly AppMenuItem[];
} & AppMenuPlatformScoped;

export type AppMenuRecentFilesItem = {
  kind: "recent-files";
  label: string;
} & AppMenuPlatformScoped;

export type AppMenuItem = AppMenuSeparatorItem | AppMenuCommandItem | AppMenuSubmenuItem | AppMenuRecentFilesItem;

export type AppMenuSectionId = "file" | "edit" | "insert" | "view" | "help";

export type AppMenuSection = {
  id: AppMenuSectionId;
  label: string;
  items: readonly AppMenuItem[];
} & AppMenuPlatformScoped;

export type AppMenuDefinition = readonly AppMenuSection[];
