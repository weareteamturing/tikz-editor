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

const TRANSFORM_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ROTATE_LEFT_90,
    label: "Rotate Left 90°"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ROTATE_RIGHT_90,
    label: "Rotate Right 90°"
  },
  { kind: "separator" },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.FLIP_HORIZONTAL,
    label: "Flip Horizontally"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.FLIP_VERTICAL,
    label: "Flip Vertically"
  }
];

const PATH_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_SPLIT,
    label: "Split Path"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_JOIN,
    label: "Join Paths"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_REVERSE,
    label: "Reverse Path"
  },
  { kind: "separator" },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_CLOSE,
    label: "Close Path"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_OPEN,
    label: "Open Path"
  },
  { kind: "separator" },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_DELETE_POINT,
    label: "Delete Point"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_POINT_CORNER,
    label: "Point to Corner"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_POINT_SMOOTH,
    label: "Point to Smooth"
  }
];

const SNAP_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GRID,
    label: "Snap to Grid"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GUIDES,
    label: "Snap to Guides"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_POINTS,
    label: "Snap to Object Points"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_GAPS,
    label: "Snap to Object Gaps"
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
      commandId: APP_MENU_COMMAND_IDS.TOGGLE_RULERS,
      label: "Rulers"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.TOGGLE_GUIDES,
      label: "Guide Lines"
    },
    {
      kind: "submenu",
      label: "Snapping",
      items: SNAP_ITEMS
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
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.GROUP,
      label: "Group",
      accelerator: "CmdOrCtrl+G"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.UNGROUP,
      label: "Ungroup",
      accelerator: "CmdOrCtrl+Shift+G"
    },
    { kind: "separator" },
    {
      kind: "submenu",
      label: "Transform",
      items: TRANSFORM_ITEMS
    },
    { kind: "separator" },
    {
      kind: "submenu",
      label: "Path",
      items: PATH_ITEMS
    },
    { kind: "separator" },
    {
      kind: "submenu",
      label: "Reorder",
      items: REORDER_ITEMS
    }
  ],
  "selection-single-node": [
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
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.GROUP,
      label: "Group",
      accelerator: "CmdOrCtrl+G"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.UNGROUP,
      label: "Ungroup",
      accelerator: "CmdOrCtrl+Shift+G"
    },
    { kind: "separator" },
    {
      kind: "submenu",
      label: "Transform",
      items: TRANSFORM_ITEMS
    },
    { kind: "separator" },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.ADD_LABEL,
      label: "Add Label"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.ADD_PIN,
      label: "Add Pin"
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
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.GROUP,
      label: "Group",
      accelerator: "CmdOrCtrl+G"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.UNGROUP,
      label: "Ungroup",
      accelerator: "CmdOrCtrl+Shift+G"
    },
    { kind: "separator" },
    {
      kind: "submenu",
      label: "Align",
      items: ALIGN_ITEMS
    },
    {
      kind: "submenu",
      label: "Transform",
      items: TRANSFORM_ITEMS
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
