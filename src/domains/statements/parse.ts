import type { SyntaxNode } from "@lezer/common";

import { foreachStatementId, scopeStatementId } from "../../ast/ids.js";
import type { ForeachStatement, ScopeStatement, Statement } from "../../ast/types.js";
import { mapPathStatement } from "../paths/parse.js";
import { mapUnknownStatement } from "../../transform/unknown.js";
import { parseOptionListRaw } from "../../options/parse.js";
import { findFirstChildByName, firstNamedChild, forEachChild } from "../../syntax/cursor.js";

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
  const optionsNode = findForeachOptionsNode(node);

  const prefixFrom = foreachCmdNode ? foreachCmdNode.to : node.from;
  const prefixTo = foreachBodyNode ? foreachBodyNode.from : node.to;
  const bodyRaw = foreachBodyNode ? source.slice(foreachBodyNode.from, foreachBodyNode.to) : "";

  return {
    kind: "Foreach",
    id: foreachStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    prefixRaw: source.slice(prefixFrom, Math.max(prefixFrom, prefixTo)).trim(),
    bodyRaw
  };
}

function findForeachOptionsNode(node: SyntaxNode): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  forEachChild(node, (child) => {
    if (found || child.type.name !== "ForeachPrefix") {
      return;
    }

    const actual = firstNamedChild(child) ?? child;
    if (actual.type.name === "OptionList") {
      found = actual;
    }
  });
  return found;
}

function allocateStatementIndex(state: StatementMappingState): number {
  const statementIndex = state.nextStatementIndex;
  state.nextStatementIndex += 1;
  return statementIndex;
}

