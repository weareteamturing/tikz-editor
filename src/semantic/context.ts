import type { OptionListAst } from "../options/types.js";
import type { NodeTextEngine } from "../text/types.js";
import type { MacroBinding, MacroExpansionTraceEvent } from "../macros/index.js";
import type { EditHandle, Point, Matrix2D, ResolvedStyle, SceneElement } from "./types.js";
import type { CustomStyleRegistry } from "./style/custom-styles.js";
import { createDefaultCustomStyleRegistry } from "./style/custom-styles.js";
import { computeSourceFingerprint } from "../utils/source-fingerprint.js";
import type { StyleChainEntry, StyleSourceRef } from "./style-chain.js";
import { cloneResolvedStyle } from "./style-chain.js";

export type NodeLayerMode = "front" | "behind";
export type NodeDistanceValue =
  | {
      kind: "dimension";
      value: number;
    }
  | {
      kind: "number";
      value: number;
    };

export type NodeDistanceSpec =
  | {
      kind: "single";
      value: NodeDistanceValue;
    }
  | {
      kind: "pair";
      vertical: NodeDistanceValue;
      horizontal: NodeDistanceValue;
    };

export type NodeQuotesMode = "label" | "pin";

export type NamedNodeGeometry = {
  shape:
    | "rectangle"
    | "circle"
    | "ellipse"
    | "diamond"
    | "trapezium"
    | "semicircle"
    | "regular polygon"
    | "star"
    | "isosceles triangle"
    | "kite"
    | "dart"
    | "circular sector"
    | "cylinder"
    | "cloud"
    | "starburst"
    | "signal"
    | "tape"
    | "rectangle callout"
    | "ellipse callout"
    | "cloud callout"
    | "single arrow"
    | "double arrow"
    | "coordinate";
  center: Point;
  anchorHalfWidth: number;
  anchorHalfHeight: number;
  anchorRadius: number;
  diamondAspect?: number;
  trapeziumLeftAngle?: number;
  trapeziumRightAngle?: number;
  shapeBorderRotate?: number;
  trapeziumStretches?: boolean;
  trapeziumStretchesBody?: boolean;
  anchorPolygon?: Point[];
};

export type ProvenanceOptionList = {
  options: OptionListAst;
  sourceRef: StyleSourceRef;
};

export type SemanticContextFrame = {
  style: ResolvedStyle;
  styleChain: StyleChainEntry[];
  transform: Matrix2D;
  customStyles: CustomStyleRegistry;
  colorAliases: Map<string, string>;
  macroBindings: Map<string, MacroBinding>;
  namePrefix: string;
  nameSuffix: string;
  nodeLayerMode: NodeLayerMode;
  onGrid: boolean;
  nodeDistance: NodeDistanceSpec;
  nodeQuotesMode: NodeQuotesMode;
  labelPosition: string;
  pinPosition: string;
  labelDistancePt: number;
  pinDistancePt: number;
  pinEdgeRaw: string | null;
  transformShape: boolean;
  everyNodeStyles: ProvenanceOptionList[];
  everyRectangleNodeStyles: ProvenanceOptionList[];
  everyCircleNodeStyles: ProvenanceOptionList[];
  everyDiamondNodeStyles: ProvenanceOptionList[];
  everyTrapeziumNodeStyles: ProvenanceOptionList[];
  everyIsoscelesTriangleNodeStyles: ProvenanceOptionList[];
  everyKiteNodeStyles: ProvenanceOptionList[];
  everyDartNodeStyles: ProvenanceOptionList[];
  everyCircularSectorNodeStyles: ProvenanceOptionList[];
  everyCylinderNodeStyles: ProvenanceOptionList[];
  everyCloudNodeStyles: ProvenanceOptionList[];
  everyStarburstNodeStyles: ProvenanceOptionList[];
  everySignalNodeStyles: ProvenanceOptionList[];
  everyTapeNodeStyles: ProvenanceOptionList[];
  everyRectangleCalloutNodeStyles: ProvenanceOptionList[];
  everyEllipseCalloutNodeStyles: ProvenanceOptionList[];
  everyCloudCalloutNodeStyles: ProvenanceOptionList[];
  everySingleArrowNodeStyles: ProvenanceOptionList[];
  everyDoubleArrowNodeStyles: ProvenanceOptionList[];
};

export type SemanticContext = {
  stack: SemanticContextFrame[];
  source: string;
  sourceFingerprint: string;
  namedCoordinates: Map<string, Point>;
  namedCoordinateRewriteHandles: Map<string, string>;
  namedNodeGeometries: Map<string, NamedNodeGeometry>;
  namedPaths: Map<string, SceneElement[]>;
  currentPoint: Point | null;
  pathStartPoint: Point | null;
  textEngine: NodeTextEngine | null;
  macroTraceCollector: MacroExpansionTraceEvent[] | null;
  editHandles: EditHandle[];
};

export function createSemanticContext(
  initialStyle: ResolvedStyle,
  initialTransform: Matrix2D,
  textEngine: NodeTextEngine | null = null,
  source = ""
): SemanticContext {
  const defaultNodeDistance = 28.4527559055;
  const clonedStyle = cloneResolvedStyle(initialStyle);
  const defaultGlobalSource: StyleSourceRef = {
    sourceId: "__global__",
    sourceKind: "global-default",
    label: "TikZ defaults"
  };
  return {
    stack: [
      {
        style: clonedStyle,
        styleChain: [
          {
            kind: "global",
            sourceRef: defaultGlobalSource,
            rawOptions: [],
            before: cloneResolvedStyle(clonedStyle),
            after: cloneResolvedStyle(clonedStyle),
            resolvedContributions: cloneResolvedStyle(clonedStyle)
          }
        ],
        transform: initialTransform,
        customStyles: createDefaultCustomStyleRegistry(),
        colorAliases: new Map(),
        macroBindings: new Map(),
        namePrefix: "",
        nameSuffix: "",
        nodeLayerMode: "front",
        onGrid: false,
        nodeDistance: {
          kind: "pair",
          vertical: { kind: "dimension", value: defaultNodeDistance },
          horizontal: { kind: "dimension", value: defaultNodeDistance }
        },
        nodeQuotesMode: "label",
        labelPosition: "above",
        pinPosition: "above",
        labelDistancePt: 0,
        pinDistancePt: 12.9,
        pinEdgeRaw: null,
        transformShape: false,
        everyNodeStyles: [],
        everyRectangleNodeStyles: [],
        everyCircleNodeStyles: [],
        everyDiamondNodeStyles: [],
        everyTrapeziumNodeStyles: [],
        everyIsoscelesTriangleNodeStyles: [],
        everyKiteNodeStyles: [],
        everyDartNodeStyles: [],
        everyCircularSectorNodeStyles: [],
        everyCylinderNodeStyles: [],
        everyCloudNodeStyles: [],
        everyStarburstNodeStyles: [],
        everySignalNodeStyles: [],
        everyTapeNodeStyles: [],
        everyRectangleCalloutNodeStyles: [],
        everyEllipseCalloutNodeStyles: [],
        everyCloudCalloutNodeStyles: [],
        everySingleArrowNodeStyles: [],
        everyDoubleArrowNodeStyles: []
      }
    ],
    source,
    sourceFingerprint: computeSourceFingerprint(source),
    namedCoordinates: new Map<string, Point>(),
    namedCoordinateRewriteHandles: new Map<string, string>(),
    namedNodeGeometries: new Map<string, NamedNodeGeometry>(),
    namedPaths: new Map<string, SceneElement[]>(),
    currentPoint: null,
    pathStartPoint: null,
    textEngine,
    macroTraceCollector: null,
    editHandles: []
  };
}

export function currentFrame(context: SemanticContext): SemanticContextFrame {
  return context.stack[context.stack.length - 1];
}

export function pushFrame(context: SemanticContext, frame: SemanticContextFrame): void {
  context.stack.push(frame);
}

export function popFrame(context: SemanticContext): void {
  if (context.stack.length > 1) {
    context.stack.pop();
  }
}
