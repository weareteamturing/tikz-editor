import type { SyntaxNode } from "@lezer/common";

import {
  coordinateOperationItemId,
  letOperationItemId,
  svgOperationItemId,
  toOperationItemId
} from "../../ast/ids.js";
import type {
  CoordinateOperationItem,
  LetOperationItem,
  NodeItem,
  Span,
  SvgOperationItem,
  ToOperationTarget,
  ToOperationItem
} from "../../ast/types.js";
import { parseCoordinate } from "../coordinates/parse.js";
import { parseOptionListRaw } from "../../options/parse.js";
import { findFirstChildByName, firstNamedChild } from "../../syntax/cursor.js";
import { mapNodeItem } from "../nodes/parse.js";

export function mapToOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): ToOperationItem {
  const optionsNode = findFirstChildByName(node, "OptionList");
  const target = mapToOperationTarget(node, source);
  const nodes = mapToOperationNodes(node, source, statementIndex, itemIndex);

  return {
    kind: "ToOperation",
    id: toOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    optionsSpan: toSpan(optionsNode),
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    nodes: nodes.length > 0 ? nodes : undefined,
    target,
    raw: source.slice(node.from, node.to)
  };
}

export function mapSvgOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): SvgOperationItem {
  const optionsNode = findFirstChildByName(node, "OptionList");
  const payloadNode = findSvgPayloadNode(node);

  return {
    kind: "SvgOperation",
    id: svgOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    optionsSpan: toSpan(optionsNode),
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    dataSpan: toSpan(payloadNode),
    dataRaw: payloadNode ? source.slice(payloadNode.from, payloadNode.to) : ""
  };
}

export function mapLetOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): LetOperationItem {
  return {
    kind: "LetOperation",
    id: letOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to)
  };
}

export function mapCoordinateOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): CoordinateOperationItem {
  const optionsNode = findFirstChildByName(node, "OptionList");
  const nameNode = findFirstChildByName(node, "Coordinate");
  const name = parseCoordinateOperationName(nameNode, source);

  return {
    kind: "CoordinateOperation",
    id: coordinateOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    optionsSpan: toSpan(optionsNode),
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    name,
    nameSpan: toSpan(nameNode),
    placementSpan: undefined,
    raw: source.slice(node.from, node.to)
  };
}

function mapToOperationTarget(node: SyntaxNode, source: string): ToOperationTarget | undefined {
  const targetNode = findFirstChildByName(node, "ToTarget");
  if (!targetNode) {
    return undefined;
  }

  const cycleNode = findFirstChildByName(targetNode, "CycleKw");
  if (cycleNode) {
    return {
      kind: "cycle",
      span: { from: cycleNode.from, to: cycleNode.to }
    };
  }

  const coordinateLike = findFirstChildByName(targetNode, "CoordinateLike");
  if (!coordinateLike) {
    return undefined;
  }

  const relative = findFirstChildByName(coordinateLike, "RelativeCoordinate");
  if (relative) {
    const coordinateNode = findFirstChildByName(relative, "Coordinate");
    if (!coordinateNode) {
      return undefined;
    }
    const prefixNode = findFirstChildByName(relative, "RelativePrefix");
    const prefixRaw = prefixNode ? source.slice(prefixNode.from, prefixNode.to) : "";
    const relativePrefix = prefixRaw === "++" ? "++" : prefixRaw === "+" ? "+" : undefined;
    return {
      kind: "coordinate",
      raw: source.slice(coordinateNode.from, coordinateNode.to),
      relativePrefix,
      span: { from: coordinateNode.from, to: coordinateNode.to }
    };
  }

  const coordinateNode = findFirstChildByName(coordinateLike, "Coordinate");
  if (!coordinateNode) {
    return undefined;
  }

  return {
    kind: "coordinate",
    raw: source.slice(coordinateNode.from, coordinateNode.to),
    span: { from: coordinateNode.from, to: coordinateNode.to }
  };
}

function mapToOperationNodes(node: SyntaxNode, source: string, statementIndex: number, itemIndex: number): NodeItem[] {
  const result: NodeItem[] = [];
  let nodeIndex = 0;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "NodeItem") {
      continue;
    }

    const mapped = mapNodeItem(child, source, statementIndex, itemIndex + nodeIndex + 1);
    result.push({
      ...mapped,
      id: `to-node:${statementIndex}:${itemIndex}:${nodeIndex}`
    });
    nodeIndex += 1;
  }

  return result;
}

function parseCoordinateOperationName(nameNode: SyntaxNode | null, source: string): string | undefined {
  if (!nameNode) {
    return undefined;
  }

  const parsed = parseCoordinate(source.slice(nameNode.from, nameNode.to));
  if (parsed.form === "named") {
    const normalized = parsed.x.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  const raw = source.slice(nameNode.from, nameNode.to).trim();
  if (raw.startsWith("(") && raw.endsWith(")")) {
    const inner = raw.slice(1, -1).trim();
    return inner.length > 0 ? inner : undefined;
  }
  return undefined;
}

function findSvgPayloadNode(node: SyntaxNode): SyntaxNode | null {
  const wrapper = findFirstChildByName(node, "SvgPayload");
  if (!wrapper) {
    return null;
  }

  return firstNamedChild(wrapper) ?? wrapper;
}

function toSpan(node: SyntaxNode | null): Span | undefined {
  if (!node) {
    return undefined;
  }

  return { from: node.from, to: node.to };
}
