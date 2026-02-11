import type { SyntaxNode } from "@lezer/common";

import { nodeItemId } from "../../ast/ids.js";
import type { NodeItem, Span } from "../../ast/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import { findFirstChildByName } from "../../syntax/cursor.js";

export function mapNodeItem(node: SyntaxNode, source: string, statementIndex: number, itemIndex: number): NodeItem {
  const groupNode = findFirstChildByName(node, "Group");
  const optionsNode = findFirstChildByName(node, "OptionList");

  const mappedText = mapGroupText(groupNode, source, node.to);

  return {
    kind: "Node",
    id: nodeItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    optionsSpan: optionsNode ? { from: optionsNode.from, to: optionsNode.to } : undefined,
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    textSpan: mappedText.textSpan,
    text: mappedText.text
  };
}

export function mapSyntheticNodeItem(
  groupNode: SyntaxNode,
  optionsNode: SyntaxNode | null,
  source: string,
  statementIndex: number,
  itemIndex: number
): NodeItem {
  const mappedText = mapGroupText(groupNode, source, groupNode.to);

  return {
    kind: "Node",
    id: nodeItemId(statementIndex, itemIndex),
    span: {
      from: optionsNode ? optionsNode.from : groupNode.from,
      to: groupNode.to
    },
    optionsSpan: optionsNode ? { from: optionsNode.from, to: optionsNode.to } : undefined,
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    textSpan: mappedText.textSpan,
    text: mappedText.text
  };
}

export function mapGroupText(
  groupNode: SyntaxNode | null,
  source: string,
  fallbackOffset: number
): { textSpan: Span; text: string } {
  if (!groupNode) {
    return {
      textSpan: { from: fallbackOffset, to: fallbackOffset },
      text: ""
    };
  }

  const hasOpenBrace = source[groupNode.from] === "{";
  const hasCloseBrace = source[groupNode.to - 1] === "}";

  const innerFrom = hasOpenBrace ? groupNode.from + 1 : groupNode.from;
  const innerTo = hasCloseBrace ? groupNode.to - 1 : groupNode.to;

  const textSpan = {
    from: innerFrom,
    to: Math.max(innerFrom, innerTo)
  };

  return {
    textSpan,
    text: source.slice(textSpan.from, textSpan.to)
  };
}
