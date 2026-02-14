import type { SyntaxNode } from "@lezer/common";

import { foreachStatementId, scopeStatementId } from "../../ast/ids.js";
import type { ForeachStatement, ScopeStatement, Statement } from "../../ast/types.js";
import { mapPathStatement } from "../paths/parse.js";
import { mapUnknownStatement } from "../../transform/unknown.js";
import { parseOptionListRaw } from "../../options/parse.js";
import { parseForeachHeaderRaw } from "../../foreach/header.js";
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

  if (node.type.name === "StyleDefinitionStatement") {
    return mapUnknownStatement(node, source, allocateStatementIndex(state));
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

function allocateStatementIndex(state: StatementMappingState): number {
  const statementIndex = state.nextStatementIndex;
  state.nextStatementIndex += 1;
  return statementIndex;
}
