import { APP_MENU_COMMAND_IDS, type AppMenuDefinition } from "./types.js";

export const APP_MENU_DEFINITION = [
  {
    id: "file",
    label: "File",
    items: [
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.OPEN_EXAMPLE,
        label: "Open Example..."
      },
      { kind: "separator" },
      {
        kind: "submenu",
        label: "Export",
        items: [
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD,
            label: "SVG"
          },
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.EXPORT_STANDALONE_LATEX_DOWNLOAD,
            label: "Standalone LaTeX"
          },
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.EXPORT_PDF_DOWNLOAD,
            label: "PDF"
          },
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.EXPORT_PNG_DOWNLOAD,
            label: "PNG"
          }
        ]
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.EXPORT_SVG_COPY,
        label: "Copy as SVG"
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.SHOW_COMPILED_PICTURE,
        label: "Show Compiled Picture"
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.OPEN_SETTINGS,
        label: "Settings..."
      }
    ]
  },
  {
    id: "edit",
    label: "Edit",
    items: [
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
        commandId: APP_MENU_COMMAND_IDS.FORMAT_TIKZ,
        label: "Format TikZ Code",
        accelerator: "CmdOrCtrl+Shift+F"
      },
      { kind: "separator" },
      {
        kind: "submenu",
        label: "Align",
        items: [
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
        ]
      },
      {
        kind: "submenu",
        label: "Distribute",
        items: [
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
        ]
      },
      {
        kind: "submenu",
        label: "Reorder",
        items: [
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
        ]
      }
    ]
  },
  {
    id: "insert",
    label: "Insert",
    items: [
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_NODE,
        label: "Node",
        accelerator: "N"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_LINE,
        label: "Line",
        accelerator: "L"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_ARROW,
        label: "Arrow",
        accelerator: "A"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_BEZIER,
        label: "Bezier",
        accelerator: "B"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_GRID,
        label: "Grid"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_RECT,
        label: "Rectangle",
        accelerator: "R"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_ELLIPSE,
        label: "Ellipse",
        accelerator: "E"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_CIRCLE,
        label: "Circle",
        accelerator: "C"
      }
    ]
  },
  {
    id: "view",
    label: "View",
    items: [
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
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_SOURCE_PANEL,
        label: "Source Panel"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_INSPECTOR_PANEL,
        label: "Inspector Panel"
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_DEV_PANEL,
        label: "Developer Panel",
        accelerator: "CmdOrCtrl+Shift+D"
      }
    ]
  }
] as const satisfies AppMenuDefinition;
