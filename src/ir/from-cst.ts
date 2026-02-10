import type { SyntaxNode, Tree } from "@lezer/common";

import type { Diagnostic } from "../diagnostics/types.js";
import type {
  CoordinateForm,
  CoordinateItem,
  NodeItem,
  PathCommand,
  PathItem,
  PathKeywordItem,
  PathOptionItem,
  PathStatement,
  Span,
  Statement,
  TikzFigure,
  UnknownPathItem,
  UnknownStatement
} from "./types.js";

export type CstToIrResult = {
  figure: TikzFigure;
  diagnostics: Diagnostic[];
};

type PathItemContext = {
  command: PathCommand;
  syntheticNodeEmitted: boolean;
  pendingNodeOptions: SyntaxNode | null;
};

const PATH_KEYWORDS = new Set([
  "--",
  "-|",
  "|-",
  "..",
  "to",
  "edge",
  "at",
  "controls",
  "and",
  "cycle",
  "rectangle",
  "circle",
  "ellipse",
  "arc",
  "grid",
  "plot",
  "parabola",
  "sin",
  "cos"
]);

export function fromCst(tree: Tree, source: string): CstToIrResult {
  const diagnostics: Diagnostic[] = [];
  collectParseErrorDiagnostics(tree.topNode, diagnostics);

  const envNode = findFirstNodeByName(tree.topNode, "TikzEnvironment");
  if (!envNode) {
    diagnostics.push({
      severity: "warning",
      message: "No tikzpicture environment found.",
      span: { from: 0, to: source.length },
      code: "missing-tikzpicture"
    });

    return {
      figure: {
        kind: "Figure",
        span: { from: 0, to: source.length },
        body: []
      },
      diagnostics
    };
  }

  const body: Statement[] = [];
  const statementNodes: SyntaxNode[] = [];

  walk(envNode, (node) => {
    if (node.type.name === "PathStatement" || node.type.name === "UnknownStatement") {
      statementNodes.push(node);
    }
  });

  statementNodes.sort((a, b) => a.from - b.from);
  statementNodes.forEach((statementNode, statementIndex) => {
    if (statementNode.type.name === "PathStatement") {
      body.push(mapPathStatement(statementNode, source, statementIndex));
      return;
    }

    body.push(mapUnknownStatement(statementNode, source, statementIndex));
  });

  collectStructuralDiagnostics(envNode, source, diagnostics);

  return {
    figure: {
      kind: "Figure",
      span: { from: envNode.from, to: envNode.to },
      body
    },
    diagnostics
  };
}

function mapPathStatement(node: SyntaxNode, source: string, statementIndex: number): PathStatement {
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
    id: `path:${statementIndex}`,
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
    return mapCoordinate(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "NodeItem") {
    context.syntheticNodeEmitted = true;
    context.pendingNodeOptions = null;
    return mapNode(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "OptionList") {
    if (context.command === "node" && !context.syntheticNodeEmitted && !context.pendingNodeOptions) {
      context.pendingNodeOptions = actual;
      return null;
    }

    return mapPathOptionItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "Group" && context.command === "node" && !context.syntheticNodeEmitted) {
    const synthetic = mapSyntheticNode(actual, context.pendingNodeOptions, source, statementIndex, itemIndex);
    context.syntheticNodeEmitted = true;
    context.pendingNodeOptions = null;
    return synthetic;
  }

  const keyword = classifyPathKeyword(actual, source);
  if (keyword) {
    return mapPathKeywordItem(actual, keyword, statementIndex, itemIndex);
  }

  return mapUnknownPathItem(actual, source, statementIndex, itemIndex);
}

function mapCoordinate(node: SyntaxNode, source: string, statementIndex: number, itemIndex: number): CoordinateItem {
  const raw = source.slice(node.from, node.to);
  const parsed = parseCoordinate(raw);

  return {
    kind: "Coordinate",
    id: `coordinate:${statementIndex}:${itemIndex}`,
    span: { from: node.from, to: node.to },
    x: parsed.x,
    y: parsed.y,
    raw,
    form: parsed.form
  };
}

function mapNode(node: SyntaxNode, source: string, statementIndex: number, itemIndex: number): NodeItem {
  const groupNode = findFirstChildByName(node, "Group");
  const optionsNode = findFirstChildByName(node, "OptionList");

  const mappedText = mapGroupText(groupNode, source, node.to);

  return {
    kind: "Node",
    id: `node:${statementIndex}:${itemIndex}`,
    span: { from: node.from, to: node.to },
    optionsSpan: optionsNode ? { from: optionsNode.from, to: optionsNode.to } : undefined,
    textSpan: mappedText.textSpan,
    text: mappedText.text
  };
}

function mapSyntheticNode(
  groupNode: SyntaxNode,
  optionsNode: SyntaxNode | null,
  source: string,
  statementIndex: number,
  itemIndex: number
): NodeItem {
  const mappedText = mapGroupText(groupNode, source, groupNode.to);

  return {
    kind: "Node",
    id: `node:${statementIndex}:${itemIndex}`,
    span: {
      from: optionsNode ? optionsNode.from : groupNode.from,
      to: groupNode.to
    },
    optionsSpan: optionsNode ? { from: optionsNode.from, to: optionsNode.to } : undefined,
    textSpan: mappedText.textSpan,
    text: mappedText.text
  };
}

function mapGroupText(groupNode: SyntaxNode | null, source: string, fallbackOffset: number): { textSpan: Span; text: string } {
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

function mapPathOptionItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): PathOptionItem {
  return {
    kind: "PathOption",
    id: `path-option:${statementIndex}:${itemIndex}`,
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to)
  };
}

function mapPathKeywordItem(
  node: SyntaxNode,
  keyword: string,
  statementIndex: number,
  itemIndex: number
): PathKeywordItem {
  return {
    kind: "PathKeyword",
    id: `path-keyword:${statementIndex}:${itemIndex}`,
    span: { from: node.from, to: node.to },
    keyword
  };
}

function mapUnknownPathItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): UnknownPathItem {
  return {
    kind: "UnknownPathItem",
    id: `unknown-path-item:${statementIndex}:${itemIndex}`,
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to)
  };
}

function mapUnknownStatement(node: SyntaxNode, source: string, statementIndex: number): UnknownStatement {
  return {
    kind: "UnknownStatement",
    id: `unknown-statement:${statementIndex}`,
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to)
  };
}

function collectParseErrorDiagnostics(node: SyntaxNode, diagnostics: Diagnostic[]): void {
  const seen = new Set<string>();

  walk(node, (current) => {
    if (current.type.isError || current.type.name === "⚠") {
      const key = `${current.from}:${current.to}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);

      diagnostics.push({
        severity: "error",
        message: "Syntax error while parsing TikZ input.",
        span: { from: current.from, to: current.to },
        code: "parse-error"
      });
    }
  });
}

function collectStructuralDiagnostics(envNode: SyntaxNode, source: string, diagnostics: Diagnostic[]): void {
  walk(envNode, (node) => {
    if (node.type.name === "OptionList" && source[node.to - 1] !== "]") {
      diagnostics.push({
        severity: "warning",
        message: "Unclosed option list.",
        span: { from: node.from, to: node.to },
        code: "missing-option-close"
      });
    }

    if (node.type.name === "Group" && source[node.to - 1] !== "}") {
      diagnostics.push({
        severity: "warning",
        message: "Unclosed group.",
        span: { from: node.from, to: node.to },
        code: "missing-group-close"
      });
    }

    if (node.type.name === "Coordinate") {
      const raw = source.slice(node.from, node.to);
      if (!parseCoordinate(raw).isWellFormed) {
        diagnostics.push({
          severity: "warning",
          message: "Malformed coordinate.",
          span: { from: node.from, to: node.to },
          code: "malformed-coordinate"
        });
      }
    }
  });
}

function parseCoordinate(raw: string): { x: string; y: string; form: CoordinateForm; isWellFormed: boolean } {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("(")) {
    return { x: "", y: "", form: "unknown", isWellFormed: false };
  }

  const hasClosingParen = trimmed.endsWith(")");
  if (!hasClosingParen) {
    return { x: "", y: "", form: "unknown", isWellFormed: false };
  }

  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return { x: "", y: "", form: "unknown", isWellFormed: false };
  }

  if (inner.includes("$")) {
    return { x: inner, y: "", form: "calc", isWellFormed: true };
  }

  const commaSplit = splitAtTopLevel(inner, ",");
  if (commaSplit) {
    const x = commaSplit.left.trim();
    const y = commaSplit.right.trim();
    return {
      x,
      y,
      form: "cartesian",
      isWellFormed: x.length > 0 && y.length > 0
    };
  }

  const colonSplit = splitAtTopLevel(inner, ":");
  if (colonSplit) {
    const angle = colonSplit.left.trim();
    const radius = colonSplit.right.trim();
    return {
      x: angle,
      y: radius,
      form: "polar",
      isWellFormed: angle.length > 0 && radius.length > 0
    };
  }

  return {
    x: inner,
    y: "",
    form: "named",
    isWellFormed: true
  };
}

function splitAtTopLevel(input: string, separator: string): { left: string; right: string } | null {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === separator && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return {
        left: input.slice(0, i),
        right: input.slice(i + 1)
      };
    }
  }

  return null;
}

function classifyPathKeyword(node: SyntaxNode, source: string): string | null {
  const raw = source.slice(node.from, node.to).trim().toLowerCase();
  if (PATH_KEYWORDS.has(raw)) {
    return raw;
  }
  return null;
}

function normalizePathCommand(commandText: string): PathCommand {
  const normalized = commandText.trim().replace(/^\\/, "").toLowerCase();

  switch (normalized) {
    case "draw":
    case "path":
    case "fill":
    case "filldraw":
    case "clip":
    case "shade":
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

function unwrapPathItemNode(node: SyntaxNode): SyntaxNode {
  if (node.type.name === "UnknownPathItem") {
    return firstNamedChild(node) ?? node;
  }
  return node;
}

function findFirstNodeByName(root: SyntaxNode, name: string): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  walk(root, (node) => {
    if (!found && node.type.name === name) {
      found = node;
    }
  });
  return found;
}

function findFirstChildByName(node: SyntaxNode, name: string): SyntaxNode | null {
  let child = node.firstChild;
  while (child) {
    if (child.type.name === name) {
      return child;
    }
    child = child.nextSibling;
  }
  return null;
}

function firstNamedChild(node: SyntaxNode): SyntaxNode | null {
  let child = node.firstChild;
  while (child) {
    if (!child.type.isAnonymous) {
      return child;
    }
    child = child.nextSibling;
  }
  return null;
}

function forEachChild(node: SyntaxNode, fn: (child: SyntaxNode) => void): void {
  let child = node.firstChild;
  while (child) {
    fn(child);
    child = child.nextSibling;
  }
}

function walk(node: SyntaxNode, fn: (node: SyntaxNode) => void): void {
  fn(node);
  forEachChild(node, (child) => walk(child, fn));
}
