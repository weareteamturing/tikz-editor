import type { AdornmentOwnerGeometry, Span, Statement } from "tikz-editor/ast/types";
import type { ResizeRole } from "tikz-editor/edit/actions";
import type { SelectionGeometry, SnapContext, SnapLine } from "tikz-editor/edit/snapping";
import type { EditHandle, NodeAnchorTarget, Point, SceneElement, SceneText } from "tikz-editor/semantic/types";
import type { SvgViewBox } from "tikz-editor/svg/index";

import type { CanvasTransform } from "../../store/types";
import type { ToolCreateMode } from "../tool-config";
import type { HitRegion } from "./hit-regions";

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type GridResizeSnapConfig = {
  anchorWorld: Point;
  stepX: number;
  stepY: number;
  transform: EditHandle["transform"];
};

export type DragState =
  | {
      kind: "element";
      pointerId: number;
      elementIds: string[];
      startWorld: Point;
      adornmentDrag?: {
        ownerPoint: Point;
        ownerGeometry?: AdornmentOwnerGeometry;
        allowCenter: boolean;
        defaultDistancePt: number;
      };
      snapContext: SnapContext | null;
      initialSelection: SelectionGeometry | null;
      selectionAnchorRatio: { x: number; y: number } | null;
      historyMergeKey: string;
    }
  | {
      kind: "resize";
      pointerId: number;
      elementId: string;
      role: ResizeRole;
      cursor: string;
      preserveAspectRatio: number | null;
      historyMergeKey: string;
    }
  | {
      kind: "rotate";
      pointerId: number;
      elementId: string;
      cursor: string;
      centerWorld: Point;
      startPointerAngleDeg: number;
      baseRotateDeg: number;
      lastAppliedRotateDeg: number;
      historyMergeKey: string;
    }
  | {
      kind: "handle";
      pointerId: number;
      handleId: string;
      sourceId: string;
      handleKind: EditHandle["kind"];
      cursor: string;
      lastKnownWorld: Point;
      snapContext: SnapContext | null;
      gridResizeSnap: GridResizeSnapConfig | null;
      historyMergeKey: string;
      activeEndpointAnchor: NodeAnchorTarget | null;
    }
  | {
      kind: "pan";
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startTransform: CanvasTransform;
    }
  | {
      kind: "marquee";
      pointerId: number;
      startWorld: Point;
      currentWorld: Point;
      additive: boolean;
      baseSelectedIds: string[];
    }
  | {
      kind: "tool-create";
      pointerId: number;
      toolMode: ToolCreateMode;
      startWorld: Point;
      startEndpointAnchor: NodeAnchorTarget | null;
      rawCurrentWorld: Point;
      currentWorld: Point;
      activeEndpointAnchor: NodeAnchorTarget | null;
      snapContext: SnapContext | null;
    }
  | {
      kind: "tool-bezier-bend";
      pointerId: number;
      startWorld: Point;
      endWorld: Point;
      rawCurrentWorld: Point;
      currentWorld: Point;
      snapContext: SnapContext | null;
    }
  | {
      kind: "text-select";
      pointerId: number;
      sourceId: string;
      sourceSpan: Span;
      textLength: number;
      totalWidth: number;
      fontSizePt: number;
      rotation: number;
      cx: number;
      cy: number;
      width: number;
      height: number;
      anchorIndex: number;
      headIndex: number;
      prefixTable: readonly number[] | null;
    };

export type PendingAddedSelection = {
  beforeIds: Set<string>;
  preferredWorld: Point;
};

export type PendingBezier = {
  startWorld: Point;
  endWorld: Point;
};

export type TextSelectionOverlay = {
  sourceId: string;
  textLength: number;
  totalWidth: number;
  fontSizePt: number;
  startIndex: number;
  endIndex: number;
  rotation: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
  prefixTable: readonly number[] | null;
};

export type TextEditingSession = {
  sourceId: string;
  anchorIndex: number;
  headIndex: number;
  /** Absolute source offsets from the latest CodeMirror selection, used to
   *  re-derive text-relative indices when the snapshot catches up after an edit. */
  anchorOffset: number | null;
  headOffset: number | null;
};

export type NodeAnchorOverlayState = {
  visibleAnchors: NodeAnchorTarget[];
  snappedAnchor: NodeAnchorTarget | null;
};

export type EditableTextTarget = {
  sourceId: string;
  sourceSpan: Span;
  text: string;
  style: SceneText["style"];
  totalWidth: number;
  region: Extract<HitRegion, { shape: "rect" }>;
};

export type TextIndexMappingTarget = {
  textLength: number;
  totalWidth: number;
  region: Extract<HitRegion, { shape: "rect" }>;
};

export type SnapDebugLogInput = {
  phase: string;
  note?: string;
  snapshotMatchesSource: boolean;
  dragKind: DragState["kind"] | null;
  context?: SnapContext | null;
  rawPoint?: Point | null;
  rawDelta?: Point | null;
  snappedPoint?: Point | null;
  snappedDelta?: Point | null;
  offset?: Point | null;
  lines?: readonly SnapLine[];
};

export type ApplyActionFeedback = {
  sourceChanged: boolean;
};

export type SelectionBounds = {
  sourceId: string;
  bounds: Bounds;
};

export type SourceBoundsMap = ReadonlyMap<string, Bounds>;

export type SceneSnapshot = { elements: SceneElement[] } | null;

export type SvgSnapshot = { viewBox: SvgViewBox } | null;

export type StatementList = readonly Statement[];
