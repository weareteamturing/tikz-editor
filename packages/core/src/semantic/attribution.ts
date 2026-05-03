import type { PathItem, PathStatement, Span, Statement } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type {
  ExpansionSourceMap,
  ForeachOriginFrame as ExpansionForeachOriginFrame,
  ForeachStatementAttribution
} from "../foreach/types.js";
import type { MacroOriginFrame } from "../macros/index.js";
import type { StyleChainEntry } from "./style-chain.js";
import type { EditHandle, SceneElement } from "./types.js";

export function mapExpansionSpan(sourceMap: ExpansionSourceMap, span: Span): Span {
  return sourceMap.mapSpan(span) ?? sourceMap.sourceSpan;
}

export function remapDiagnostics(
  diagnostics: Diagnostic[],
  fromIndex: number,
  sourceMap: ExpansionSourceMap | undefined
): void {
  if (!sourceMap) {
    return;
  }
  for (let index = fromIndex; index < diagnostics.length; index += 1) {
    const diagnostic = diagnostics[index];
    if (!diagnostic) {
      continue;
    }
    diagnostics[index] = {
      ...diagnostic,
      span: mapExpansionSpan(sourceMap, diagnostic.span)
    };
  }
}

export function finalizeExpandedStatementElements(args: {
  statement: Statement;
  elements: SceneElement[];
  statementAttribution: WeakMap<Statement, ForeachStatementAttribution>;
  statementSourceMap: ExpansionSourceMap | undefined;
  pathItemForeachStack: WeakMap<PathItem, ExpansionForeachOriginFrame[]>;
  statementMacroAttribution: WeakMap<Statement, MacroOriginFrame[]>;
  templateLocalIdByExpandedId: ReadonlyMap<string, string>;
}): SceneElement[] {
  const {
    statement,
    elements,
    statementAttribution,
    statementSourceMap,
    pathItemForeachStack,
    statementMacroAttribution,
    templateLocalIdByExpandedId
  } = args;
  if (elements.length === 0) {
    return elements;
  }

  const attribution = statementAttribution.get(statement);
  const shouldOverrideSource =
    attribution != null &&
    (attribution.sourceId !== statement.id || attribution.foreachStack.length > 0);
  const statementMacroStack = statementMacroAttribution.get(statement);
  const pathItemsById = statement.kind === "Path" ? buildPathItemLookup(statement) : undefined;
  const pathFallbackStack =
    statement.kind === "Path" ? resolveFirstPathItemForeachStack(statement.items, pathItemForeachStack) : undefined;

  return elements.map((element) => {
    const itemStack =
      statement.kind === "Path" && pathItemsById
        ? resolvePathItemForeachStackForElement(element, statement, pathItemsById, pathItemForeachStack)
        : undefined;
    const fallbackStack =
      (itemStack && itemStack.length > 0
        ? itemStack
        : pathFallbackStack && pathFallbackStack.length > 0
          ? pathFallbackStack
          : attribution?.foreachStack);
    const foreachStack =
      fallbackStack && fallbackStack.length > 0
        ? cloneForeachStack(fallbackStack)
        : element.origin?.foreachStack
          ? cloneForeachStack(element.origin.foreachStack)
          : [];
    const macroStack =
      statementMacroStack && statementMacroStack.length > 0
        ? cloneMacroOriginStack(statementMacroStack)
        : element.origin?.macroStack
          ? cloneMacroOriginStack(element.origin.macroStack)
          : undefined;
    const foreachTemplateLocalTargetId =
      attribution != null && attribution.sourceId !== statement.id
        ? templateLocalIdByExpandedId.get(element.sourceRef.sourceId) ?? element.sourceRef.sourceId
        : element.origin?.foreachTemplateLocalTargetId;
    const nextOrigin =
      foreachStack.length > 0 || foreachTemplateLocalTargetId != null || (macroStack != null && macroStack.length > 0)
        ? {
            foreachStack,
            foreachTemplateLocalTargetId,
            macroStack
          }
        : undefined;

    const identityRef = statementSourceMap
      ? {
          sourceId: element.sourceRef.sourceId,
          sourceSpan: { ...element.sourceRef.sourceSpan },
          sourceKind: "expanded-element"
        }
      : element.identityRef;
    const nextSourceId = shouldOverrideSource ? attribution.sourceId : element.sourceRef.sourceId;
    const nextSourceSpan = statementSourceMap
      ? mapExpansionSpan(statementSourceMap, element.sourceRef.sourceSpan)
      : shouldOverrideSource
        ? attribution.sourceSpan
        : element.sourceRef.sourceSpan;
    return {
      ...element,
      sourceRef: {
        ...element.sourceRef,
        sourceId: nextSourceId,
        sourceSpan: nextSourceSpan
      },
      identityRef,
      styleChain: remapStyleChainSourceRefs(element.styleChain, statementSourceMap),
      origin: nextOrigin
    };
  });
}

export function finalizeExpandedStatementHandles(args: {
  statement: Statement;
  handles: EditHandle[];
  startIndex: number;
  statementAttribution: WeakMap<Statement, ForeachStatementAttribution>;
  statementSourceMap: ExpansionSourceMap | undefined;
  source: string;
}): void {
  const { statement, handles, startIndex, statementAttribution, statementSourceMap, source } = args;
  const attribution = statementAttribution.get(statement);
  const shouldOverrideSource =
    attribution != null &&
    (attribution.sourceId !== statement.id || attribution.foreachStack.length > 0);
  if (!shouldOverrideSource || !attribution) {
    return;
  }

  for (let index = startIndex; index < handles.length; index += 1) {
    const handle = handles[index];
    if (!handle) {
      continue;
    }
    const mappedSpan = statementSourceMap ? mapExpansionSpan(statementSourceMap, handle.sourceRef.sourceSpan) : handle.sourceRef.sourceSpan;
    handles[index] = {
      ...handle,
      identityRef: statementSourceMap
        ? {
            sourceId: handle.sourceRef.sourceId,
            sourceSpan: { ...handle.sourceRef.sourceSpan },
            sourceKind: "expanded-handle"
          }
        : handle.identityRef,
      sourceText: statementSourceMap
        ? source.slice(mappedSpan.from, mappedSpan.to)
        : handle.sourceText,
      sourceRef: {
        ...handle.sourceRef,
        sourceId: attribution.sourceId,
        sourceSpan: mappedSpan
      }
    };
  }
}

function remapStyleChainSourceRefs(
  styleChain: StyleChainEntry[],
  sourceMap: ExpansionSourceMap | undefined
): StyleChainEntry[] {
  if (!sourceMap || styleChain.length === 0) {
    return styleChain;
  }
  return styleChain.map((entry) => {
    if (!entry.sourceRef?.sourceSpan) {
      return entry;
    }
    return {
      ...entry,
      sourceRef: {
        ...entry.sourceRef,
        sourceId: sourceMap.sourceId,
        sourceSpan: mapExpansionSpan(sourceMap, entry.sourceRef.sourceSpan),
        identityRef: {
          sourceId: entry.sourceRef.sourceId,
          sourceSpan: { ...entry.sourceRef.sourceSpan },
          sourceKind: entry.sourceRef.sourceKind
        }
      }
    };
  });
}

function buildPathItemLookup(statement: PathStatement): Map<string, PathItem> {
  const byId = new Map<string, PathItem>();
  collectPathItemsById(statement.items, byId);
  return byId;
}

function resolvePathItemForeachStackForElement(
  element: SceneElement,
  statement: PathStatement,
  pathItemsById: Map<string, PathItem>,
  pathItemForeachStack: WeakMap<PathItem, ExpansionForeachOriginFrame[]>
): ExpansionForeachOriginFrame[] | undefined {
  const itemPayload = extractElementItemPayload(element.id, statement.id);
  if (!itemPayload) {
    return undefined;
  }

  let matchedItemId: string | undefined;
  for (const itemId of pathItemsById.keys()) {
    if (itemPayload === itemId || itemPayload.startsWith(`${itemId}:`)) {
      if (!matchedItemId || itemId.length > matchedItemId.length) {
        matchedItemId = itemId;
      }
    }
  }

  if (!matchedItemId) {
    return undefined;
  }

  const item = pathItemsById.get(matchedItemId);
  if (!item) {
    return undefined;
  }
  return pathItemForeachStack.get(item);
}

function resolveFirstPathItemForeachStack(
  items: PathItem[],
  pathItemForeachStack: WeakMap<PathItem, ExpansionForeachOriginFrame[]>
): ExpansionForeachOriginFrame[] | undefined {
  for (const item of items) {
    const stack = pathItemForeachStack.get(item);
    if (stack && stack.length > 0) {
      return stack;
    }
    if (item.kind === "ChildOperation") {
      const nested = resolveFirstPathItemForeachStack(item.body, pathItemForeachStack);
      if (nested && nested.length > 0) {
        return nested;
      }
    }
  }
  return undefined;
}

function collectPathItemsById(items: PathItem[], byId: Map<string, PathItem>): void {
  for (const item of items) {
    byId.set(item.id, item);
    if (item.kind === "ChildOperation") {
      collectPathItemsById(item.body, byId);
    }
  }
}

function extractElementItemPayload(elementId: string, sourceId: string): string | undefined {
  const prefixes = [
    "scene-path:",
    "scene-rectangle:",
    "scene-node-box:",
    "scene-node-ellipse:",
    "scene-grid-x:",
    "scene-grid-y:",
    "scene-text:"
  ];

  for (const prefix of prefixes) {
    if (!elementId.startsWith(prefix)) {
      continue;
    }
    const withoutPrefix = elementId.slice(prefix.length);
    if (!withoutPrefix.startsWith(`${sourceId}:`)) {
      return undefined;
    }
    return withoutPrefix.slice(sourceId.length + 1);
  }

  return undefined;
}

function cloneForeachStack(stack: ExpansionForeachOriginFrame[]): ExpansionForeachOriginFrame[] {
  return stack.map((frame) => ({
    loopId: frame.loopId,
    loopSpan: frame.loopSpan,
    iterationIndex: frame.iterationIndex,
    bindings: { ...frame.bindings }
  }));
}

function cloneMacroOriginStack(stack: MacroOriginFrame[]): MacroOriginFrame[] {
  return stack.map((origin) => ({
    macroName: origin.macroName,
    definitionId: origin.definitionId,
    definitionSpan: {
      from: origin.definitionSpan.from,
      to: origin.definitionSpan.to
    },
    commandRaw: origin.commandRaw
  }));
}
