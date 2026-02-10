import type { SyntaxNode } from "@lezer/common";

import { pathCommentItemId, pathStatementId } from "../../ast/ids.js";
import type { PathCommand, PathItem, PathStatement } from "../../ast/types.js";
import { mapCoordinateItem, mapRelativeCoordinateItem } from "../coordinates/parse.js";
import { mapNodeItem, mapSyntheticNodeItem } from "../nodes/parse.js";
import { mapPathOptionItem } from "../options/parse.js";
import { maybeMapPathKeywordItem } from "./keywords.js";
import { mapUnknownPathItem } from "../../transform/unknown.js";
import { findFirstChildByName, firstNamedChild, forEachChild } from "../../syntax/cursor.js";
import {
  mapCoordinateOperationItem,
  mapLetOperationItem,
  mapSvgOperationItem,
  mapToOperationItem
} from "./operations.js";

type PathItemContext = {
  command: PathCommand;
  syntheticNodeEmitted: boolean;
  pendingNodeOptions: SyntaxNode | null;
};

export function mapPathStatement(node: SyntaxNode, source: string, statementIndex: number): PathStatement {
  const commandNode = findFirstChildByName(node, "PathCommand");
  const commandText = commandNode ? source.slice(commandNode.from, commandNode.to) : "\\path";
  const command = normalizePathCommand(commandText);

  const context: PathItemContext = {
    command,
    syntheticNodeEmitted: false,
    pendingNodeOptions: null
  };

  const items: PathItem[] = [];
  let itemIndex = 0;

  forEachChild(node, (child) => {
    if (child.type.name === "PathItem") {
      const actual = firstNamedChild(child) ?? child;
      const mapped = mapPathItem(actual, source, statementIndex, itemIndex, context);
      if (mapped) {
        items.push(mapped);
        itemIndex += 1;
      }
      return;
    }

    if (isDirectPathItemNode(child.type.name)) {
      const mapped = mapPathItem(child, source, statementIndex, itemIndex, context);
      if (mapped) {
        items.push(mapped);
        itemIndex += 1;
      }
    }
  });

  if (context.pendingNodeOptions) {
    items.push(mapPathOptionItem(context.pendingNodeOptions, source, statementIndex, itemIndex));
  }

  return {
    kind: "Path",
    id: pathStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    command,
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

  if (actual.type.name === "SvgOperation") {
    return mapSvgOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "LetOperation") {
    return mapLetOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "CoordinateOperation") {
    return mapCoordinateOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "NodeItem") {
    context.syntheticNodeEmitted = true;
    context.pendingNodeOptions = null;
    return mapNodeItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "OptionList") {
    if (context.command === "node" && !context.syntheticNodeEmitted && !context.pendingNodeOptions) {
      context.pendingNodeOptions = actual;
      return null;
    }

    return mapPathOptionItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "Comment") {
    return mapPathCommentItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "Group" && context.command === "node" && !context.syntheticNodeEmitted) {
    const synthetic = mapSyntheticNodeItem(actual, context.pendingNodeOptions, source, statementIndex, itemIndex);
    context.syntheticNodeEmitted = true;
    context.pendingNodeOptions = null;
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
    case "coordinate":
      return normalized;
    default:
      return "path";
  }
}

function isDirectPathItemNode(name: string): boolean {
  return (
    name === "Coordinate" ||
    name === "RelativeCoordinate" ||
    name === "ToOperation" ||
    name === "SvgOperation" ||
    name === "LetOperation" ||
    name === "CoordinateOperation" ||
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

function unwrapPathItemNode(node: SyntaxNode): SyntaxNode {
  if (node.type.name === "UnknownPathItem") {
    return firstNamedChild(node) ?? node;
  }
  return node;
}
