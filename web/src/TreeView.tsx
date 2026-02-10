import { Tree, TreeCursor } from "@lezer/common";
import { useState, useMemo } from "react";

interface TreeNodeData {
  name: string;
  from: number;
  to: number;
  isError: boolean;
  children: TreeNodeData[];
  text: string;
}

function buildTree(tree: Tree, source: string): TreeNodeData[] {
  const roots: TreeNodeData[] = [];
  const stack: TreeNodeData[][] = [roots];

  tree.iterate({
    enter(node) {
      const data: TreeNodeData = {
        name: node.name,
        from: node.from,
        to: node.to,
        isError: node.name === "⚠",
        children: [],
        text: source.slice(node.from, node.to),
      };
      stack[stack.length - 1].push(data);
      stack.push(data.children);
    },
    leave() {
      stack.pop();
    },
  });

  return roots;
}

function TreeNode({
  node,
  depth,
  onHover,
}: {
  node: TreeNodeData;
  depth: number;
  onHover: (range: [number, number] | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;
  const isLeaf = !hasChildren;

  const truncatedText =
    node.text.length > 60 ? node.text.slice(0, 60) + "…" : node.text;

  return (
    <div className="tree-node" style={{ paddingLeft: depth * 10 }}>
      <div
        className={`tree-node-header ${node.isError ? "tree-error" : ""}`}
        onClick={() => hasChildren && setCollapsed(!collapsed)}
        onMouseEnter={() => onHover([node.from, node.to])}
        onMouseLeave={() => onHover(null)}
      >
        {hasChildren ? (
          <span className="tree-toggle">{collapsed ? "▶" : "▼"}</span>
        ) : (
          <span className="tree-toggle-placeholder" />
        )}
        <span className="tree-name">{node.name}</span>
        <span className="tree-range">
          [{node.from}–{node.to}]
        </span>
        {isLeaf && (
          <span className="tree-text">
            {" "}
            "{truncatedText}"
          </span>
        )}
      </div>
      {hasChildren && !collapsed && (
        <div className="tree-children">
          {node.children.map((child, i) => (
            <TreeNode key={i} node={child} depth={depth + 1} onHover={onHover} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TreeView({
  tree,
  source,
  onHover,
}: {
  tree: Tree | null;
  source: string;
  onHover: (range: [number, number] | null) => void;
}) {
  const nodes = useMemo(
    () => (tree ? buildTree(tree, source) : []),
    [tree, source]
  );

  if (!tree) return <div className="tree-view">No parse tree</div>;

  return (
    <div className="tree-view">
      {nodes.map((node, i) => (
        <TreeNode key={i} node={node} depth={0} onHover={onHover} />
      ))}
    </div>
  );
}
