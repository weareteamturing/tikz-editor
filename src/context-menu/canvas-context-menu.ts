import { APP_MENU_COMMAND_IDS, type AppMenuItem } from "../app-menu/types.js";
import type { CanvasContextMenuDefinition } from "./types.js";

const REORDER_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.SEND_TO_BACK,
    label: "Send to Back"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.SEND_BACKWARD,
    label: "Send Backward"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.BRING_FORWARD,
    label: "Bring Forward"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.BRING_TO_FRONT,
    label: "Bring to Front"
  }
];

const ALIGN_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ALIGN_LEFT,
    label: "Left"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ALIGN_CENTER,
    label: "Center"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ALIGN_RIGHT,
    label: "Right"
  },
  { kind: "separator" },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ALIGN_TOP,
    label: "Top"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ALIGN_MIDDLE,
    label: "Middle"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ALIGN_BOTTOM,
    label: "Bottom"
  }
];

const DISTRIBUTE_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.DISTRIBUTE_HORIZONTAL,
    label: "Horizontal"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.DISTRIBUTE_VERTICAL,
    label: "Vertical"
  }
];

export const CANVAS_CONTEXT_MENU_DEFINITION = {
  "canvas-empty": [
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.UNDO,
      label: "Undo",
      accelerator: "CmdOrCtrl+Z"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.REDO,
      label: "Redo",
      accelerator: "CmdOrCtrl+Shift+Z"
    },
    { kind: "separator" },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.PASTE,
      label: "Paste",
      accelerator: "CmdOrCtrl+V"
    },
    { kind: "separator" },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.FIT_TO_CONTENT,
      label: "Fit to Content"
    },
    { kind: "separator" },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.TOGGLE_GRID,
      label: "Grid"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.TOGGLE_SNAP_TO_GRID,
      label: "Snap to Grid"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.TOGGLE_RULERS,
      label: "Rulers"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.TOGGLE_GUIDES,
      label: "Guide Lines"
    }
  ],
  "selection-single": [
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.UNDO,
      label: "Undo",
      accelerator: "CmdOrCtrl+Z"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.REDO,
      label: "Redo",
      accelerator: "CmdOrCtrl+Shift+Z"
    },
    { kind: "separator" },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.CUT,
      label: "Cut",
      accelerator: "CmdOrCtrl+X"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.COPY,
      label: "Copy",
      accelerator: "CmdOrCtrl+C"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.PASTE,
      label: "Paste",
      accelerator: "CmdOrCtrl+V"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.DELETE,
      label: "Delete",
      accelerator: "Delete"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.DUPLICATE,
      label: "Duplicate",
      accelerator: "CmdOrCtrl+D"
    },
    { kind: "separator" },
    {
      kind: "submenu",
      label: "Reorder",
      items: REORDER_ITEMS
    }
  ],
  "selection-multi": [
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.UNDO,
      label: "Undo",
      accelerator: "CmdOrCtrl+Z"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.REDO,
      label: "Redo",
      accelerator: "CmdOrCtrl+Shift+Z"
    },
    { kind: "separator" },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.CUT,
      label: "Cut",
      accelerator: "CmdOrCtrl+X"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.COPY,
      label: "Copy",
      accelerator: "CmdOrCtrl+C"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.PASTE,
      label: "Paste",
      accelerator: "CmdOrCtrl+V"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.DELETE,
      label: "Delete",
      accelerator: "Delete"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.DUPLICATE,
      label: "Duplicate",
      accelerator: "CmdOrCtrl+D"
    },
    { kind: "separator" },
    {
      kind: "submenu",
      label: "Align",
      items: ALIGN_ITEMS
    },
    {
      kind: "submenu",
      label: "Distribute",
      items: DISTRIBUTE_ITEMS
    },
    {
      kind: "submenu",
      label: "Reorder",
      items: REORDER_ITEMS
    }
  ]
} as const satisfies CanvasContextMenuDefinition;
