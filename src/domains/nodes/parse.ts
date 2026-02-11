import type { SyntaxNode } from "@lezer/common";

import { nodeItemId } from "../../ast/ids.js";
import type { NodeItem, RelativeCoordinatePrefix, Span } from "../../ast/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";
import { findFirstChildByName, firstNamedChild, forEachChild } from "../../syntax/cursor.js";

export function mapNodeItem(node: SyntaxNode, source: string, statementIndex: number, itemIndex: number): NodeItem {
  const groupNode = findFirstChildByName(node, "Group");
  const options = mergeNodeOptionLists(findNodeOptionLists(node), source);
  const placement = extractPlacementFromNode(node, source) ?? extractPlacementFromOptions(options.options);
  const mappedText = mapNodeText(groupNode, source, node.to, options.options);
  const explicitName = extractExplicitNodeName(node, source);
  const optionName = extractNodeNameFromOptions(options.options);
  const aliases = extractNodeAliasesFromOptions(options.options);

  return {
    kind: "Node",
    id: nodeItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    name: explicitName ?? optionName,
    aliases: aliases.length > 0 ? aliases : undefined,
    optionsSpan: options.span,
    options: options.options,
    atSpan: placement?.span,
    atRaw: placement?.raw,
    atRelativePrefix: placement?.relativePrefix,
    textSource: mappedText.textSource,
    textSpan: mappedText.textSpan,
    text: mappedText.text
  };
}

export function mapSyntheticNodeItem(
  groupNode: SyntaxNode | null,
  optionsNodes: SyntaxNode[],
  source: string,
  statementIndex: number,
  itemIndex: number
): NodeItem {
  const options = mergeNodeOptionLists(optionsNodes, source);
  const placement = extractPlacementFromOptions(options.options);
  const fallbackOffset = groupNode ? groupNode.to : options.span?.to ?? 0;
  const mappedText = mapNodeText(groupNode, source, fallbackOffset, options.options);
  const optionName = extractNodeNameFromOptions(options.options);
  const aliases = extractNodeAliasesFromOptions(options.options);
  const spanFromCandidates = [groupNode?.from, options.span?.from].filter((value): value is number => value != null);
  const spanToCandidates = [groupNode?.to, options.span?.to].filter((value): value is number => value != null);
  const spanFrom = spanFromCandidates.length > 0 ? Math.min(...spanFromCandidates) : fallbackOffset;
  const spanTo = spanToCandidates.length > 0 ? Math.max(...spanToCandidates) : fallbackOffset;

  return {
    kind: "Node",
    id: nodeItemId(statementIndex, itemIndex),
    span: { from: spanFrom, to: spanTo },
    name: optionName,
    aliases: aliases.length > 0 ? aliases : undefined,
    optionsSpan: options.span,
    options: options.options,
    atSpan: placement?.span,
    atRaw: placement?.raw,
    atRelativePrefix: placement?.relativePrefix,
    textSource: mappedText.textSource,
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

function mapNodeText(
  groupNode: SyntaxNode | null,
  source: string,
  fallbackOffset: number,
  options: OptionListAst | undefined
): { textSpan: Span; text: string; textSource: NodeItem["textSource"] } {
  if (groupNode) {
    const mapped = mapGroupText(groupNode, source, fallbackOffset);
    return { ...mapped, textSource: "group" };
  }

  const fromOptions = extractNodeContentsFromOptions(options);
  if (fromOptions) {
    return {
      textSpan: fromOptions.span,
      text: fromOptions.text,
      textSource: "option"
    };
  }

  return {
    textSpan: { from: fallbackOffset, to: fallbackOffset },
    text: "",
    textSource: "option"
  };
}

function findNodeOptionLists(node: SyntaxNode): SyntaxNode[] {
  const lists: SyntaxNode[] = [];

  const direct = findFirstChildByName(node, "OptionList");
  if (direct) {
    lists.push(direct);
  }

  forEachChild(node, (child) => {
    if (child.type.name !== "NodeQualifier") {
      return;
    }
    const actual = firstNamedChild(child);
    if (actual?.type.name === "OptionList") {
      lists.push(actual);
    }
  });

  return dedupeNodesBySpan(lists);
}

function dedupeNodesBySpan(nodes: SyntaxNode[]): SyntaxNode[] {
  const seen = new Set<string>();
  const deduped: SyntaxNode[] = [];
  for (const node of nodes) {
    const key = `${node.from}:${node.to}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(node);
  }
  deduped.sort((left, right) => left.from - right.from || left.to - right.to);
  return deduped;
}

function mergeNodeOptionLists(
  optionNodes: SyntaxNode[],
  source: string
): {
  span?: Span;
  options?: OptionListAst;
} {
  if (optionNodes.length === 0) {
    return {};
  }

  const parsed = optionNodes.map((node) => parseOptionListRaw(source.slice(node.from, node.to), node.from));
  if (parsed.length === 1) {
    return {
      span: { from: optionNodes[0].from, to: optionNodes[0].to },
      options: parsed[0]
    };
  }

  const first = optionNodes[0];
  const last = optionNodes[optionNodes.length - 1];
  return {
    span: { from: first.from, to: last.to },
    options: {
      span: { from: first.from, to: last.to },
      raw: optionNodes.map((node) => source.slice(node.from, node.to)).join(" "),
      entries: parsed.flatMap((list) => list.entries)
    }
  };
}

function extractExplicitNodeName(node: SyntaxNode, source: string): string | undefined {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "NodeQualifier") {
      continue;
    }

    const actual = firstNamedChild(child);
    if (actual?.type.name !== "NodeName") {
      continue;
    }

    const coordinate = findFirstChildByName(actual, "Coordinate");
    if (!coordinate) {
      continue;
    }

    const trimmed = trimCoordinateShell(source.slice(coordinate.from, coordinate.to));
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

function extractNodeNameFromOptions(options: OptionListAst | undefined): string | undefined {
  if (!options) {
    return undefined;
  }

  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "name") {
      continue;
    }
    const parsed = normalizeNodeName(entry.valueRaw);
    if (parsed) {
      return parsed;
    }
  }

  return undefined;
}

function extractNodeAliasesFromOptions(options: OptionListAst | undefined): string[] {
  if (!options) {
    return [];
  }

  const aliases: string[] = [];
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "alias") {
      continue;
    }
    const parsed = normalizeNodeName(entry.valueRaw);
    if (parsed) {
      aliases.push(parsed);
    }
  }

  return aliases;
}

function extractNodeContentsFromOptions(options: OptionListAst | undefined): { text: string; span: Span } | undefined {
  if (!options) {
    return undefined;
  }

  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "node contents") {
      continue;
    }
    return {
      text: stripWrappingBraces(entry.valueRaw),
      span: entry.span
    };
  }

  return undefined;
}

function extractPlacementFromNode(
  node: SyntaxNode,
  source: string
): { span: Span; raw: string; relativePrefix?: RelativeCoordinatePrefix } | undefined {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "NodeQualifier") {
      continue;
    }

    const actual = firstNamedChild(child);
    if (actual?.type.name !== "NodePlacement") {
      continue;
    }

    const coordinateLike = findFirstChildByName(actual, "CoordinateLike");
    if (!coordinateLike) {
      continue;
    }

    const relative = findFirstChildByName(coordinateLike, "RelativeCoordinate");
    if (relative) {
      const prefixRaw = source.slice(relative.from, findFirstChildByName(relative, "Coordinate")?.from ?? relative.from).trim();
      const coordinate = findFirstChildByName(relative, "Coordinate");
      if (!coordinate) {
        continue;
      }
      const prefix: RelativeCoordinatePrefix | undefined = prefixRaw.startsWith("++")
        ? "++"
        : prefixRaw.startsWith("+")
          ? "+"
          : undefined;
      return {
        span: { from: coordinate.from, to: coordinate.to },
        raw: source.slice(coordinate.from, coordinate.to),
        relativePrefix: prefix
      };
    }

    const coordinate = findFirstChildByName(coordinateLike, "Coordinate");
    if (!coordinate) {
      continue;
    }

    return {
      span: { from: coordinate.from, to: coordinate.to },
      raw: source.slice(coordinate.from, coordinate.to)
    };
  }

  return undefined;
}

function extractPlacementFromOptions(
  options: OptionListAst | undefined
): { span: Span; raw: string; relativePrefix?: RelativeCoordinatePrefix } | undefined {
  if (!options) {
    return undefined;
  }

  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "at") {
      continue;
    }

    let value = stripWrappingBraces(entry.valueRaw).trim();
    let relativePrefix: RelativeCoordinatePrefix | undefined;
    if (value.startsWith("++")) {
      relativePrefix = "++";
      value = value.slice(2).trim();
    } else if (value.startsWith("+")) {
      relativePrefix = "+";
      value = value.slice(1).trim();
    }

    if (!value.startsWith("(") || !value.endsWith(")")) {
      continue;
    }

    return {
      span: entry.span,
      raw: value,
      relativePrefix
    };
  }

  return undefined;
}

function normalizeNodeName(valueRaw: string): string | undefined {
  const unwrapped = stripWrappingBraces(valueRaw).trim();
  if (unwrapped.length === 0) {
    return undefined;
  }
  return trimCoordinateShell(unwrapped) || undefined;
}

function trimCoordinateShell(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function stripWrappingBraces(valueRaw: string): string {
  let value = valueRaw.trim();
  while (value.startsWith("{") && value.endsWith("}") && isWrappedBySingleBracePair(value)) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function isWrappedBySingleBracePair(raw: string): boolean {
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && index !== raw.length - 1) {
        return false;
      }
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}
