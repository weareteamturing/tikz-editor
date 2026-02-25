export type SemanticDependencyCategory = "geometry";

export type SemanticDependencyNodeKind = "source" | "resource";

export type SemanticDependencyResourceKind =
  | "named-coordinate"
  | "named-node-geometry"
  | "named-path";

export type SemanticDependencyOpaqueReason =
  | "foreach-origin"
  | "macro-origin";

export type SemanticDependencySourceNode = {
  id: string;
  kind: "source";
  sourceId: string;
  opaque: boolean;
  opaqueReasons: SemanticDependencyOpaqueReason[];
};

export type SemanticDependencyResourceNode = {
  id: string;
  kind: "resource";
  resourceKind: SemanticDependencyResourceKind;
  resourceKey: string;
};

export type SemanticDependencyNode =
  | SemanticDependencySourceNode
  | SemanticDependencyResourceNode;

export type SemanticDependencyRelation = "producer" | "consumer";

export type SemanticDependencyEdge = {
  from: string;
  to: string;
  category: SemanticDependencyCategory;
  relation: SemanticDependencyRelation;
};

export type SemanticDependencyGraph = {
  nodes: SemanticDependencyNode[];
  edges: SemanticDependencyEdge[];
};

export type GeometryInvalidationQuery = {
  changedSourceIds: readonly string[];
};

export type GeometryInvalidationResult = {
  affectedSourceIds: string[];
  opaqueSourceIds: string[];
  reachedOpaque: boolean;
};

export type SemanticDependencyGraphBuilderState = {
  sourceNodes: Array<{
    sourceId: string;
    opaqueReasons: SemanticDependencyOpaqueReason[];
  }>;
  resourceNodes: Array<{
    id: string;
    resourceKind: SemanticDependencyResourceKind;
    resourceKey: string;
  }>;
  edges: SemanticDependencyEdge[];
};

type MutableSourceNodeState = {
  sourceId: string;
  opaqueReasons: Set<SemanticDependencyOpaqueReason>;
};

type MutableResourceNodeState = {
  resourceKind: SemanticDependencyResourceKind;
  resourceKey: string;
};

const GEOMETRY_CATEGORY: SemanticDependencyCategory = "geometry";

export class SemanticDependencyGraphBuilder {
  private sourceNodes = new Map<string, MutableSourceNodeState>();
  private resourceNodes = new Map<string, MutableResourceNodeState>();
  private edges = new Map<string, SemanticDependencyEdge>();

  ensureSourceNode(sourceId: string): string {
    const existing = this.sourceNodes.get(sourceId);
    if (!existing) {
      this.sourceNodes.set(sourceId, {
        sourceId,
        opaqueReasons: new Set()
      });
    }
    return sourceNodeId(sourceId);
  }

  ensureResourceNode(kind: SemanticDependencyResourceKind, key: string): string {
    const resourceNodeKey = resourceNodeId(kind, key);
    const existing = this.resourceNodes.get(resourceNodeKey);
    if (!existing) {
      this.resourceNodes.set(resourceNodeKey, {
        resourceKind: kind,
        resourceKey: key
      });
    }
    return resourceNodeKey;
  }

  addProducer(sourceId: string, resourceKind: SemanticDependencyResourceKind, resourceKey: string): void {
    const sourceIdNode = this.ensureSourceNode(sourceId);
    const resourceIdNode = this.ensureResourceNode(resourceKind, resourceKey);
    this.addEdge({
      from: sourceIdNode,
      to: resourceIdNode,
      category: GEOMETRY_CATEGORY,
      relation: "producer"
    });
  }

  addConsumer(sourceId: string, resourceKind: SemanticDependencyResourceKind, resourceKey: string): void {
    const sourceIdNode = this.ensureSourceNode(sourceId);
    const resourceIdNode = this.ensureResourceNode(resourceKind, resourceKey);
    this.addEdge({
      from: resourceIdNode,
      to: sourceIdNode,
      category: GEOMETRY_CATEGORY,
      relation: "consumer"
    });
  }

  markSourceOpaque(sourceId: string, reason: SemanticDependencyOpaqueReason): void {
    this.ensureSourceNode(sourceId);
    const sourceNode = this.sourceNodes.get(sourceId);
    if (sourceNode) {
      sourceNode.opaqueReasons.add(reason);
    }
  }

  build(): SemanticDependencyGraph {
    const nodes: SemanticDependencyNode[] = [];

    for (const sourceNode of this.sourceNodes.values()) {
      const opaqueReasons = [...sourceNode.opaqueReasons].sort();
      nodes.push({
        id: sourceNodeId(sourceNode.sourceId),
        kind: "source",
        sourceId: sourceNode.sourceId,
        opaque: opaqueReasons.length > 0,
        opaqueReasons
      });
    }

    for (const [id, resourceNode] of this.resourceNodes) {
      nodes.push({
        id,
        kind: "resource",
        resourceKind: resourceNode.resourceKind,
        resourceKey: resourceNode.resourceKey
      });
    }

    nodes.sort((left, right) => left.id.localeCompare(right.id));
    const edges = [...this.edges.values()].sort(compareEdges);

    return {
      nodes,
      edges
    };
  }

  exportState(): SemanticDependencyGraphBuilderState {
    const sourceNodes = [...this.sourceNodes.values()]
      .map((sourceNode) => ({
        sourceId: sourceNode.sourceId,
        opaqueReasons: [...sourceNode.opaqueReasons].sort()
      }))
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    const resourceNodes = [...this.resourceNodes.entries()]
      .map(([id, node]) => ({
        id,
        resourceKind: node.resourceKind,
        resourceKey: node.resourceKey
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const edges = [...this.edges.values()].sort(compareEdges);
    return {
      sourceNodes,
      resourceNodes,
      edges
    };
  }

  importState(state: SemanticDependencyGraphBuilderState): void {
    const nextSourceNodes = new Map<string, MutableSourceNodeState>();
    for (const sourceNode of state.sourceNodes) {
      nextSourceNodes.set(sourceNode.sourceId, {
        sourceId: sourceNode.sourceId,
        opaqueReasons: new Set(sourceNode.opaqueReasons)
      });
    }

    const nextResourceNodes = new Map<string, MutableResourceNodeState>();
    for (const resourceNode of state.resourceNodes) {
      nextResourceNodes.set(resourceNode.id, {
        resourceKind: resourceNode.resourceKind,
        resourceKey: resourceNode.resourceKey
      });
    }

    const nextEdges = new Map<string, SemanticDependencyEdge>();
    for (const edge of state.edges) {
      const edgeKey = `${edge.from}|${edge.to}|${edge.category}|${edge.relation}`;
      nextEdges.set(edgeKey, {
        from: edge.from,
        to: edge.to,
        category: edge.category,
        relation: edge.relation
      });
    }

    this.sourceNodes = nextSourceNodes;
    this.resourceNodes = nextResourceNodes;
    this.edges = nextEdges;
  }

  clone(): SemanticDependencyGraphBuilder {
    const cloned = new SemanticDependencyGraphBuilder();
    cloned.importState(this.exportState());
    return cloned;
  }

  private addEdge(edge: SemanticDependencyEdge): void {
    const edgeKey = `${edge.from}|${edge.to}|${edge.category}|${edge.relation}`;
    if (this.edges.has(edgeKey)) {
      return;
    }
    this.edges.set(edgeKey, edge);
  }
}

export function collectGeometryInvalidation(
  graph: SemanticDependencyGraph,
  query: GeometryInvalidationQuery
): GeometryInvalidationResult {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const adjacency = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (edge.category !== GEOMETRY_CATEGORY) {
      continue;
    }
    const existing = adjacency.get(edge.from);
    if (existing) {
      existing.push(edge.to);
    } else {
      adjacency.set(edge.from, [edge.to]);
    }
  }

  const queue: string[] = [];
  const visited = new Set<string>();

  for (const sourceId of new Set(query.changedSourceIds)) {
    const id = sourceNodeId(sourceId);
    if (!nodeById.has(id)) {
      continue;
    }
    if (visited.has(id)) {
      continue;
    }
    visited.add(id);
    queue.push(id);
  }

  const affectedSourceIds = new Set<string>();
  const opaqueSourceIds = new Set<string>();

  while (queue.length > 0) {
    const nextId = queue.shift();
    if (!nextId) {
      continue;
    }
    const node = nodeById.get(nextId);
    if (!node) {
      continue;
    }

    if (node.kind === "source") {
      affectedSourceIds.add(node.sourceId);
      if (node.opaque) {
        opaqueSourceIds.add(node.sourceId);
        continue;
      }
    }

    for (const neighbor of adjacency.get(nextId) ?? []) {
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  const sortedAffectedSourceIds = [...affectedSourceIds].sort();
  const sortedOpaqueSourceIds = [...opaqueSourceIds].sort();

  return {
    affectedSourceIds: sortedAffectedSourceIds,
    opaqueSourceIds: sortedOpaqueSourceIds,
    reachedOpaque: sortedOpaqueSourceIds.length > 0
  };
}

function compareEdges(left: SemanticDependencyEdge, right: SemanticDependencyEdge): number {
  if (left.from !== right.from) {
    return left.from.localeCompare(right.from);
  }
  if (left.to !== right.to) {
    return left.to.localeCompare(right.to);
  }
  return left.relation.localeCompare(right.relation);
}

export function sourceNodeId(sourceId: string): string {
  return `source:${sourceId}`;
}

export function resourceNodeId(kind: SemanticDependencyResourceKind, resourceKey: string): string {
  return `resource:${kind}:${resourceKey}`;
}
