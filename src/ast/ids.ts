export function pathStatementId(statementIndex: number): string {
  return `path:${statementIndex}`;
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

export function pathOptionItemId(statementIndex: number, itemIndex: number): string {
  return `path-option:${statementIndex}:${itemIndex}`;
}

export function pathKeywordItemId(statementIndex: number, itemIndex: number): string {
  return `path-keyword:${statementIndex}:${itemIndex}`;
}

export function unknownPathItemId(statementIndex: number, itemIndex: number): string {
  return `unknown-path-item:${statementIndex}:${itemIndex}`;
}
