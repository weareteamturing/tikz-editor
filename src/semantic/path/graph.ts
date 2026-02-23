import type { GraphOperationItem, Span } from "../../ast/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";

const CONNECTOR_OPERATORS = ["<->", "-!-", "->", "<-", "--"] as const;
const DEFAULT_GRAPH_STEP_PT = 36;

type ConnectorOperator = (typeof CONNECTOR_OPERATORS)[number];

type GraphDefaults = {
  nodeOptionLists: OptionListAst[];
  edgeOptionLists: OptionListAst[];
};

export type GraphPlannedNode = {
  name: string;
  text: string;
  options?: OptionListAst;
  span: Span;
  defaultPoint: { x: number; y: number };
};

export type GraphPlannedEdge = {
  from: string;
  to: string;
  operator: ConnectorOperator;
  options?: OptionListAst;
  span: Span;
};

export type GraphPlan = {
  nodes: GraphPlannedNode[];
  edges: GraphPlannedEdge[];
  diagnostics: string[];
};

type GraphTermResult = {
  entries: string[];
  exits: string[];
};

type ParsedNodeSpec = {
  name: string;
  text: string;
  reference: boolean;
  options?: OptionListAst;
  span: Span;
};

export function buildGraphPlan(operation: GraphOperationItem): GraphPlan {
  const planner = new GraphPlanner(operation);
  planner.build();
  return {
    nodes: planner.nodes,
    edges: planner.edges,
    diagnostics: planner.diagnostics
  };
}

class GraphPlanner {
  readonly nodes: GraphPlannedNode[] = [];
  readonly edges: GraphPlannedEdge[] = [];
  readonly diagnostics: string[] = [];

  private readonly operation: GraphOperationItem;
  private readonly nodesByName = new Map<string, GraphPlannedNode>();
  private placementIndex = 0;
  private anonymousNodeCounter = 1;

  constructor(operation: GraphOperationItem) {
    this.operation = operation;
  }

  build(): void {
    const defaults = this.extractGraphDefaults(this.operation.options);
    this.parseGroup(this.operation.specRaw, this.operation.specSpan.from, defaults);
  }

  private parseGroup(raw: string, from: number, inheritedDefaults: GraphDefaults): GraphTermResult {
    const groupBody = stripOuterBraces(raw);
    const bodyText = groupBody?.inner ?? raw.trim();
    const bodyFrom = groupBody ? from + groupBody.innerOffset : from;

    const leadingOptions = this.readLeadingOptionList(bodyText, bodyFrom);
    const groupDefaults = this.mergeDefaults(inheritedDefaults, this.extractGraphDefaults(leadingOptions?.options));
    const content = leadingOptions ? bodyText.slice(leadingOptions.length).trim() : bodyText.trim();
    const contentFrom = leadingOptions ? bodyFrom + leadingOptions.length : bodyFrom;

    if (content.length === 0) {
      return { entries: [], exits: [] };
    }

    const segments = splitTopLevel(content, [",", ";"], contentFrom);
    const entries: string[] = [];
    const exits: string[] = [];
    for (const segment of segments) {
      if (segment.raw.trim().length === 0) {
        continue;
      }
      const chainResult = this.parseChain(segment.raw, segment.from, groupDefaults);
      appendUnique(entries, chainResult.entries);
      appendUnique(exits, chainResult.exits);
    }

    return { entries, exits };
  }

  private parseChain(raw: string, from: number, defaults: GraphDefaults): GraphTermResult {
    let cursor = 0;
    const first = this.parseNodeSpec(raw, from, cursor, defaults);
    if (!first) {
      return { entries: [], exits: [] };
    }
    cursor = first.next;

    let entries = [...first.term.entries];
    let exits = [...first.term.exits];

    while (true) {
      const afterSpace = skipWhitespace(raw, cursor);
      const connector = readConnector(raw, afterSpace);
      if (!connector) {
        break;
      }
      cursor = connector.next;

      const edgeOptionRead = this.readOptionList(raw, from, cursor);
      const edgeLocalOptions = edgeOptionRead?.options;
      if (edgeOptionRead) {
        cursor = edgeOptionRead.next;
      }

      const nextNode = this.parseNodeSpec(raw, from, cursor, defaults);
      if (!nextNode) {
        this.diagnostics.push("graph-connector-without-right-node");
        break;
      }
      cursor = nextNode.next;

      const pairs = pairMatchingAndStar(exits, nextNode.term.entries);
      if (connector.operator !== "-!-") {
        const connectorOptionList = connectorToOptionList(connector.operator);
        const edgeOptions = mergeOptionLists([
          ...defaults.edgeOptionLists,
          ...(connectorOptionList ? [connectorOptionList] : []),
          ...(edgeLocalOptions ? [edgeLocalOptions] : [])
        ]);
        for (const pair of pairs) {
          const edgeFrom = connector.operator === "<-" ? pair.to : pair.from;
          const edgeTo = connector.operator === "<-" ? pair.from : pair.to;
          this.edges.push({
            from: edgeFrom,
            to: edgeTo,
            operator: connector.operator,
            options: edgeOptions,
            span: {
              from: from + connector.index,
              to: from + nextNode.next
            }
          });
        }
      }

      exits = [...nextNode.term.exits];
    }

    return { entries, exits };
  }

  private parseNodeSpec(
    chainRaw: string,
    chainFrom: number,
    cursor: number,
    defaults: GraphDefaults
  ): { term: GraphTermResult; next: number } | null {
    const start = skipWhitespace(chainRaw, cursor);
    if (start >= chainRaw.length) {
      return null;
    }

    const groupSegment = readBalancedSegment(chainRaw, start, "{", "}");
    if (groupSegment) {
      const term = this.parseGroup(groupSegment.raw, chainFrom + start, defaults);
      return { term, next: groupSegment.next };
    }

    const connector = findNextConnector(chainRaw, start);
    const end = connector ? connector.index : chainRaw.length;
    const rawNode = chainRaw.slice(start, end).trim();
    if (rawNode.length === 0) {
      this.diagnostics.push("empty-graph-node-spec");
      return null;
    }

    const parsedNode = this.parseDirectNode(rawNode, chainFrom + start);
    if (!parsedNode.reference) {
      const mergedOptions = mergeOptionLists([...defaults.nodeOptionLists, ...(parsedNode.options ? [parsedNode.options] : [])]);
      this.ensurePlannedNode(parsedNode.name, parsedNode.text, mergedOptions, parsedNode.span);
    }

    return {
      term: {
        entries: [parsedNode.name],
        exits: [parsedNode.name]
      },
      next: end
    };
  }

  private parseDirectNode(raw: string, from: number): ParsedNodeSpec {
    let working = raw.trim();
    let nodeOptions: OptionListAst | undefined;

    const trailingOptions = readTrailingOptionList(working);
    if (trailingOptions) {
      nodeOptions = parseOptionListRaw(trailingOptions.raw, from + trailingOptions.start);
      working = working.slice(0, trailingOptions.start).trim();
    }

    const slashIndex = findTopLevelChar(working, "/");
    let nameRaw = slashIndex >= 0 ? working.slice(0, slashIndex).trim() : working;
    let textRaw = slashIndex >= 0 ? working.slice(slashIndex + 1).trim() : "";

    let reference = false;
    if (nameRaw.startsWith("(") && nameRaw.endsWith(")")) {
      const inner = stripOuterParens(nameRaw).trim();
      nameRaw = inner;
      reference = true;
      if (textRaw.length === 0) {
        textRaw = inner;
      }
    }

    let name = normalizeGraphText(nameRaw);
    let text = textRaw.length > 0 ? normalizeGraphText(textRaw) : name;

    if (name.length === 0) {
      name = `__graph_anon_${this.anonymousNodeCounter}`;
      this.anonymousNodeCounter += 1;
      if (text.length === 0) {
        text = "";
      }
    }

    return {
      name,
      text,
      reference,
      options: nodeOptions,
      span: {
        from,
        to: from + raw.length
      }
    };
  }

  private ensurePlannedNode(name: string, text: string, options: OptionListAst | undefined, span: Span): void {
    if (this.nodesByName.has(name)) {
      return;
    }

    const placementSlot = this.placementIndex;
    this.placementIndex += 1;
    const node: GraphPlannedNode = {
      name,
      text,
      options,
      span,
      defaultPoint: {
        x: (placementSlot % 8) * DEFAULT_GRAPH_STEP_PT,
        y: -Math.floor(placementSlot / 8) * DEFAULT_GRAPH_STEP_PT
      }
    };
    this.nodesByName.set(name, node);
    this.nodes.push(node);
  }

  private extractGraphDefaults(options: OptionListAst | undefined): GraphDefaults {
    if (!options) {
      return { nodeOptionLists: [], edgeOptionLists: [] };
    }

    const nodeOptionLists: OptionListAst[] = [];
    const edgeOptionLists: OptionListAst[] = [];

    for (const entry of options.entries) {
      if (entry.kind !== "kv") {
        continue;
      }
      const normalizedKey = normalizeGraphOptionKey(entry.key);
      if (normalizedKey === "nodes") {
        const parsed = parseGraphValueAsOptionList(entry.valueRaw, entry.span.from);
        if (parsed) {
          nodeOptionLists.push(parsed);
        }
        continue;
      }
      if (normalizedKey === "edges" || normalizedKey === "edge") {
        const parsed = parseGraphValueAsOptionList(entry.valueRaw, entry.span.from);
        if (parsed) {
          edgeOptionLists.push(parsed);
        }
      }
    }

    return { nodeOptionLists, edgeOptionLists };
  }

  private mergeDefaults(base: GraphDefaults, delta: GraphDefaults): GraphDefaults {
    return {
      nodeOptionLists: [...base.nodeOptionLists, ...delta.nodeOptionLists],
      edgeOptionLists: [...base.edgeOptionLists, ...delta.edgeOptionLists]
    };
  }

  private readLeadingOptionList(raw: string, from: number): { options: OptionListAst; length: number } | null {
    const start = skipWhitespace(raw, 0);
    const segment = readBalancedSegment(raw, start, "[", "]");
    if (!segment) {
      return null;
    }
    const options = parseOptionListRaw(segment.raw, from + start);
    return {
      options,
      length: segment.next
    };
  }

  private readOptionList(raw: string, from: number, cursor: number): { options: OptionListAst; next: number } | null {
    const start = skipWhitespace(raw, cursor);
    const segment = readBalancedSegment(raw, start, "[", "]");
    if (!segment) {
      return null;
    }
    return {
      options: parseOptionListRaw(segment.raw, from + start),
      next: segment.next
    };
  }
}

function parseGraphValueAsOptionList(valueRaw: string, from: number): OptionListAst | undefined {
  const normalized = stripOuterBraces(valueRaw.trim())?.inner ?? valueRaw.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  return parseOptionListRaw(`[${normalized}]`, from);
}

function normalizeGraphOptionKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.startsWith("/tikz/graphs/")) {
    return trimmed.slice("/tikz/graphs/".length);
  }
  return trimmed;
}

function normalizeGraphText(raw: string): string {
  const strippedParens = stripOuterParens(raw.trim());
  const strippedBraces = stripOuterBraces(strippedParens)?.inner ?? strippedParens;
  const unquoted = stripMatchingQuotes(strippedBraces.trim());
  return unquoted.replaceAll('""', '"').trim();
}

function stripMatchingQuotes(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  return raw;
}

function stripOuterParens(raw: string): string {
  if (!raw.startsWith("(") || !raw.endsWith(")") || raw.length < 2) {
    return raw;
  }
  return raw.slice(1, -1);
}

function stripOuterBraces(raw: string): { inner: string; innerOffset: number } | null {
  if (!raw.startsWith("{") || !raw.endsWith("}") || raw.length < 2) {
    return null;
  }
  const segment = readBalancedSegment(raw, 0, "{", "}");
  if (!segment || segment.next !== raw.length) {
    return null;
  }
  return {
    inner: raw.slice(1, -1).trim(),
    innerOffset: 1
  };
}

function readTrailingOptionList(raw: string): { raw: string; start: number } | null {
  const trimmedEnd = trimRightIndex(raw);
  if (trimmedEnd < 0 || raw[trimmedEnd] !== "]") {
    return null;
  }

  let depthSquare = 0;
  let depthBrace = 0;
  let depthParen = 0;
  let inQuote = false;
  for (let index = trimmedEnd; index >= 0; index -= 1) {
    const char = raw[index]!;
    if (char === '"' && raw[index - 1] !== "\\") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (char === "]") {
      depthSquare += 1;
      continue;
    }
    if (char === "[") {
      depthSquare -= 1;
      if (depthSquare === 0 && depthBrace === 0 && depthParen === 0) {
        return {
          raw: raw.slice(index, trimmedEnd + 1),
          start: index
        };
      }
      continue;
    }
    if (char === "}") {
      depthBrace += 1;
      continue;
    }
    if (char === "{") {
      depthBrace -= 1;
      continue;
    }
    if (char === ")") {
      depthParen += 1;
      continue;
    }
    if (char === "(") {
      depthParen -= 1;
    }
  }

  return null;
}

function pairMatchingAndStar(left: string[], right: string[]): Array<{ from: string; to: string }> {
  if (left.length === 0 || right.length === 0) {
    return [];
  }

  const pairs: Array<{ from: string; to: string }> = [];
  const min = Math.min(left.length, right.length);
  for (let index = 0; index < min; index += 1) {
    pairs.push({ from: left[index]!, to: right[index]! });
  }

  if (left.length > right.length) {
    const lastRight = right[right.length - 1]!;
    for (let index = min; index < left.length; index += 1) {
      pairs.push({ from: left[index]!, to: lastRight });
    }
  } else if (right.length > left.length) {
    const lastLeft = left[left.length - 1]!;
    for (let index = min; index < right.length; index += 1) {
      pairs.push({ from: lastLeft, to: right[index]! });
    }
  }

  return pairs;
}

function connectorToOptionList(operator: ConnectorOperator): OptionListAst | undefined {
  if (operator === "--" || operator === "-!-") {
    return undefined;
  }
  return parseOptionListRaw(`[${operator}]`, 0);
}

function splitTopLevel(
  raw: string,
  separators: string[],
  from: number
): Array<{ raw: string; from: number }> {
  const parts: Array<{ raw: string; from: number }> = [];
  let partStart = 0;
  let depthBrace = 0;
  let depthSquare = 0;
  let depthParen = 0;
  let inQuote = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === '"' && raw[index - 1] !== "\\") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }

    if (char === "{") {
      depthBrace += 1;
      continue;
    }
    if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      continue;
    }
    if (char === "[") {
      depthSquare += 1;
      continue;
    }
    if (char === "]") {
      depthSquare = Math.max(0, depthSquare - 1);
      continue;
    }
    if (char === "(") {
      depthParen += 1;
      continue;
    }
    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }

    if (depthBrace === 0 && depthSquare === 0 && depthParen === 0 && separators.includes(char)) {
      parts.push({
        raw: raw.slice(partStart, index),
        from: from + partStart
      });
      partStart = index + 1;
    }
  }

  parts.push({
    raw: raw.slice(partStart),
    from: from + partStart
  });
  return parts;
}

function readConnector(raw: string, start: number): { operator: ConnectorOperator; index: number; next: number } | null {
  for (const operator of CONNECTOR_OPERATORS) {
    if (raw.startsWith(operator, start)) {
      return {
        operator,
        index: start,
        next: start + operator.length
      };
    }
  }
  return null;
}

function findNextConnector(raw: string, start: number): { operator: ConnectorOperator; index: number } | null {
  let depthBrace = 0;
  let depthSquare = 0;
  let depthParen = 0;
  let inQuote = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === '"' && raw[index - 1] !== "\\") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }

    if (char === "{") {
      depthBrace += 1;
      continue;
    }
    if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      continue;
    }
    if (char === "[") {
      depthSquare += 1;
      continue;
    }
    if (char === "]") {
      depthSquare = Math.max(0, depthSquare - 1);
      continue;
    }
    if (char === "(") {
      depthParen += 1;
      continue;
    }
    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }

    if (depthBrace === 0 && depthSquare === 0 && depthParen === 0) {
      for (const operator of CONNECTOR_OPERATORS) {
        if (raw.startsWith(operator, index)) {
          return { operator, index };
        }
      }
    }
  }

  return null;
}

function readBalancedSegment(
  raw: string,
  start: number,
  open: string,
  close: string
): { raw: string; next: number } | null {
  if (raw[start] !== open) {
    return null;
  }

  let depth = 0;
  let inQuote = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === '"' && raw[index - 1] !== "\\") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          raw: raw.slice(start, index + 1),
          next: index + 1
        };
      }
    }
  }
  return null;
}

function findTopLevelChar(raw: string, needle: string): number {
  let depthBrace = 0;
  let depthSquare = 0;
  let depthParen = 0;
  let inQuote = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === '"' && raw[index - 1] !== "\\") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }

    if (char === "{") {
      depthBrace += 1;
      continue;
    }
    if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      continue;
    }
    if (char === "[") {
      depthSquare += 1;
      continue;
    }
    if (char === "]") {
      depthSquare = Math.max(0, depthSquare - 1);
      continue;
    }
    if (char === "(") {
      depthParen += 1;
      continue;
    }
    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }

    if (depthBrace === 0 && depthSquare === 0 && depthParen === 0 && char === needle) {
      return index;
    }
  }

  return -1;
}

function mergeOptionLists(optionLists: OptionListAst[]): OptionListAst | undefined {
  if (optionLists.length === 0) {
    return undefined;
  }
  if (optionLists.length === 1) {
    return optionLists[0];
  }

  const first = optionLists[0]!;
  const last = optionLists[optionLists.length - 1]!;
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

function trimRightIndex(raw: string): number {
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    if (!/\s/.test(raw[index]!)) {
      return index;
    }
  }
  return -1;
}

function skipWhitespace(raw: string, cursor: number): number {
  let index = cursor;
  while (index < raw.length && /\s/.test(raw[index]!)) {
    index += 1;
  }
  return index;
}

function appendUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

