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
  Span,
  SvgOperationItem,
  ToOperationItem
} from "../../ast/types.js";
import { findFirstChildByName, firstNamedChild } from "../../syntax/cursor.js";

export function mapToOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): ToOperationItem {
  const optionsNode = findFirstChildByName(node, "OptionList");

  return {
    kind: "ToOperation",
    id: toOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    optionsSpan: toSpan(optionsNode),
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

  return {
    kind: "CoordinateOperation",
    id: coordinateOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    optionsSpan: toSpan(optionsNode),
    nameSpan: toSpan(nameNode),
    placementSpan: undefined,
    raw: source.slice(node.from, node.to)
  };
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
