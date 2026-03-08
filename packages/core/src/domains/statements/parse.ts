import type { SyntaxNode } from "@lezer/common";

import {
  foreachStatementId,
  macroAliasStatementId,
  macroCommandDefinitionStatementId,
  macroDefinitionStatementId,
  scopeStatementId
} from "../../ast/ids.js";
import type {
  ForeachStatement,
  MacroAliasStatement,
  MacroCommandDefinitionStatement,
  MacroDefinitionStatement,
  ScopeStatement,
  Span,
  Statement
} from "../../ast/types.js";
import { mapPathStatement } from "../paths/parse.js";
import { mapUnknownStatement } from "../../transform/unknown.js";
import { parseOptionListRaw } from "../../options/parse.js";
import { parseForeachHeaderRaw } from "../../foreach/header.js";
import { findFirstChildByName, findFirstNodeByName, firstNamedChild, forEachChild } from "../../syntax/cursor.js";

export type StatementMappingState = {
  nextStatementIndex: number;
};

export function mapBodyStatements(node: SyntaxNode, source: string, state: StatementMappingState): Statement[] {
  const statements: Statement[] = [];

  forEachChild(node, (child) => {
    const actualBodyItem = child.type.name === "BodyItem" ? (firstNamedChild(child) ?? child) : child;
    const maybeStatement = actualBodyItem.type.name === "Statement" ? (firstNamedChild(actualBodyItem) ?? actualBodyItem) : actualBodyItem;

    const mapped = mapStatementNode(maybeStatement, source, state);
    if (mapped) {
      statements.push(mapped);
    }
  });

  return statements;
}

function mapStatementNode(node: SyntaxNode, source: string, state: StatementMappingState): Statement | null {
  if (node.type.name === "PathStatement") {
    return mapPathStatement(node, source, allocateStatementIndex(state));
  }

  if (node.type.name === "UnknownStatement") {
    return mapUnknownStatement(node, source, allocateStatementIndex(state));
  }

  if (node.type.name === "StyleDefinitionStatement") {
    return mapUnknownStatement(node, source, allocateStatementIndex(state));
  }

  if (node.type.name === "ColorletStatement") {
    return mapUnknownStatement(node, source, allocateStatementIndex(state));
  }

  if (node.type.name === "DefineColorStatement") {
    return mapUnknownStatement(node, source, allocateStatementIndex(state));
  }

  if (node.type.name === "TikzLibraryStatement") {
    return mapUnknownStatement(node, source, allocateStatementIndex(state));
  }

  if (node.type.name === "MacroDefinitionStatement") {
    return mapMacroDefinitionStatement(node, source, state);
  }

  if (node.type.name === "MacroAliasStatement") {
    return mapMacroAliasStatement(node, source, state);
  }

  if (node.type.name === "MacroCommandDefinitionStatement") {
    return mapMacroCommandDefinitionStatement(node, source, state);
  }

  if (node.type.name === "TikzSetStatement" || node.type.name === "TikzStyleStatement" || node.type.name === "PgfkeysStatement") {
    return mapUnknownStatement(node, source, allocateStatementIndex(state));
  }

  if (node.type.name === "FontSizeStatement") {
    return mapUnknownStatement(node, source, allocateStatementIndex(state));
  }

  if (node.type.name === "ScopeStatement") {
    return mapScopeStatement(node, source, state);
  }

  if (node.type.name === "ForeachStatement") {
    return mapForeachStatement(node, source, state);
  }

  return null;
}

function mapScopeStatement(node: SyntaxNode, source: string, state: StatementMappingState): ScopeStatement {
  const statementIndex = allocateStatementIndex(state);
  const optionsNode = findFirstChildByName(node, "OptionList");

  return {
    kind: "Scope",
    id: scopeStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    body: mapBodyStatements(node, source, state)
  };
}

function mapForeachStatement(node: SyntaxNode, source: string, state: StatementMappingState): ForeachStatement {
  const statementIndex = allocateStatementIndex(state);
  const foreachCmdNode = findFirstChildByName(node, "ForeachCmd");
  const foreachBodyNode = findFirstChildByName(node, "ForeachBody");

  const prefixFrom = foreachCmdNode ? foreachCmdNode.to : node.from;
  const prefixTo = foreachBodyNode ? foreachBodyNode.from : node.to;
  const prefixSlice = source.slice(prefixFrom, Math.max(prefixFrom, prefixTo));
  const parsedHeader = parseForeachHeaderRaw(prefixSlice);
  const headerStartOffset = prefixSlice.indexOf(parsedHeader.headerRaw);
  const headerFrom = headerStartOffset >= 0 ? prefixFrom + headerStartOffset : prefixFrom;
  const bodyRaw = foreachBodyNode ? source.slice(foreachBodyNode.from, foreachBodyNode.to) : "";

  const options =
    parsedHeader.optionsRaw && parsedHeader.optionsSpan
      ? parseOptionListRaw(parsedHeader.optionsRaw, headerFrom + parsedHeader.optionsSpan.from)
      : undefined;
  const optionsSpan =
    parsedHeader.optionsSpan != null
      ? {
          from: headerFrom + parsedHeader.optionsSpan.from,
          to: headerFrom + parsedHeader.optionsSpan.to
        }
      : undefined;
  const headerSpan =
    parsedHeader.headerRaw.length > 0
      ? {
          from: headerFrom,
          to: headerFrom + parsedHeader.headerRaw.length
        }
      : undefined;

  return {
    kind: "Foreach",
    id: foreachStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    options,
    optionsSpan,
    headerSpan,
    headerRaw: parsedHeader.headerRaw,
    variablesRaw: parsedHeader.variablesRaw,
    listRaw: parsedHeader.listRaw,
    prefixRaw: parsedHeader.headerRaw,
    bodyRaw
  };
}

function mapMacroDefinitionStatement(node: SyntaxNode, source: string, state: StatementMappingState): MacroDefinitionStatement {
  const statementIndex = allocateStatementIndex(state);
  const nameNode = findFirstChildByName(node, "CommandName");
  const valueNode = findFirstChildByName(node, "Group");

  return {
    kind: "MacroDefinition",
    id: macroDefinitionStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw: "\\def",
    nameRaw: nameNode ? source.slice(nameNode.from, nameNode.to) : "",
    nameSpan: toSpan(nameNode),
    valueRaw: valueNode ? extractGroupInnerRaw(valueNode, source) : "",
    valueSpan: valueNode ? toGroupInnerSpan(valueNode, source) : undefined
  };
}

function mapMacroAliasStatement(node: SyntaxNode, source: string, state: StatementMappingState): MacroAliasStatement {
  const statementIndex = allocateStatementIndex(state);
  const nameNode = findFirstChildByName(node, "CommandName");
  const targetNode = findFirstChildByName(node, "LetAliasTarget");
  const targetCommandNode = targetNode ? findFirstChildByName(targetNode, "CommandName") : null;
  const targetGroupNode = targetNode ? findFirstChildByName(targetNode, "Group") : null;

  return {
    kind: "MacroAlias",
    id: macroAliasStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw: "\\let",
    nameRaw: nameNode ? source.slice(nameNode.from, nameNode.to) : "",
    nameSpan: toSpan(nameNode),
    targetRaw: targetCommandNode
      ? source.slice(targetCommandNode.from, targetCommandNode.to)
      : targetGroupNode
        ? extractGroupInnerRaw(targetGroupNode, source)
        : "",
    targetSpan: targetCommandNode
      ? toSpan(targetCommandNode)
      : targetGroupNode
        ? toGroupInnerSpan(targetGroupNode, source)
        : undefined
  };
}

function mapMacroCommandDefinitionStatement(
  node: SyntaxNode,
  source: string,
  state: StatementMappingState
): MacroCommandDefinitionStatement {
  const statementIndex = allocateStatementIndex(state);
  const newCommandNode = findFirstChildByName(node, "NewCommandCmd");
  const renewCommandNode = findFirstChildByName(node, "RenewCommandCmd");
  const commandNode = newCommandNode ?? renewCommandNode;
  const commandRaw = renewCommandNode ? "\\renewcommand" : "\\newcommand";
  const commandNameNode = findFirstChildByName(node, "MacroCommandName");
  const commandNameTokenNode = commandNameNode ? findFirstChildByName(commandNameNode, "CommandName") : null;
  const commandNameGroupNode = commandNameNode ? findFirstChildByName(commandNameNode, "Group") : null;
  const bodyNode = resolveMacroCommandBodyNode(node, source);
  const arityNode = findFirstNodeByName(node, "MacroCommandArity");
  const arityNumberNode = arityNode ? findFirstChildByName(arityNode, "Number") : null;
  const defaultArgNode = findFirstNodeByName(node, "MacroCommandDefaultArg");

  const parsedNameFromGroup = commandNameGroupNode ? parseCommandNameFromGroup(commandNameGroupNode, source) : null;
  const nameRaw = commandNameTokenNode
    ? source.slice(commandNameTokenNode.from, commandNameTokenNode.to)
    : parsedNameFromGroup?.nameRaw ?? "";
  const nameSpan = commandNameTokenNode ? toSpan(commandNameTokenNode) : parsedNameFromGroup?.nameSpan;

  const arityRaw = arityNumberNode ? source.slice(arityNumberNode.from, arityNumberNode.to) : "";
  const parsedArity = Number.parseInt(arityRaw, 10);
  const arity = Number.isFinite(parsedArity) ? Math.max(0, parsedArity) : 0;

  const starred =
    commandNode != null && commandNameNode != null
      ? source.slice(commandNode.to, commandNameNode.from).includes("*")
      : false;

  return {
    kind: "MacroCommandDefinition",
    id: macroCommandDefinitionStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw,
    nameRaw,
    nameSpan,
    arity,
    aritySpan: toSpan(arityNumberNode),
    optionalDefaultRaw: defaultArgNode ? extractBracketInnerRaw(defaultArgNode, source) : undefined,
    optionalDefaultSpan: defaultArgNode ? toBracketInnerSpan(defaultArgNode, source) : undefined,
    bodyRaw: bodyNode ? extractGroupInnerRaw(bodyNode, source) : "",
    bodySpan: bodyNode ? toGroupInnerSpan(bodyNode, source) : undefined,
    starred
  };
}

function resolveMacroCommandBodyNode(node: SyntaxNode, source: string): SyntaxNode | null {
  const groups: SyntaxNode[] = [];
  forEachChild(node, (child) => {
    if (child.type.name === "Group") {
      groups.push(child);
      return;
    }

    if (child.type.name === "MacroCommandName") {
      const groupedName = findFirstChildByName(child, "Group");
      if (groupedName) {
        groups.push(groupedName);
      }
    }
  });

  if (groups.length === 0) {
    return null;
  }
  return groups[groups.length - 1];
}

function parseCommandNameFromGroup(
  groupNode: SyntaxNode,
  source: string
): { nameRaw: string; nameSpan?: Span } | null {
  const inner = toGroupInnerSpan(groupNode, source);
  const innerRaw = source.slice(inner.from, inner.to);
  const match = /\\[A-Za-z@]+/.exec(innerRaw);
  if (!match) {
    return null;
  }

  const from = inner.from + match.index;
  const to = from + match[0].length;
  return {
    nameRaw: match[0],
    nameSpan: { from, to }
  };
}

function toGroupInnerSpan(node: SyntaxNode, source: string): Span {
  const hasOpen = source[node.from] === "{";
  const hasClose = source[node.to - 1] === "}";
  const from = hasOpen ? node.from + 1 : node.from;
  const to = hasClose ? node.to - 1 : node.to;
  return {
    from,
    to: Math.max(from, to)
  };
}

function extractGroupInnerRaw(node: SyntaxNode, source: string): string {
  const span = toGroupInnerSpan(node, source);
  return source.slice(span.from, span.to);
}

function toBracketInnerSpan(node: SyntaxNode, source: string): Span {
  const hasOpen = source[node.from] === "[";
  const hasClose = source[node.to - 1] === "]";
  const from = hasOpen ? node.from + 1 : node.from;
  const to = hasClose ? node.to - 1 : node.to;
  return {
    from,
    to: Math.max(from, to)
  };
}

function extractBracketInnerRaw(node: SyntaxNode, source: string): string {
  const span = toBracketInnerSpan(node, source);
  return source.slice(span.from, span.to);
}

function toSpan(node: SyntaxNode | null): Span | undefined {
  if (!node) {
    return undefined;
  }
  return { from: node.from, to: node.to };
}

function allocateStatementIndex(state: StatementMappingState): number {
  const statementIndex = state.nextStatementIndex;
  state.nextStatementIndex += 1;
  return statementIndex;
}
