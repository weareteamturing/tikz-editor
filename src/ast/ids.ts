export function pathStatementId(statementIndex: number): string {
  return `path:${statementIndex}`;
}

export function scopeStatementId(statementIndex: number): string {
  return `scope:${statementIndex}`;
}

export function foreachStatementId(statementIndex: number): string {
  return `foreach:${statementIndex}`;
}

export function macroDefinitionStatementId(statementIndex: number): string {
  return `macro-definition:${statementIndex}`;
}

export function macroAliasStatementId(statementIndex: number): string {
  return `macro-alias:${statementIndex}`;
}

export function macroCommandDefinitionStatementId(statementIndex: number): string {
  return `macro-command-definition:${statementIndex}`;
}

export function unknownStatementId(statementIndex: number): string {
  return `unknown-statement:${statementIndex}`;
}

export function coordinateItemId(statementIndex: number, itemIndex: number): string {
  return `coordinate:${statementIndex}:${itemIndex}`;
}

export function nodeItemId(statementIndex: number, itemIndex: number): string {
  return `node:${statementIndex}:${itemIndex}`;
}

export function nodeForeachClauseId(statementIndex: number, itemIndex: number, clauseIndex: number): string {
  return `node-foreach-clause:${statementIndex}:${itemIndex}:${clauseIndex}`;
}

export function pathOptionItemId(statementIndex: number, itemIndex: number): string {
  return `path-option:${statementIndex}:${itemIndex}`;
}

export function pathCommentItemId(statementIndex: number, itemIndex: number): string {
  return `path-comment:${statementIndex}:${itemIndex}`;
}

export function pathKeywordItemId(statementIndex: number, itemIndex: number): string {
  return `path-keyword:${statementIndex}:${itemIndex}`;
}

export function pathForeachItemId(statementIndex: number, itemIndex: number): string {
  return `path-foreach:${statementIndex}:${itemIndex}`;
}

export function toOperationItemId(statementIndex: number, itemIndex: number): string {
  return `to-operation:${statementIndex}:${itemIndex}`;
}

export function edgeOperationItemId(statementIndex: number, itemIndex: number): string {
  return `edge-operation:${statementIndex}:${itemIndex}`;
}

export function svgOperationItemId(statementIndex: number, itemIndex: number): string {
  return `svg-operation:${statementIndex}:${itemIndex}`;
}

export function letOperationItemId(statementIndex: number, itemIndex: number): string {
  return `let-operation:${statementIndex}:${itemIndex}`;
}

export function decorateOperationItemId(statementIndex: number, itemIndex: number): string {
  return `decorate-operation:${statementIndex}:${itemIndex}`;
}

export function coordinateOperationItemId(statementIndex: number, itemIndex: number): string {
  return `coordinate-operation:${statementIndex}:${itemIndex}`;
}

export function unknownPathItemId(statementIndex: number, itemIndex: number): string {
  return `unknown-path-item:${statementIndex}:${itemIndex}`;
}
