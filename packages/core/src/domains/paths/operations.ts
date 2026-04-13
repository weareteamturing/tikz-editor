import type { SyntaxNode } from "@lezer/common";

import {
  childForeachClauseId,
  childOperationItemId,
  coordinateOperationItemId,
  decorateOperationItemId,
  edgeOperationItemId,
  edgeFromParentOperationItemId,
  letOperationItemId,
  pathForeachItemId,
  svgOperationItemId,
  toOperationItemId
} from "../../ast/ids.js";
import type {
  ChildForeachClause,
  ChildOperationItem,
  CoordinateOperationItem,
  DecorateOperationItem,
  EdgeOperationItem,
  EdgeFromParentOperationItem,
  LetOperationItem,
  NodeItem,
  PathForeachItem,
  PathItem,
  Span,
  SvgOperationItem,
  ToOperationTarget,
  ToOperationItem
} from "../../ast/types.js";
import { parseForeachHeaderRaw, stripForeachCommandPrefix } from "../../foreach/header.js";
import { parsePathItemsFromFragmentWithMapping } from "../../foreach/snippet-parse.js";
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

export function mapChildOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): ChildOperationItem {
  const optionsNode = findFirstChildByName(node, "OptionList");
  const bodyNode = findFirstChildByName(node, "Group");
  const foreachClauses = mapChildForeachClauses(node, source, statementIndex, itemIndex);
  const bodyRaw = bodyNode ? source.slice(bodyNode.from, bodyNode.to) : "{}";
  const parsedBody = bodyNode
    ? parsePathItemsFromFragmentWithMapping(bodyRaw, { from: bodyNode.from, to: bodyNode.to })
    : { value: [] as PathItem[] };
  const templateRaw = buildChildTemplateRaw(node, source, foreachClauses);

  return {
    kind: "ChildOperation",
    id: childOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    templateRaw,
    optionsSpan: toSpan(optionsNode),
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    foreachClauses: foreachClauses.length > 0 ? foreachClauses : undefined,
    bodySpan: toSpan(bodyNode),
    bodyRaw,
    body: parsedBody.value
  };
}

export function mapEdgeFromParentOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): EdgeFromParentOperationItem {
  const optionsNode = findFirstChildByName(node, "OptionList");
  const nodes = mapToOperationNodes(node, source, statementIndex, itemIndex, "edge-from-parent-node");
  const raw = source.slice(node.from, node.to);
  const normalizedRaw = raw.toLowerCase();
  const alias: EdgeFromParentOperationItem["alias"] =
    normalizedRaw.includes("edge to parent") ? "edge to parent" : "edge from parent";

  return {
    kind: "EdgeFromParentOperation",
    id: edgeFromParentOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    optionsSpan: toSpan(optionsNode),
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    nodes: nodes.length > 0 ? nodes : undefined,
    alias,
    raw
  };
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
  const nodes = mapToOperationNodes(node, source, statementIndex, itemIndex, kind === "ToOperation" ? "to-node" : "edge-node");

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

export function mapDecorateOperationItem(
  keywordNode: SyntaxNode,
  optionsNode: SyntaxNode | null,
  subpathNode: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): DecorateOperationItem {
  return {
    kind: "DecorateOperation",
    id: decorateOperationItemId(statementIndex, itemIndex),
    span: { from: keywordNode.from, to: subpathNode.to },
    optionsSpan: toSpan(optionsNode),
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    subpathSpan: { from: subpathNode.from, to: subpathNode.to },
    subpathRaw: source.slice(subpathNode.from, subpathNode.to),
    raw: source.slice(keywordNode.from, subpathNode.to)
  };
}

export function mapDecorateOperationNode(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): DecorateOperationItem {
  const keywordNode = findFirstChildByName(node, "DecorateKw") ?? firstNamedChild(node) ?? node;
  const optionsNode = findFirstChildByName(node, "OptionList");
  const subpathNode = findFirstChildByName(node, "Group") ?? node;
  return mapDecorateOperationItem(keywordNode, optionsNode, subpathNode, source, statementIndex, itemIndex);
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

function mapToOperationNodes(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number,
  nodeIdPrefix: string
): NodeItem[] {
  const result: NodeItem[] = [];
  let nodeIndex = 0;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "NodeItem") {
      continue;
    }

    const mapped = mapNodeItem(child, source, statementIndex, itemIndex + nodeIndex + 1);
    result.push({
      ...mapped,
      id: `${nodeIdPrefix}:${statementIndex}:${itemIndex}:${nodeIndex}`
    });
    nodeIndex += 1;
  }

  return result;
}

function mapChildForeachClauses(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): ChildForeachClause[] {
  const clauses: ChildForeachClause[] = [];
  let clauseIndex = 0;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "ChildForeachClause") {
      continue;
    }

    const raw = source.slice(child.from, child.to);
    const parsed = parseForeachHeaderRaw(stripForeachCommandPrefix(raw));
    const headerStartInRaw = raw.indexOf(parsed.headerRaw);
    const headerFrom = child.from + (headerStartInRaw >= 0 ? headerStartInRaw : 0);

    const options =
      parsed.optionsRaw && parsed.optionsSpan
        ? parseOptionListRaw(parsed.optionsRaw, headerFrom + parsed.optionsSpan.from)
        : undefined;
    const optionsSpan =
      parsed.optionsSpan != null
        ? {
            from: headerFrom + parsed.optionsSpan.from,
            to: headerFrom + parsed.optionsSpan.to
          }
        : undefined;

    clauses.push({
      kind: "ChildForeachClause",
      id: childForeachClauseId(statementIndex, itemIndex, clauseIndex),
      span: { from: child.from, to: child.to },
      raw,
      headerRaw: parsed.headerRaw,
      variablesRaw: parsed.variablesRaw,
      listRaw: parsed.listRaw,
      options,
      optionsSpan
    });
    clauseIndex += 1;
  }

  return clauses;
}

function buildChildTemplateRaw(node: SyntaxNode, source: string, clauses: ChildForeachClause[]): string {
  if (clauses.length === 0) {
    return source.slice(node.from, node.to);
  }

  const firstClauseStart = clauses.reduce((min, clause) => Math.min(min, clause.span.from), clauses[0]!.span.from);
  const lastClauseEnd = clauses.reduce((max, clause) => Math.max(max, clause.span.to), clauses[0]!.span.to);
  return `${source.slice(node.from, firstClauseStart)}${source.slice(lastClauseEnd, node.to)}`;
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
