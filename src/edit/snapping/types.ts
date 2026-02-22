import type { Bounds, Point, SceneElement } from "../../semantic/types.js";

export type Axis = "x" | "y";

export type SnapSettings = {
  thresholdPx: number;
  grid: {
    enabled: boolean;
    minorTargetPx: number;
  };
  points: {
    enabled: boolean;
  };
  gaps: {
    enabled: boolean;
    maxPairsPerAxis: number;
  };
  bypassWithCtrlOrMeta: boolean;
  viewportPaddingPx: number;
};

export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  thresholdPx: 8,
  grid: {
    enabled: true,
    minorTargetPx: 22
  },
  points: {
    enabled: true
  },
  gaps: {
    enabled: true,
    maxPairsPerAxis: 100000
  },
  bypassWithCtrlOrMeta: true,
  viewportPaddingPx: 12
};

export type SnapSettingsPatch = {
  thresholdPx?: number;
  grid?: Partial<SnapSettings["grid"]>;
  points?: Partial<SnapSettings["points"]>;
  gaps?: Partial<SnapSettings["gaps"]>;
  bypassWithCtrlOrMeta?: boolean;
  viewportPaddingPx?: number;
};

export type SnapModifiers = {
  ctrlOrMeta: boolean;
};

export type SnapPoint = Point & {
  sourceId: string;
  role: "corner" | "center";
};

export type SnapBounds = Bounds & {
  sourceId: string;
};

export type Gap = {
  startBounds: SnapBounds;
  endBounds: SnapBounds;
  startSide: [Point, Point];
  endSide: [Point, Point];
  overlap: [number, number];
  length: number;
};

export type SnapContext = {
  zoom: number;
  viewportWorld: Bounds | null;
  selectedSourceIds: string[];
  referencePoints: SnapPoint[];
  referenceBounds: SnapBounds[];
  visibleGaps: {
    horizontal: Gap[];
    vertical: Gap[];
  };
  settings: SnapSettings;
};

export type SnapLine =
  | { type: "points"; axis: Axis; points: Point[] }
  | {
      type: "gap";
      direction: "horizontal" | "vertical";
      gapKind: "center" | "equal";
      segments: Array<[Point, Point]>;
    }
  | { type: "pointer"; axis: Axis; from: Point; to: Point };

export type SnapResult = {
  offset: Point;
  snappedPoint?: Point;
  snappedDelta?: Point;
  lines: SnapLine[];
};

export type SelectionGeometry = {
  bounds: Bounds;
  snapPoints: Point[];
};

export type BuildSnapContextInput = {
  sceneElements: SceneElement[];
  selectedSourceIds: readonly string[];
  zoom: number;
  viewportWorld?: Bounds | null;
  settings?: SnapSettingsPatch;
};

export type SnapSelectionTranslationInput = {
  context: SnapContext;
  selection: SelectionGeometry;
  rawDelta: Point;
  modifiers?: SnapModifiers;
  settings?: SnapSettingsPatch;
  enabledAxis?: Axis | null;
};

export type SnapHandlePositionInput = {
  context: SnapContext;
  point: Point;
  sourceId?: string;
  allowSelfSnap?: boolean;
  modifiers?: SnapModifiers;
  settings?: SnapSettingsPatch;
};

export type SnapKeyboardNudgeInput = {
  context: SnapContext;
  selection: SelectionGeometry;
  anchor: Point | null;
  axis: Axis;
  direction: -1 | 1;
  step: number;
  modifiers?: SnapModifiers;
  settings?: SnapSettingsPatch;
};

export type SnapToolPointerKind = "node" | "line-end" | "rect-corner" | "circle-edge";

export type SnapToolPointerInput = {
  context: SnapContext;
  pointer: Point;
  kind: SnapToolPointerKind;
  anchor?: Point;
  modifiers?: SnapModifiers;
  settings?: SnapSettingsPatch;
};

export type PointSnapCandidate = {
  kind: "point" | "grid";
  axis: Axis;
  from: Point;
  to: Point;
  offset: number;
  key: number;
};

export type GapSnapDirection =
  | "center_horizontal"
  | "center_vertical"
  | "side_left"
  | "side_right"
  | "side_top"
  | "side_bottom";

export type GapSnapCandidate = {
  kind: "gap";
  axis: Axis;
  direction: GapSnapDirection;
  gap: Gap;
  offset: number;
};

export type AxisSnapCandidate = PointSnapCandidate | GapSnapCandidate;

export type AxisSnapBuckets = {
  x: AxisSnapCandidate[];
  y: AxisSnapCandidate[];
};

export type AxisMinOffset = {
  x: number;
  y: number;
};
