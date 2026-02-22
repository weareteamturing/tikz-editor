import type { SyntaxNode } from "@lezer/common";

import { pathCommentItemId, pathStatementId } from "../../ast/ids.js";
import type { PathCommand, PathItem, PathStatement } from "../../ast/types.js";
import type { OptionListAst } from "../../options/types.js";
import { mapCoordinateItem, mapRelativeCoordinateItem } from "../coordinates/parse.js";
import { mapNodeItem, mapSyntheticNodeItem } from "../nodes/parse.js";
import { mapPathOptionItem } from "../options/parse.js";
import { maybeMapPathKeywordItem } from "./keywords.js";
import { mapUnknownPathItem } from "../../transform/unknown.js";
import { findFirstChildByName, firstNamedChild, forEachChild } from "../../syntax/cursor.js";
import {
  mapCoordinateOperationItem,
  mapDecorateOperationItem,
  mapDecorateOperationNode,
  mapEdgeOperationItem,
  mapLetOperationItem,
  mapPathForeachOperationItem,
  mapSvgOperationItem,
  mapToOperationItem
} from "./operations.js";

type PathItemContext = {
  command: PathCommand;
  syntheticNodeEmitted: boolean;
  pendingNodeOptions: SyntaxNode[];
  syntheticNodeImplicitFlags: string[];
};

export function mapPathStatement(node: SyntaxNode, source: string, statementIndex: number): PathStatement {
  const commandNode = findFirstChildByName(node, "PathCommand");
  const commandText = commandNode ? source.slice(commandNode.from, commandNode.to) : "\\path";
  const syntheticNodeImplicitFlags = isMatrixCommand(commandText) ? ["matrix"] : [];
  const command = normalizePathCommand(commandText);

  const context: PathItemContext = {
    command,
    syntheticNodeEmitted: false,
    pendingNodeOptions: [],
    syntheticNodeImplicitFlags
  };

  const items: PathItem[] = [];
  let itemIndex = 0;
  const pathItemNodes = collectPathItemNodes(node);
  let nodeIndex = 0;
  while (nodeIndex < pathItemNodes.length) {
    const mappedDecorate = tryMapDecorateOperation(pathItemNodes, nodeIndex, source, statementIndex, itemIndex);
    if (mappedDecorate) {
      if (context.pendingNodeOptions.length > 0) {
        for (const optionNode of context.pendingNodeOptions) {
          items.push(mapPathOptionItem(optionNode, source, statementIndex, itemIndex));
          itemIndex += 1;
        }
        context.pendingNodeOptions = [];
      }
      items.push(mappedDecorate.item);
      itemIndex += 1;
      nodeIndex += mappedDecorate.consumed;
      continue;
    }

    const mapped = mapPathItem(pathItemNodes[nodeIndex], source, statementIndex, itemIndex, context);
    if (mapped) {
      items.push(mapped);
      itemIndex += 1;
    }
    nodeIndex += 1;
  }

  if (context.command === "node" && !context.syntheticNodeEmitted && context.pendingNodeOptions.length > 0) {
    if (pendingNodeOptionsContainNodeContents(context.pendingNodeOptions, source)) {
      items.push(
        mapSyntheticNodeItem(null, context.pendingNodeOptions, source, statementIndex, itemIndex, {
          implicitFlags: context.syntheticNodeImplicitFlags
        })
      );
      itemIndex += 1;
      context.syntheticNodeEmitted = true;
      context.pendingNodeOptions = [];
    }
  }

  if (context.pendingNodeOptions.length > 0) {
    for (const optionNode of context.pendingNodeOptions) {
      items.push(mapPathOptionItem(optionNode, source, statementIndex, itemIndex));
      itemIndex += 1;
    }
  }

  return {
    kind: "Path",
    id: pathStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    command,
    options: findStatementOptions(items),
    items
  };
}

function mapPathItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number,
  context: PathItemContext
): PathItem | null {
  const actual = unwrapPathItemNode(node);

  if (actual.type.name === "Coordinate") {
    return mapCoordinateItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "RelativeCoordinate") {
    return mapRelativeCoordinateItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "ToOperation") {
    return mapToOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "EdgeOperation") {
    return mapEdgeOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "PathForeachOperation") {
    return mapPathForeachOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "SvgOperation") {
    return mapSvgOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "LetOperation") {
    return mapLetOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "CoordinateOperation") {
    return mapCoordinateOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "DecorateOperation") {
    return mapDecorateOperationNode(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "NodeItem") {
    context.syntheticNodeEmitted = true;
    context.pendingNodeOptions = [];
    return mapNodeItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "OptionList") {
    if (context.command === "node" && !context.syntheticNodeEmitted) {
      context.pendingNodeOptions.push(actual);
      return null;
    }

    return mapPathOptionItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "Comment") {
    return mapPathCommentItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "Group" && context.command === "node" && !context.syntheticNodeEmitted) {
    const synthetic = mapSyntheticNodeItem(actual, context.pendingNodeOptions, source, statementIndex, itemIndex, {
      implicitFlags: context.syntheticNodeImplicitFlags
    });
    context.syntheticNodeEmitted = true;
    context.pendingNodeOptions = [];
    return synthetic;
  }

  const keywordItem = maybeMapPathKeywordItem(actual, source, statementIndex, itemIndex);
  if (keywordItem) {
    return keywordItem;
  }

  return mapUnknownPathItem(actual, source, statementIndex, itemIndex);
}

function normalizePathCommand(commandText: string): PathCommand {
  const normalized = commandText.trim().replace(/^\\/, "").toLowerCase();

  switch (normalized) {
    case "draw":
    case "path":
    case "fill":
    case "filldraw":
    case "pattern":
    case "clip":
    case "shade":
    case "shadedraw":
    case "useasboundingbox":
    case "node":
    case "matrix":
    case "coordinate":
      return normalized === "matrix" ? "node" : normalized;
    default:
      return "path";
  }
}

function isMatrixCommand(commandText: string): boolean {
  return commandText.trim().replace(/^\\/, "").toLowerCase() === "matrix";
}

function isDirectPathItemNode(name: string): boolean {
  return (
    name === "Coordinate" ||
    name === "RelativeCoordinate" ||
    name === "ToOperation" ||
    name === "EdgeOperation" ||
    name === "PathForeachOperation" ||
    name === "SvgOperation" ||
    name === "LetOperation" ||
    name === "CoordinateOperation" ||
    name === "DecorateOperation" ||
    name === "Comment" ||
    name === "NodeItem" ||
    name === "UnknownPathItem" ||
    name === "OptionList" ||
    name === "PathOperator" ||
    name === "Group" ||
    name === "Identifier" ||
    name === "CommandName" ||
    name === "Number"
  );
}

function mapPathCommentItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): PathItem {
  return {
    kind: "PathComment",
    id: pathCommentItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to)
  };
}

function collectPathItemNodes(node: SyntaxNode): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  forEachChild(node, (child) => {
    if (child.type.name === "PathItem") {
      nodes.push(firstNamedChild(child) ?? child);
      return;
    }
    if (isDirectPathItemNode(child.type.name)) {
      nodes.push(child);
    }
  });
  return nodes;
}

function tryMapDecorateOperation(
  nodes: SyntaxNode[],
  startIndex: number,
  source: string,
  statementIndex: number,
  itemIndex: number
): { item: PathItem; consumed: number } | null {
  const keywordNode = unwrapPathItemNode(nodes[startIndex]);
  if (!isDecorateKeywordNode(keywordNode, source)) {
    return null;
  }

  let consumeCount = 1;
  let optionsNode: SyntaxNode | null = null;
  const nextNode = nodes[startIndex + consumeCount];
  if (nextNode) {
    const unwrapped = unwrapPathItemNode(nextNode);
    if (unwrapped.type.name === "OptionList") {
      optionsNode = unwrapped;
      consumeCount += 1;
    }
  }

  const subpathCandidate = nodes[startIndex + consumeCount];
  if (!subpathCandidate) {
    return null;
  }
  const subpathNode = unwrapPathItemNode(subpathCandidate);
  if (!isDecorationSubpathNode(subpathNode, source)) {
    return null;
  }

  return {
    item: mapDecorateOperationItem(keywordNode, optionsNode, subpathNode, source, statementIndex, itemIndex),
    consumed: consumeCount + 1
  };
}

function isDecorateKeywordNode(node: SyntaxNode, source: string): boolean {
  const raw = source.slice(node.from, node.to).trim().toLowerCase();
  return raw === "decorate";
}

function isDecorationSubpathNode(node: SyntaxNode, source: string): boolean {
  const raw = source.slice(node.from, node.to).trim();
  return raw.startsWith("{") && raw.endsWith("}");
}

function unwrapPathItemNode(node: SyntaxNode): SyntaxNode {
  if (node.type.name === "UnknownPathItem") {
    return firstNamedChild(node) ?? node;
  }
  return node;
}

function findStatementOptions(items: PathItem[]) {
  const leadingOptions: OptionListAst[] = [];
  let seenNonComment = false;

  for (const item of items) {
    if (item.kind === "PathComment") {
      continue;
    }

    if (item.kind !== "PathOption") {
      return leadingOptions.length > 0 ? mergeOptionLists(leadingOptions) : undefined;
    }

    seenNonComment = true;
    leadingOptions.push(item.options);
  }

  if (!seenNonComment) {
    return undefined;
  }
  return leadingOptions.length > 0 ? mergeOptionLists(leadingOptions) : undefined;
}

function mergeOptionLists(optionLists: OptionListAst[]): OptionListAst {
  if (optionLists.length === 1) {
    return optionLists[0];
  }

  const first = optionLists[0];
  const last = optionLists[optionLists.length - 1];
  return {
    span: {
      from: first.span.from,
      to: last.span.to
    },
    raw: `[${optionLists.map((entry) => stripOptionListBrackets(entry.raw)).join(",")}]`,
    entries: optionLists.flatMap((entry) => entry.entries)
  };
}

function stripOptionListBrackets(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function pendingNodeOptionsContainNodeContents(optionNodes: SyntaxNode[], source: string): boolean {
  return optionNodes.some((node) => /\bnode\s+contents\s*=/.test(source.slice(node.from, node.to).toLowerCase()));
}
