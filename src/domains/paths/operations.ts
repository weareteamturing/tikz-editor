import type { SyntaxNode } from "@lezer/common";

import {
  coordinateOperationItemId,
  edgeOperationItemId,
  letOperationItemId,
  pathForeachItemId,
  svgOperationItemId,
  toOperationItemId
} from "../../ast/ids.js";
import type {
  CoordinateOperationItem,
  EdgeOperationItem,
  LetOperationItem,
  NodeItem,
  PathForeachItem,
  Span,
  SvgOperationItem,
  ToOperationTarget,
  ToOperationItem
} from "../../ast/types.js";
import { parseForeachHeaderRaw } from "../../foreach/header.js";
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
  return mapToLikeOperationItem("ToOperation", toOperationItemId(statementIndex, itemIndex), node, source, statementIndex, itemIndex);
}

export function mapEdgeOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): EdgeOperationItem {
  return mapToLikeOperationItem("EdgeOperation", edgeOperationItemId(statementIndex, itemIndex), node, source, statementIndex, itemIndex);
}

function mapToLikeOperationItem(
  kind: "ToOperation",
  id: string,
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): ToOperationItem;
function mapToLikeOperationItem(
  kind: "EdgeOperation",
  id: string,
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): EdgeOperationItem;
function mapToLikeOperationItem(
  kind: "ToOperation" | "EdgeOperation",
  id: string,
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): ToOperationItem | EdgeOperationItem {
  const optionsNode = findFirstChildByName(node, "OptionList");
  const target = mapToOperationTarget(node, source);
  const nodes = mapToOperationNodes(node, source, statementIndex, itemIndex);

  return {
    kind,
    id,
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

export function mapPathForeachOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): PathForeachItem {
  const commandNode = findFirstChildByName(node, "ForeachKw") ?? findFirstChildByName(node, "ForeachCmd");
  const listNode = findFirstChildByName(node, "ForeachList");
  const bodyNode = findFirstChildByName(node, "Group");

  const commandRaw = commandNode ? source.slice(commandNode.from, commandNode.to).trim() : "foreach";
  const headerFrom = commandNode ? commandNode.to : node.from;
  const headerTo = listNode ? listNode.to : (bodyNode?.from ?? node.to);
  const headerSlice = source.slice(headerFrom, Math.max(headerFrom, headerTo));
  const parsedHeader = parseForeachHeaderRaw(headerSlice);
  const headerStartOffset = headerSlice.indexOf(parsedHeader.headerRaw);
  const headerFromAbsolute = headerStartOffset >= 0 ? headerFrom + headerStartOffset : headerFrom;

  const options =
    parsedHeader.optionsRaw && parsedHeader.optionsSpan
      ? parseOptionListRaw(parsedHeader.optionsRaw, headerFromAbsolute + parsedHeader.optionsSpan.from)
      : undefined;
  const optionsSpan =
    parsedHeader.optionsSpan != null
      ? {
          from: headerFromAbsolute + parsedHeader.optionsSpan.from,
          to: headerFromAbsolute + parsedHeader.optionsSpan.to
        }
      : undefined;

  return {
    kind: "PathForeach",
    id: pathForeachItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw: commandRaw.startsWith("\\") ? "\\foreach" : "foreach",
    headerRaw: parsedHeader.headerRaw,
    variablesRaw: parsedHeader.variablesRaw,
    listRaw: parsedHeader.listRaw,
    options,
    optionsSpan,
    bodyRaw: bodyNode ? source.slice(bodyNode.from, bodyNode.to) : ""
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
