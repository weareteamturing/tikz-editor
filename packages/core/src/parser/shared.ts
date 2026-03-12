import type { Statement } from "../ast/types.js";

export type ContextDefinitionCacheEntry = {
  prefix: string;
  definitions: Statement[];
};

let contextDefinitionCache: ContextDefinitionCacheEntry | null = null;

export function getCachedContextDefinitions(
  prefix: string,
  collectContextDefinitions: (prefix: string) => Statement[]
): Statement[] {
  const cache = contextDefinitionCache;
  if (cache && cache.prefix === prefix) {
    return cache.definitions;
  }
  const definitions = collectContextDefinitions(prefix);
  contextDefinitionCache = { prefix, definitions };
  return definitions;
}

export function resolveParseWindowSource(
  source: string,
  activeFigureSpan: { from: number; to: number } | null
): string {
  if (!activeFigureSpan) {
    return source;
  }
  const safeFrom = Math.max(0, Math.min(source.length, activeFigureSpan.from));
  const safeTo = Math.max(safeFrom, Math.min(source.length, activeFigureSpan.to));
  const prefix = source.slice(0, safeFrom).replace(/[^\n]/g, " ");
  const figure = source.slice(safeFrom, safeTo);
  return `${prefix}${figure}`;
}

export function resolveActiveFigureSpan(
  spans: readonly { from: number; to: number }[],
  activeFigureId: string | null | undefined
): { from: number; to: number } | null {
  if (activeFigureId === null) {
    return null;
  }
  if (spans.length === 0) {
    return null;
  }
  const requestedIndex = activeFigureId ? parseFigureIndexFromId(activeFigureId) : 0;
  const index =
    requestedIndex != null && requestedIndex >= 0 && requestedIndex < spans.length
      ? requestedIndex
      : 0;
  return spans[index] ?? null;
}

export function scanFigureSpans(source: string): Array<{ from: number; to: number }> {
  const beginPattern = /\\begin\{tikzpicture\*?\}/g;
  const spans: Array<{ from: number; to: number }> = [];
  let match = beginPattern.exec(source);
  while (match) {
    const beginRaw = match[0] ?? "";
    const from = match.index;
    const beginTo = from + beginRaw.length;
    const endToken = beginRaw.endsWith("*}") ? "\\end{tikzpicture*}" : "\\end{tikzpicture}";
    const endFrom = source.indexOf(endToken, beginTo);
    if (endFrom < 0) {
      break;
    }
    spans.push({ from, to: endFrom + endToken.length });
    beginPattern.lastIndex = endFrom + endToken.length;
    match = beginPattern.exec(source);
  }
  return spans;
}

export function parseFigureIndexFromId(figureId: string): number | null {
  const match = /^figure:(\d+)(?::|$)/u.exec(figureId.trim());
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}
