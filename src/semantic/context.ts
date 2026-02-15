import type { OptionListAst } from "../options/types.js";
import type { NodeTextEngine } from "../text/types.js";
import type { MacroBinding, MacroExpansionTraceEvent } from "../macros/index.js";
import type { Point, Matrix2D, ResolvedStyle, SceneElement } from "./types.js";
import type { CustomStyleRegistry } from "./style/custom-styles.js";
import { createDefaultCustomStyleRegistry } from "./style/custom-styles.js";

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

export type SemanticContextFrame = {
  style: ResolvedStyle;
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
  everyNodeStyles: OptionListAst[];
  everyRectangleNodeStyles: OptionListAst[];
  everyCircleNodeStyles: OptionListAst[];
  everyDiamondNodeStyles: OptionListAst[];
  everyTrapeziumNodeStyles: OptionListAst[];
  everyIsoscelesTriangleNodeStyles: OptionListAst[];
  everyKiteNodeStyles: OptionListAst[];
  everyDartNodeStyles: OptionListAst[];
  everyCircularSectorNodeStyles: OptionListAst[];
  everyCylinderNodeStyles: OptionListAst[];
  everyCloudNodeStyles: OptionListAst[];
  everyStarburstNodeStyles: OptionListAst[];
  everySignalNodeStyles: OptionListAst[];
  everyTapeNodeStyles: OptionListAst[];
  everyRectangleCalloutNodeStyles: OptionListAst[];
  everyEllipseCalloutNodeStyles: OptionListAst[];
  everyCloudCalloutNodeStyles: OptionListAst[];
  everySingleArrowNodeStyles: OptionListAst[];
  everyDoubleArrowNodeStyles: OptionListAst[];
};

export type SemanticContext = {
  stack: SemanticContextFrame[];
  namedCoordinates: Map<string, Point>;
  namedNodeGeometries: Map<string, NamedNodeGeometry>;
  namedPaths: Map<string, SceneElement[]>;
  currentPoint: Point | null;
  pathStartPoint: Point | null;
  textEngine: NodeTextEngine | null;
  macroTraceCollector: MacroExpansionTraceEvent[] | null;
};

export function createSemanticContext(
  initialStyle: ResolvedStyle,
  initialTransform: Matrix2D,
  textEngine: NodeTextEngine | null = null
): SemanticContext {
  const defaultNodeDistance = 28.4527559055;
  return {
    stack: [
      {
        style: initialStyle,
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
    namedCoordinates: new Map<string, Point>(),
    namedNodeGeometries: new Map<string, NamedNodeGeometry>(),
    namedPaths: new Map<string, SceneElement[]>(),
    currentPoint: null,
    pathStartPoint: null,
    textEngine,
    macroTraceCollector: null
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
