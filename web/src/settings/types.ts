export type EditorSettings = {
  wordWrap: boolean;
  fontSize: number;
  lineNumbers: boolean;
  indentSize: 2 | 4;
};

export type ColorPickerAccuracy = "approximate" | "exact";

export type GridSize = "fine" | "standard" | "coarse";

export type GeneralSettings = {
  uiFontSizePx: number;
};

export type CanvasSettings = {
  gridSize: GridSize;
  handleSizePx: number;
  zoomSpeed: number;
};

export type AppSettings = {
  general: GeneralSettings;
  editor: EditorSettings;
  canvas: CanvasSettings;
  colorPicker: {
    accuracy: ColorPickerAccuracy;
  };
};

export const GRID_SIZE_MINOR_TARGET_PX: Record<GridSize, number> = {
  fine: 12,
  standard: 22,
  coarse: 44
};

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    uiFontSizePx: 11
  },
  editor: {
    wordWrap: false,
    fontSize: 12,
    lineNumbers: true,
    indentSize: 2
  },
  canvas: {
    gridSize: "standard",
    handleSizePx: 9,
    zoomSpeed: 0.0045
  },
  colorPicker: {
    accuracy: "approximate"
  }
};
