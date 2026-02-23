import type { GraphOperationItem, Span } from "../../ast/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";

const CONNECTOR_OPERATORS = ["<->", "-!-", "->", "<-", "--"] as const;
const DEFAULT_GRAPH_STEP_PT = 36;

type ConnectorOperator = (typeof CONNECTOR_OPERATORS)[number];
type GraphMode = "multi" | "simple";
type GraphNodeResolutionMode = "auto" | "fresh" | "existing";

type GraphNumberingState = {
  enabled: boolean;
  next: number;
  separator: string;
};

type GraphScopeState = {
  nodeOptionLists: OptionListAst[];
  edgeOptionLists: OptionListAst[];
  namePrefix: string;
  nameSeparator: string;
  nodeResolution: GraphNodeResolutionMode;
  numbering: GraphNumberingState;
  mode: GraphMode;
  asTextOverride?: string;
  putNodeTextIncomingOptions: string[];
  putNodeTextOutgoingOptions: string[];
};

type GraphNodeAccumulatorOp =
  | { kind: "clear-target" }
  | { kind: "clear-source" }
  | { kind: "add-target-style"; options: OptionListAst }
  | { kind: "add-source-style"; options: OptionListAst }
  | { kind: "add-target-node"; node: GraphPlannedEdgeNode }
  | { kind: "add-source-node"; node: GraphPlannedEdgeNode };

type GraphNodeRecord = {
  name: string;
  created: boolean;
  sourceEdgeOptionLists: OptionListAst[];
  targetEdgeOptionLists: OptionListAst[];
  sourceEdgeNodes: GraphPlannedEdgeNode[];
  targetEdgeNodes: GraphPlannedEdgeNode[];
};

export type GraphPlannedNode = {
  name: string;
  text: string;
  options?: OptionListAst;
  span: Span;
  defaultPoint: { x: number; y: number };
};

export type GraphPlannedEdgeNode = {
  text: string;
  options?: OptionListAst;
  span: Span;
};

export type GraphPlannedEdge = {
  from: string;
  to: string;
  operator: ConnectorOperator;
  options?: OptionListAst;
  nodes?: GraphPlannedEdgeNode[];
  span: Span;
};

type GraphPlannedEdgeInternal = GraphPlannedEdge & {
  passthroughSimple?: boolean;
};

export type GraphPlan = {
  nodes: GraphPlannedNode[];
  edges: GraphPlannedEdge[];
  diagnostics: string[];
};

type GraphTermResult = {
  entries: string[];
  exits: string[];
  edges: GraphPlannedEdgeInternal[];
};

type ParsedDirectNodeSpec = {
  baseName: string;
  baseNameWasQuoted: boolean;
  textCandidate: string;
  explicitReference: boolean;
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
  private readonly nodeRecords = new Map<string, GraphNodeRecord>();
  private placementIndex = 0;
  private anonymousNodeCounter = 1;

  constructor(operation: GraphOperationItem) {
    this.operation = operation;
  }

  build(): void {
    let rootScope = this.createRootScope();
    rootScope = this.applyGroupOptionControls(rootScope, this.operation.options);
    const term = this.parseGroup(this.operation.specRaw, this.operation.specSpan.from, rootScope, null);
    for (const edge of term.edges) {
      this.edges.push({
        from: edge.from,
        to: edge.to,
        operator: edge.operator,
        options: edge.options,
        nodes: edge.nodes,
        span: edge.span
      });
    }
  }

  private createRootScope(): GraphScopeState {
    return {
      nodeOptionLists: [],
      edgeOptionLists: [],
      namePrefix: "",
      nameSeparator: " ",
      nodeResolution: "auto",
      numbering: {
        enabled: false,
        next: 1,
        separator: " "
      },
      mode: "multi",
      asTextOverride: undefined,
      putNodeTextIncomingOptions: [],
      putNodeTextOutgoingOptions: []
    };
  }

  private cloneScope(scope: GraphScopeState): GraphScopeState {
    return {
      nodeOptionLists: [...scope.nodeOptionLists],
      edgeOptionLists: [...scope.edgeOptionLists],
      namePrefix: scope.namePrefix,
      nameSeparator: scope.nameSeparator,
      nodeResolution: scope.nodeResolution,
      // The numbering object is intentionally shared unless an option locally overrides it.
      numbering: scope.numbering,
      mode: scope.mode,
      asTextOverride: scope.asTextOverride,
      putNodeTextIncomingOptions: [...scope.putNodeTextIncomingOptions],
      putNodeTextOutgoingOptions: [...scope.putNodeTextOutgoingOptions]
    };
  }

  private parseGroup(raw: string, from: number, inheritedScope: GraphScopeState, parentMode: GraphMode | null): GraphTermResult {
    const groupBody = stripOuterBraces(raw);
    const bodyText = groupBody?.inner ?? raw.trim();
    const bodyFrom = groupBody ? from + groupBody.innerOffset : from;

    const leadingOptions = this.readLeadingOptionList(bodyText, bodyFrom);
    let scope = this.cloneScope(inheritedScope);
    if (leadingOptions) {
      scope = this.applyGroupOptionControls(scope, leadingOptions.options);
    }

    const content = leadingOptions ? bodyText.slice(leadingOptions.length).trim() : bodyText.trim();
    const contentFrom = leadingOptions ? bodyFrom + leadingOptions.length : bodyFrom;

    if (content.length === 0) {
      return { entries: [], exits: [], edges: [] };
    }

    const segments = splitTopLevel(content, [",", ";"], contentFrom);
    const entries: string[] = [];
    const exits: string[] = [];
    const edges: GraphPlannedEdgeInternal[] = [];

    for (const segment of segments) {
      if (segment.raw.trim().length === 0) {
        continue;
      }
      const chainResult = this.parseChain(segment.raw, segment.from, scope);
      appendUnique(entries, chainResult.entries);
      appendUnique(exits, chainResult.exits);
      edges.push(...chainResult.edges);
    }

    const finalizedEdges = this.finalizeGroupEdges(scope.mode, parentMode, edges);
    return { entries, exits, edges: finalizedEdges };
  }

  private finalizeGroupEdges(
    mode: GraphMode,
    parentMode: GraphMode | null,
    edges: GraphPlannedEdgeInternal[]
  ): GraphPlannedEdgeInternal[] {
    const finalized = mode === "simple" ? dedupeSimpleEdges(edges) : edges;
    if (mode === "multi" && parentMode === "simple") {
      return finalized.map((edge) => ({ ...edge, passthroughSimple: true }));
    }
    return finalized;
  }

  private parseChain(raw: string, from: number, scope: GraphScopeState): GraphTermResult {
    let cursor = 0;
    const first = this.parseNodeSpec(raw, from, cursor, scope);
    if (!first) {
      return { entries: [], exits: [], edges: [] };
    }
    cursor = first.next;

    const entries = [...first.term.entries];
    let exits = [...first.term.exits];
    const edges: GraphPlannedEdgeInternal[] = [...first.term.edges];

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

      const nextNode = this.parseNodeSpec(raw, from, cursor, scope);
      if (!nextNode) {
        this.diagnostics.push("graph-connector-without-right-node");
        break;
      }
      cursor = nextNode.next;
      edges.push(...nextNode.term.edges);

      const pairs = pairMatchingAndStar(exits, nextNode.term.entries);
      const includeConnectorEdge = connector.operator !== "-!-" || scope.mode === "simple";
      if (includeConnectorEdge) {
        const connectorOptionList = connectorToOptionList(connector.operator);
        for (const pair of pairs) {
          const edgeFrom = connector.operator === "<-" ? pair.to : pair.from;
          const edgeTo = connector.operator === "<-" ? pair.from : pair.to;
          const sourceRecord = this.ensureNodeRecord(edgeFrom);
          const targetRecord = this.ensureNodeRecord(edgeTo);

          const edgeOptions = mergeOptionLists([
            ...scope.edgeOptionLists,
            ...(connectorOptionList ? [connectorOptionList] : []),
            ...(edgeLocalOptions ? [edgeLocalOptions] : []),
            ...sourceRecord.sourceEdgeOptionLists,
            ...targetRecord.targetEdgeOptionLists
          ]);

          const edgeNodes = [
            ...sourceRecord.sourceEdgeNodes.map(clonePlannedEdgeNode),
            ...targetRecord.targetEdgeNodes.map(clonePlannedEdgeNode)
          ];

          edges.push({
            from: edgeFrom,
            to: edgeTo,
            operator: connector.operator,
            options: edgeOptions,
            nodes: edgeNodes.length > 0 ? edgeNodes : undefined,
            span: {
              from: from + connector.index,
              to: from + nextNode.next
            }
          });
        }
      }

      exits = [...nextNode.term.exits];
    }

    return { entries, exits, edges };
  }

  private parseNodeSpec(
    chainRaw: string,
    chainFrom: number,
    cursor: number,
    scope: GraphScopeState
  ): { term: GraphTermResult; next: number } | null {
    const start = skipWhitespace(chainRaw, cursor);
    if (start >= chainRaw.length) {
      return null;
    }

    const groupSegment = readBalancedSegment(chainRaw, start, "{", "}");
    if (groupSegment) {
      const term = this.parseGroup(groupSegment.raw, chainFrom + start, scope, scope.mode);
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
    const nodePlan = this.processNodeOptionList(scope, parsedNode.options, parsedNode.textCandidate, parsedNode.span);
    const localScope = nodePlan.scope;

    const resolvedName = this.resolveDirectNodeName(parsedNode, localScope);
    const existingRecord = this.nodeRecords.get(resolvedName);
    const record = existingRecord ?? this.ensureNodeRecord(resolvedName);
    this.applyNodeAccumulatorOps(record, nodePlan.accumulatorOps);

    const shouldCreateFreshNode = this.shouldCreateFreshNode(parsedNode, localScope, existingRecord != null);
    if (shouldCreateFreshNode) {
      const mergedOptions = mergeOptionLists([
        ...localScope.nodeOptionLists,
        ...(nodePlan.styleOptions ? [nodePlan.styleOptions] : [])
      ]);
      this.ensurePlannedNode(record, resolvedName, nodePlan.finalNodeText, mergedOptions, parsedNode.span);
    }

    return {
      term: {
        entries: [resolvedName],
        exits: [resolvedName],
        edges: []
      },
      next: end
    };
  }

  private resolveDirectNodeName(parsedNode: ParsedDirectNodeSpec, scope: GraphScopeState): string {
    if (parsedNode.explicitReference) {
      let referencedName = parsedNode.baseNameWasQuoted
        ? canonicalizeQuotedNodeName(parsedNode.baseName)
        : parsedNode.baseName;
      if (referencedName.length === 0) {
        referencedName = this.nextAnonymousNodeName();
      }
      return referencedName;
    }

    let localName = parsedNode.baseNameWasQuoted ? canonicalizeQuotedNodeName(parsedNode.baseName) : parsedNode.baseName;
    if (localName.length === 0) {
      localName = this.nextAnonymousNodeName();
    }

    if (scope.numbering.enabled) {
      localName = `${localName}${scope.numbering.separator}${scope.numbering.next}`;
      scope.numbering.next += 1;
    }

    let fullName = scope.namePrefix.length > 0 ? `${scope.namePrefix}${scope.nameSeparator}${localName}` : localName;

    if (scope.nodeResolution === "fresh") {
      while (this.nodeRecords.has(fullName)) {
        fullName = `${fullName}'`;
      }
    }

    return fullName;
  }

  private shouldCreateFreshNode(parsedNode: ParsedDirectNodeSpec, scope: GraphScopeState, alreadySeenInGraph: boolean): boolean {
    if (parsedNode.explicitReference) {
      return false;
    }
    if (scope.nodeResolution === "existing") {
      return false;
    }
    if (scope.nodeResolution === "fresh") {
      return true;
    }
    return !alreadySeenInGraph;
  }

  private processNodeOptionList(
    baseScope: GraphScopeState,
    options: OptionListAst | undefined,
    baseNodeText: string,
    span: Span
  ): {
    scope: GraphScopeState;
    styleOptions?: OptionListAst;
    accumulatorOps: GraphNodeAccumulatorOp[];
    finalNodeText: string;
  } {
    let scope = this.cloneScope(baseScope);
    const accumulatorOps: GraphNodeAccumulatorOp[] = [];

    for (const optionsRaw of baseScope.putNodeTextIncomingOptions) {
      accumulatorOps.push(makeAddTargetNodeOp(baseNodeText, optionsRaw, span, true));
    }
    for (const optionsRaw of baseScope.putNodeTextOutgoingOptions) {
      accumulatorOps.push(makeAddSourceNodeOp(baseNodeText, optionsRaw, span, true));
    }

    if (!options) {
      return {
        scope,
        accumulatorOps,
        finalNodeText: scope.asTextOverride ?? baseNodeText
      };
    }

    const retainedEntries: OptionEntry[] = [];

    for (const entry of options.entries) {
      const rawToken = entry.raw.trim();

      const directionalOps = parseDirectionalEdgeShortcut(rawToken, entry.span);
      if (directionalOps.length > 0) {
        accumulatorOps.push(...directionalOps);
        continue;
      }

      let consumed = false;

      if (entry.kind === "kv") {
        const key = normalizeGraphOptionKey(entry.key);

        if (key === "nodes") {
          const parsed = parseGraphValueAsOptionList(entry.valueRaw, entry.span.from);
          if (parsed) {
            scope.nodeOptionLists.push(parsed);
          }
          consumed = true;
        } else if (key === "edge" || key === "edges") {
          const parsed = parseGraphValueAsOptionList(entry.valueRaw, entry.span.from);
          if (parsed) {
            scope.edgeOptionLists.push(parsed);
          }
          consumed = true;
        } else if (key === "name") {
          const rawName = normalizeGraphText(entry.valueRaw);
          scope = appendScopedNamePrefix(scope, rawName);
          consumed = true;
        } else if (key === "name separator") {
          scope.nameSeparator = normalizeGraphText(entry.valueRaw);
          consumed = true;
        } else if (key === "as") {
          scope.asTextOverride = normalizeGraphText(entry.valueRaw);
          consumed = true;
        } else if (key === "use existing nodes") {
          const enabled = parseGraphBoolean(entry.valueRaw, true);
          if (enabled != null) {
            scope.nodeResolution = enabled ? "existing" : scope.nodeResolution === "existing" ? "auto" : scope.nodeResolution;
          }
          consumed = true;
        } else if (key === "fresh nodes") {
          const enabled = parseGraphBoolean(entry.valueRaw, true);
          if (enabled != null) {
            scope.nodeResolution = enabled ? "fresh" : scope.nodeResolution === "fresh" ? "auto" : scope.nodeResolution;
          }
          consumed = true;
        } else if (key === "number nodes") {
          scope = applyNumberNodes(scope, entry.valueRaw);
          consumed = true;
        } else if (key === "number nodes sep") {
          scope = applyNumberNodesSeparator(scope, normalizeGraphText(entry.valueRaw));
          consumed = true;
        } else if (key === "simple") {
          const enabled = parseGraphBoolean(entry.valueRaw, true);
          if (enabled === true) {
            scope.mode = "simple";
          } else if (enabled === false && scope.mode === "simple") {
            scope.mode = "multi";
          }
          consumed = true;
        } else if (key === "multi") {
          const enabled = parseGraphBoolean(entry.valueRaw, true);
          if (enabled === true) {
            scope.mode = "multi";
          } else if (enabled === false && scope.mode === "multi") {
            scope.mode = "simple";
          }
          consumed = true;
        } else if (key === "target edge style") {
          const parsed = parseGraphValueAsOptionList(entry.valueRaw, entry.span.from);
          if (parsed) {
            accumulatorOps.push({ kind: "add-target-style", options: parsed });
          }
          consumed = true;
        } else if (key === "source edge style") {
          const parsed = parseGraphValueAsOptionList(entry.valueRaw, entry.span.from);
          if (parsed) {
            accumulatorOps.push({ kind: "add-source-style", options: parsed });
          }
          consumed = true;
        } else if (key === "target edge node") {
          const parsed = parseGraphEdgeNodeValue(entry.valueRaw, entry.span, false);
          if (parsed) {
            accumulatorOps.push({ kind: "add-target-node", node: parsed });
          }
          consumed = true;
        } else if (key === "source edge node") {
          const parsed = parseGraphEdgeNodeValue(entry.valueRaw, entry.span, false);
          if (parsed) {
            accumulatorOps.push({ kind: "add-source-node", node: parsed });
          }
          consumed = true;
        } else if (key === "target edge clear" || key === "clear >") {
          const enabled = parseGraphBoolean(entry.valueRaw, true);
          if (enabled !== false) {
            accumulatorOps.push({ kind: "clear-target" });
          }
          consumed = true;
        } else if (key === "source edge clear" || key === "clear <") {
          const enabled = parseGraphBoolean(entry.valueRaw, true);
          if (enabled !== false) {
            accumulatorOps.push({ kind: "clear-source" });
          }
          consumed = true;
        } else if (key === "put node text on incoming edges") {
          accumulatorOps.push(makeAddTargetNodeOp(baseNodeText, entry.valueRaw, entry.span, true));
          scope.asTextOverride = "";
          consumed = true;
        } else if (key === "put node text on outgoing edges") {
          accumulatorOps.push(makeAddSourceNodeOp(baseNodeText, entry.valueRaw, entry.span, true));
          scope.asTextOverride = "";
          consumed = true;
        }
      } else if (entry.kind === "flag") {
        const key = normalizeGraphOptionKey(entry.key);

        if (key === "simple") {
          scope.mode = "simple";
          consumed = true;
        } else if (key === "multi") {
          scope.mode = "multi";
          consumed = true;
        } else if (key === "target edge clear" || key === "clear >") {
          accumulatorOps.push({ kind: "clear-target" });
          consumed = true;
        } else if (key === "source edge clear" || key === "clear <") {
          accumulatorOps.push({ kind: "clear-source" });
          consumed = true;
        } else if (key === "put node text on incoming edges") {
          accumulatorOps.push(makeAddTargetNodeOp(baseNodeText, "", entry.span, true));
          scope.asTextOverride = "";
          consumed = true;
        } else if (key === "put node text on outgoing edges") {
          accumulatorOps.push(makeAddSourceNodeOp(baseNodeText, "", entry.span, true));
          scope.asTextOverride = "";
          consumed = true;
        } else if (key === "fresh nodes") {
          scope.nodeResolution = "fresh";
          consumed = true;
        } else if (key === "use existing nodes") {
          scope.nodeResolution = "existing";
          consumed = true;
        } else if (key === "number nodes") {
          scope = applyNumberNodes(scope, undefined);
          consumed = true;
        }
      } else {
        const normalizedRaw = normalizeGraphOptionKey(rawToken.toLowerCase());
        if (normalizedRaw === "clear >") {
          accumulatorOps.push({ kind: "clear-target" });
          consumed = true;
        } else if (normalizedRaw === "clear <") {
          accumulatorOps.push({ kind: "clear-source" });
          consumed = true;
        } else if (normalizedRaw === "simple") {
          scope.mode = "simple";
          consumed = true;
        } else if (normalizedRaw === "multi") {
          scope.mode = "multi";
          consumed = true;
        } else if (normalizedRaw === "put node text on incoming edges") {
          accumulatorOps.push(makeAddTargetNodeOp(baseNodeText, "", entry.span, true));
          scope.asTextOverride = "";
          consumed = true;
        } else if (normalizedRaw === "put node text on outgoing edges") {
          accumulatorOps.push(makeAddSourceNodeOp(baseNodeText, "", entry.span, true));
          scope.asTextOverride = "";
          consumed = true;
        }
      }

      if (!consumed) {
        retainedEntries.push(entry);
      }
    }

    return {
      scope,
      styleOptions: optionListFromEntries(retainedEntries, options),
      accumulatorOps,
      finalNodeText: scope.asTextOverride ?? baseNodeText
    };
  }

  private applyGroupOptionControls(baseScope: GraphScopeState, options: OptionListAst | undefined): GraphScopeState {
    if (!options) {
      return baseScope;
    }

    let scope = this.cloneScope(baseScope);

    for (const entry of options.entries) {
      if (entry.kind === "kv") {
        const key = normalizeGraphOptionKey(entry.key);
        if (key === "nodes") {
          const parsed = parseGraphValueAsOptionList(entry.valueRaw, entry.span.from);
          if (parsed) {
            scope.nodeOptionLists.push(parsed);
          }
          continue;
        }
        if (key === "edge" || key === "edges") {
          const parsed = parseGraphValueAsOptionList(entry.valueRaw, entry.span.from);
          if (parsed) {
            scope.edgeOptionLists.push(parsed);
          }
          continue;
        }
        if (key === "name") {
          const rawName = normalizeGraphText(entry.valueRaw);
          scope = appendScopedNamePrefix(scope, rawName);
          continue;
        }
        if (key === "name separator") {
          scope.nameSeparator = normalizeGraphText(entry.valueRaw);
          continue;
        }
        if (key === "as") {
          scope.asTextOverride = normalizeGraphText(entry.valueRaw);
          continue;
        }
        if (key === "use existing nodes") {
          const enabled = parseGraphBoolean(entry.valueRaw, true);
          if (enabled != null) {
            scope.nodeResolution = enabled ? "existing" : scope.nodeResolution === "existing" ? "auto" : scope.nodeResolution;
          }
          continue;
        }
        if (key === "fresh nodes") {
          const enabled = parseGraphBoolean(entry.valueRaw, true);
          if (enabled != null) {
            scope.nodeResolution = enabled ? "fresh" : scope.nodeResolution === "fresh" ? "auto" : scope.nodeResolution;
          }
          continue;
        }
        if (key === "number nodes") {
          scope = applyNumberNodes(scope, entry.valueRaw);
          continue;
        }
        if (key === "number nodes sep") {
          scope = applyNumberNodesSeparator(scope, normalizeGraphText(entry.valueRaw));
          continue;
        }
        if (key === "simple") {
          const enabled = parseGraphBoolean(entry.valueRaw, true);
          if (enabled === true) {
            scope.mode = "simple";
          } else if (enabled === false && scope.mode === "simple") {
            scope.mode = "multi";
          }
          continue;
        }
        if (key === "multi") {
          const enabled = parseGraphBoolean(entry.valueRaw, true);
          if (enabled === true) {
            scope.mode = "multi";
          } else if (enabled === false && scope.mode === "multi") {
            scope.mode = "simple";
          }
          continue;
        }
        if (key === "put node text on incoming edges") {
          scope.putNodeTextIncomingOptions.push(entry.valueRaw);
          scope.asTextOverride = "";
          continue;
        }
        if (key === "put node text on outgoing edges") {
          scope.putNodeTextOutgoingOptions.push(entry.valueRaw);
          scope.asTextOverride = "";
          continue;
        }
      } else if (entry.kind === "flag") {
        const key = normalizeGraphOptionKey(entry.key);
        if (key === "simple") {
          scope.mode = "simple";
          continue;
        }
        if (key === "multi") {
          scope.mode = "multi";
          continue;
        }
        if (key === "fresh nodes") {
          scope.nodeResolution = "fresh";
          continue;
        }
        if (key === "use existing nodes") {
          scope.nodeResolution = "existing";
          continue;
        }
        if (key === "number nodes") {
          scope = applyNumberNodes(scope, undefined);
          continue;
        }
        if (key === "put node text on incoming edges") {
          scope.putNodeTextIncomingOptions.push("");
          scope.asTextOverride = "";
          continue;
        }
        if (key === "put node text on outgoing edges") {
          scope.putNodeTextOutgoingOptions.push("");
          scope.asTextOverride = "";
          continue;
        }
      } else {
        const rawToken = normalizeGraphOptionKey(entry.raw.trim().toLowerCase());
        if (rawToken === "simple") {
          scope.mode = "simple";
          continue;
        }
        if (rawToken === "multi") {
          scope.mode = "multi";
          continue;
        }
      }
    }

    return scope;
  }

  private parseDirectNode(raw: string, from: number): ParsedDirectNodeSpec {
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

    let explicitReference = false;
    if (nameRaw.startsWith("(") && nameRaw.endsWith(")")) {
      nameRaw = stripOuterParens(nameRaw).trim();
      explicitReference = true;
      if (textRaw.length === 0) {
        textRaw = nameRaw;
      }
    }

    const nameToken = parseGraphNameToken(nameRaw);
    const textToken = textRaw.length > 0 ? parseGraphTextToken(textRaw) : { text: nameToken.text };

    return {
      baseName: nameToken.text,
      baseNameWasQuoted: nameToken.quoted,
      textCandidate: textToken.text,
      explicitReference,
      options: nodeOptions,
      span: {
        from,
        to: from + raw.length
      }
    };
  }

  private ensureNodeRecord(name: string): GraphNodeRecord {
    const existing = this.nodeRecords.get(name);
    if (existing) {
      return existing;
    }

    const created: GraphNodeRecord = {
      name,
      created: false,
      sourceEdgeOptionLists: [],
      targetEdgeOptionLists: [],
      sourceEdgeNodes: [],
      targetEdgeNodes: []
    };
    this.nodeRecords.set(name, created);
    return created;
  }

  private applyNodeAccumulatorOps(record: GraphNodeRecord, operations: GraphNodeAccumulatorOp[]): void {
    for (const operation of operations) {
      if (operation.kind === "clear-target") {
        record.targetEdgeOptionLists = [];
        record.targetEdgeNodes = [];
        continue;
      }
      if (operation.kind === "clear-source") {
        record.sourceEdgeOptionLists = [];
        record.sourceEdgeNodes = [];
        continue;
      }
      if (operation.kind === "add-target-style") {
        record.targetEdgeOptionLists.push(operation.options);
        continue;
      }
      if (operation.kind === "add-source-style") {
        record.sourceEdgeOptionLists.push(operation.options);
        continue;
      }
      if (operation.kind === "add-target-node") {
        record.targetEdgeNodes.push(clonePlannedEdgeNode(operation.node));
        continue;
      }
      if (operation.kind === "add-source-node") {
        record.sourceEdgeNodes.push(clonePlannedEdgeNode(operation.node));
      }
    }
  }

  private ensurePlannedNode(
    record: GraphNodeRecord,
    name: string,
    text: string,
    options: OptionListAst | undefined,
    span: Span
  ): void {
    if (record.created) {
      return;
    }

    const placementSlot = this.placementIndex;
    this.placementIndex += 1;

    this.nodes.push({
      name,
      text,
      options,
      span,
      defaultPoint: {
        x: (placementSlot % 8) * DEFAULT_GRAPH_STEP_PT,
        y: -Math.floor(placementSlot / 8) * DEFAULT_GRAPH_STEP_PT
      }
    });

    record.created = true;
  }

  private nextAnonymousNodeName(): string {
    const name = `__graph_anon_${this.anonymousNodeCounter}`;
    this.anonymousNodeCounter += 1;
    return name;
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

function applyNumberNodes(scope: GraphScopeState, valueRaw: string | undefined): GraphScopeState {
  if (valueRaw == null) {
    return {
      ...scope,
      numbering: {
        enabled: true,
        next: 1,
        separator: scope.numbering.separator
      }
    };
  }

  const booleanValue = parseGraphBoolean(valueRaw, true);
  if (booleanValue === false) {
    return {
      ...scope,
      numbering: {
        enabled: false,
        next: scope.numbering.next,
        separator: scope.numbering.separator
      }
    };
  }

  const parsedStart = parseGraphNumber(valueRaw);
  return {
    ...scope,
    numbering: {
      enabled: true,
      next: parsedStart ?? 1,
      separator: scope.numbering.separator
    }
  };
}

function applyNumberNodesSeparator(scope: GraphScopeState, separator: string): GraphScopeState {
  return {
    ...scope,
    numbering: {
      enabled: scope.numbering.enabled,
      next: scope.numbering.next,
      separator
    }
  };
}

function appendScopedNamePrefix(scope: GraphScopeState, rawName: string): GraphScopeState {
  if (rawName.length === 0) {
    return scope;
  }

  const nextPrefix =
    scope.namePrefix.length === 0 ? rawName : `${scope.namePrefix}${scope.nameSeparator}${rawName}`;
  return {
    ...scope,
    namePrefix: nextPrefix
  };
}

function parseDirectionalEdgeShortcut(rawToken: string, span: Span): GraphNodeAccumulatorOp[] {
  const trimmed = rawToken.trim();
  if (!(trimmed.startsWith(">") || trimmed.startsWith("<"))) {
    return [];
  }

  const direction = trimmed[0]!;
  const payload = trimmed.slice(1).trim();
  if (payload.length === 0) {
    return [];
  }

  if (payload.startsWith("\"")) {
    const quote = readQuotedText(payload, 0);
    if (!quote) {
      return [];
    }
    const text = quote.text;
    const trailingOptions = payload.slice(quote.next).trim();
    const node = makeGraphEdgeNode(text, trailingOptions, span, true);
    return [direction === ">" ? { kind: "add-target-node", node } : { kind: "add-source-node", node }];
  }

  const styleOptions = parseGraphValueAsOptionList(payload, span.from);
  if (!styleOptions) {
    return [];
  }
  return [direction === ">" ? { kind: "add-target-style", options: styleOptions } : { kind: "add-source-style", options: styleOptions }];
}

function makeAddTargetNodeOp(text: string, optionsRaw: string, span: Span, defaultAuto: boolean): GraphNodeAccumulatorOp {
  return {
    kind: "add-target-node",
    node: makeGraphEdgeNode(text, optionsRaw, span, defaultAuto)
  };
}

function makeAddSourceNodeOp(text: string, optionsRaw: string, span: Span, defaultAuto: boolean): GraphNodeAccumulatorOp {
  return {
    kind: "add-source-node",
    node: makeGraphEdgeNode(text, optionsRaw, span, defaultAuto)
  };
}

function makeGraphEdgeNode(textRaw: string, optionsRaw: string, span: Span, defaultAuto: boolean): GraphPlannedEdgeNode {
  const parsedOptions = parseGraphValueAsOptionList(optionsRaw, span.from);
  const mergedOptions =
    defaultAuto
      ? mergeOptionLists([
          parseOptionListRaw("[auto]", span.from),
          ...(parsedOptions ? [parsedOptions] : [])
        ])
      : parsedOptions;

  return {
    text: normalizeGraphText(textRaw),
    options: mergedOptions,
    span
  };
}

function parseGraphEdgeNodeValue(valueRaw: string, span: Span, defaultAuto: boolean): GraphPlannedEdgeNode | undefined {
  let working = stripWrappingBraces(valueRaw).trim();
  if (working.length === 0) {
    return undefined;
  }

  if (/^node\b/i.test(working)) {
    working = working.replace(/^node\b/i, "").trim();

    let optionRaw = "";
    if (working.startsWith("[")) {
      const optionSegment = readBalancedSegment(working, 0, "[", "]");
      if (optionSegment) {
        optionRaw = optionSegment.raw;
        working = working.slice(optionSegment.next).trim();
      }
    }

    let text = "";
    if (working.startsWith("{")) {
      const textSegment = readBalancedSegment(working, 0, "{", "}");
      if (textSegment) {
        text = textSegment.raw.slice(1, -1);
      } else {
        text = stripWrappingBraces(working);
      }
    } else {
      text = working;
    }

    const combinedOptions = stripOptionListBrackets(optionRaw);
    return makeGraphEdgeNode(text, combinedOptions, span, defaultAuto);
  }

  if (working.startsWith("\"")) {
    const quoted = readQuotedText(working, 0);
    if (quoted) {
      const trailingOptions = working.slice(quoted.next).trim();
      return makeGraphEdgeNode(quoted.text, trailingOptions, span, defaultAuto);
    }
  }

  return makeGraphEdgeNode(working, "", span, defaultAuto);
}

function parseGraphValueAsOptionList(valueRaw: string, from: number): OptionListAst | undefined {
  const normalized = stripWrappingBraces(valueRaw.trim());
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

function parseGraphBoolean(raw: string, defaultWhenOmitted: boolean): boolean | null {
  const normalized = stripWrappingBraces(raw).trim();
  if (normalized.length === 0) {
    return defaultWhenOmitted;
  }

  const token = stripMatchingQuotes(normalized).trim().toLowerCase();
  if (token.length === 0) {
    return defaultWhenOmitted;
  }
  if (token === "true" || token === "yes" || token === "on" || token === "1") {
    return true;
  }
  if (token === "false" || token === "no" || token === "off" || token === "0") {
    return false;
  }
  return null;
}

function parseGraphNumber(raw: string): number | null {
  const normalized = stripWrappingBraces(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  const value = Number(stripMatchingQuotes(normalized).trim());
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.floor(value);
}

function parseGraphNameToken(raw: string): { text: string; quoted: boolean } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("\"")) {
    const quoted = readQuotedText(trimmed, 0);
    if (quoted && trimmed.slice(quoted.next).trim().length === 0) {
      return {
        text: quoted.text.trim(),
        quoted: true
      };
    }
  }
  return {
    text: normalizeGraphText(trimmed),
    quoted: false
  };
}

function parseGraphTextToken(raw: string): { text: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("\"")) {
    const quoted = readQuotedText(trimmed, 0);
    if (quoted && trimmed.slice(quoted.next).trim().length === 0) {
      return { text: quoted.text };
    }
  }
  return { text: normalizeGraphText(trimmed) };
}

function canonicalizeQuotedNodeName(raw: string): string {
  let encoded = "";
  for (const character of raw) {
    if (/^[A-Za-z0-9 ]$/.test(character)) {
      encoded += character;
      continue;
    }

    const codePoint = character.codePointAt(0);
    if (codePoint == null) {
      continue;
    }
    encoded += `@u${codePoint.toString(16).toUpperCase()}@`;
  }
  return encoded.trim();
}

function normalizeGraphText(raw: string): string {
  const strippedBraces = stripOuterBraces(raw.trim())?.inner ?? raw.trim();
  const unquoted = stripMatchingQuotes(strippedBraces.trim());
  return unquoted.replaceAll('""', '"').trim();
}

function stripMatchingQuotes(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  return raw;
}

function stripWrappingBraces(raw: string): string {
  let normalized = raw.trim();
  while (true) {
    const stripped = stripOuterBraces(normalized);
    if (!stripped) {
      return normalized;
    }
    normalized = stripped.inner.trim();
  }
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
      if (inQuote && raw[index - 1] === '"') {
        index -= 1;
        continue;
      }
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
      if (inQuote && raw[index + 1] === '"') {
        index += 1;
        continue;
      }
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
      if (inQuote && raw[index + 1] === '"') {
        index += 1;
        continue;
      }
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
      if (inQuote && raw[index + 1] === '"') {
        index += 1;
        continue;
      }
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
      if (inQuote && raw[index + 1] === '"') {
        index += 1;
        continue;
      }
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

function optionListFromEntries(entries: OptionEntry[], base: OptionListAst): OptionListAst | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  return {
    span: base.span,
    raw: `[${entries.map((entry) => entry.raw).join(",")}]`,
    entries
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

function dedupeSimpleEdges(edges: GraphPlannedEdgeInternal[]): GraphPlannedEdgeInternal[] {
  const lastByPair = new Map<string, number>();
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index]!;
    if (edge.passthroughSimple) {
      continue;
    }
    lastByPair.set(simplePairKey(edge.from, edge.to), index);
  }

  const deduped: GraphPlannedEdgeInternal[] = [];
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index]!;
    if (edge.passthroughSimple) {
      deduped.push(edge);
      continue;
    }

    const key = simplePairKey(edge.from, edge.to);
    if (lastByPair.get(key) !== index) {
      continue;
    }

    if (edge.operator === "-!-") {
      continue;
    }

    deduped.push(edge);
  }
  return deduped;
}

function simplePairKey(left: string, right: string): string {
  return left <= right ? `${left}::${right}` : `${right}::${left}`;
}

function clonePlannedEdgeNode(node: GraphPlannedEdgeNode): GraphPlannedEdgeNode {
  return {
    text: node.text,
    options: node.options,
    span: node.span
  };
}

function readQuotedText(raw: string, start: number): { text: string; next: number } | null {
  if (raw[start] !== '"') {
    return null;
  }

  let collected = "";
  let depthBrace = 0;
  for (let index = start + 1; index < raw.length; index += 1) {
    const char = raw[index]!;

    if (char === "\\" && index + 1 < raw.length) {
      collected += char;
      collected += raw[index + 1]!;
      index += 1;
      continue;
    }

    if (char === "{") {
      depthBrace += 1;
      collected += char;
      continue;
    }

    if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      collected += char;
      continue;
    }

    if (char === '"' && depthBrace === 0) {
      if (raw[index + 1] === '"') {
        collected += '"';
        index += 1;
        continue;
      }
      return {
        text: collected,
        next: index + 1
      };
    }

    collected += char;
  }

  return null;
}
