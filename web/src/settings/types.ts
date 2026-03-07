export type EditorSettings = {
  wordWrap: boolean;
  fontSize: number;
  lineNumbers: boolean;
};

export type ColorPickerAccuracy = "approximate" | "exact";

export type GridSize = "fine" | "standard" | "coarse";

export type CanvasSettings = {
  gridSize: GridSize;
};

export type AppSettings = {
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
  editor: {
    wordWrap: false,
    fontSize: 13,
    lineNumbers: true
  },
  canvas: {
    gridSize: "standard"
  },
  colorPicker: {
    accuracy: "approximate"
  }
};
