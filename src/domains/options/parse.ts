import type { SyntaxNode } from "@lezer/common";

import { pathOptionItemId } from "../../ast/ids.js";
import type { PathOptionItem } from "../../ast/types.js";

export function mapPathOptionItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): PathOptionItem {
  return {
    kind: "PathOption",
    id: pathOptionItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to)
  };
}
