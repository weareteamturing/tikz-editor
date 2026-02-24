import type { NodeItem, PathItem } from "../../ast/types.js";
import type { SemanticContext } from "../context.js";
import { evaluateCoordinate } from "../coords/evaluate.js";
import type { Point, ScenePathCommand } from "../types.js";
import type { PlacementSegment } from "./types.js";

const SIN_CONTROL_1_X = 0.326;
const SIN_CONTROL_1_Y = 0.512;
const SIN_CONTROL_2_X = 0.638;
const SIN_CONTROL_2_Y = 1;
const COS_CONTROL_1_X = 0.362;
const COS_CONTROL_1_Y = 0;
const COS_CONTROL_2_X = 0.674;
const COS_CONTROL_2_Y = 0.488;

export function parseBezierFromItems(
  items: PathItem[],
  startIndex: number,
  context: SemanticContext
): {
  consumedIndex: number;
  control1: Point;
  control2: Point;
  nodes: NodeItem[];
  endPoint: Point | null;
  endAdvancesCurrentPoint: boolean;
  endClosesPath: boolean;
  usedAnd: boolean;
} | null {
  let cursor = startIndex + 1;
  const controlsKeyword = items[cursor];
  if (!controlsKeyword || controlsKeyword.kind !== "PathKeyword" || controlsKeyword.keyword !== "controls") {
    return null;
  }
  cursor += 1;

  const control1Item = items[cursor];
  if (!control1Item || control1Item.kind !== "Coordinate") {
    return null;
  }
  const control1Eval = evaluateCoordinate(control1Item, context);
  if (!control1Eval.world) {
    return null;
  }
  cursor += 1;

  let usedAnd = false;
  let control2 = control1Eval.world;

  const maybeAnd = items[cursor];
  if (maybeAnd && maybeAnd.kind === "PathKeyword" && maybeAnd.keyword === "and") {
    usedAnd = true;
    cursor += 1;
    const control2Item = items[cursor];
    if (!control2Item || control2Item.kind !== "Coordinate") {
      return null;
    }
    const control2Eval = evaluateCoordinate(control2Item, context);
    if (!control2Eval.world) {
      return null;
    }
    control2 = control2Eval.world;
    cursor += 1;
  }

  const closingDots = items[cursor];
  if (!closingDots || closingDots.kind !== "PathKeyword" || closingDots.keyword !== "..") {
    return null;
  }
  cursor += 1;

  const nodes: NodeItem[] = [];
  while (cursor < items.length) {
    const maybeNode = items[cursor];
    if (!maybeNode || maybeNode.kind !== "Node") {
      break;
    }
    nodes.push(maybeNode);
    cursor += 1;
  }

  const targetItem = items[cursor];
  if (!targetItem) {
    return null;
  }

  if (targetItem.kind === "PathKeyword" && targetItem.keyword === "cycle") {
    return {
      consumedIndex: cursor,
      control1: control1Eval.world,
      control2,
      nodes,
      endPoint: context.pathStartPoint,
      endAdvancesCurrentPoint: true,
      endClosesPath: true,
      usedAnd
    };
  }

  if (targetItem.kind !== "Coordinate") {
    return null;
  }
  const targetEval = evaluateCoordinate(targetItem, context);

  return {
    consumedIndex: cursor,
    control1: control1Eval.world,
    control2,
    nodes,
    endPoint: targetEval.world,
    endAdvancesCurrentPoint: targetEval.advancesCurrentPoint,
    endClosesPath: false,
    usedAnd
  };
}

export function appendSinCosSegment(commands: ScenePathCommand[], from: Point, to: Point, mode: "sin" | "cos"): PlacementSegment {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const c1 =
    mode === "sin"
      ? {
          x: from.x + SIN_CONTROL_1_X * dx,
          y: from.y + SIN_CONTROL_1_Y * dy
        }
      : {
          x: from.x + COS_CONTROL_1_X * dx,
          y: from.y + COS_CONTROL_1_Y * dy
        };
  const c2 =
    mode === "sin"
      ? {
          x: from.x + SIN_CONTROL_2_X * dx,
          y: from.y + SIN_CONTROL_2_Y * dy
        }
      : {
          x: from.x + COS_CONTROL_2_X * dx,
          y: from.y + COS_CONTROL_2_Y * dy
        };

  commands.push({ kind: "C", c1, c2, to });
  return { kind: "cubic", from, c1, c2, to };
}
