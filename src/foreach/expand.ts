import {
  coordinateItemId,
  coordinateOperationItemId,
  foreachStatementId,
  letOperationItemId,
  macroAliasStatementId,
  macroCommandDefinitionStatementId,
  macroDefinitionStatementId,
  nodeForeachClauseId,
  nodeItemId,
  pathCommentItemId,
  pathForeachItemId,
  pathKeywordItemId,
  pathOptionItemId,
  pathStatementId,
  scopeStatementId,
  svgOperationItemId,
  toOperationItemId,
  unknownPathItemId,
  unknownStatementId
} from "../ast/ids.js";
import type {
  ForeachStatement,
  NodeItem,
  PathItem,
  PathStatement,
  ScopeStatement,
  Statement,
  TikzFigure
} from "../ast/types.js";
import { buildForeachIterations } from "./options.js";
import { parseNodeItemsFromTemplate, parsePathItemsFromFragment, parseStatementsFromBody } from "./snippet-parse.js";
import { substituteForeachBindings } from "./substitute.js";
import type {
  ForeachExpansionDiagnostic,
  ForeachExpansionResult,
  ForeachOriginFrame,
  ForeachStatementAttribution
} from "./types.js";

type ExpandContext = {
  maxForeachExpansions: number;
  expansionCount: number;
  diagnostics: ForeachExpansionDiagnostic[];
  statementAttribution: WeakMap<Statement, ForeachStatementAttribution>;
  pathItemForeachStack: WeakMap<PathItem, ForeachOriginFrame[]>;
  breakforeachWarned: Set<string>;
};

type TemplateSource = {
  sourceId: string;
  sourceSpan: { from: number; to: number };
};

export function expandForeachFigure(
  figure: TikzFigure,
  _source: string,
  maxForeachExpansions = 10_000
): ForeachExpansionResult {
  const context: ExpandContext = {
    maxForeachExpansions,
    expansionCount: 0,
    diagnostics: [],
    statementAttribution: new WeakMap<Statement, ForeachStatementAttribution>(),
    pathItemForeachStack: new WeakMap<PathItem, ForeachOriginFrame[]>(),
    breakforeachWarned: new Set<string>()
  };

  const expandedBody = expandStatements(figure.body, [], {}, context, undefined);
  reindexStatements(expandedBody);

  return {
    figureBody: expandedBody,
    diagnostics: context.diagnostics,
    statementAttribution: context.statementAttribution,
    pathItemForeachStack: context.pathItemForeachStack
  };
}

function expandStatements(
  statements: Statement[],
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext,
  templateSource: TemplateSource | undefined
): Statement[] {
  const expanded: Statement[] = [];
  for (const statement of statements) {
    expanded.push(...expandStatement(statement, stack, inheritedBindings, context, templateSource));
  }
  return expanded;
}

function expandStatement(
  statement: Statement,
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext,
  templateSource: TemplateSource | undefined
): Statement[] {
  if (statement.kind === "Foreach") {
    return expandForeachStatement(statement, stack, inheritedBindings, context);
  }

  if (statement.kind === "Scope") {
    const scope = statement as ScopeStatement;
    const expandedBody = expandStatements(
      scope.body,
      stack,
      inheritedBindings,
      context,
      templateSource ?? { sourceId: scope.id, sourceSpan: scope.span }
    );
    const expandedScope: ScopeStatement = {
      ...scope,
      body: expandedBody
    };
    maybeRecordStatementAttribution(expandedScope, stack, context, templateSource);
    return [expandedScope];
  }

  if (statement.kind === "Path") {
    const expandedPath = expandPathStatement(statement, stack, inheritedBindings, context);
    maybeRecordStatementAttribution(expandedPath, stack, context, templateSource);
    return [expandedPath];
  }

  maybeRecordStatementAttribution(statement, stack, context, templateSource);
  return [statement];
}

function expandForeachStatement(
  statement: ForeachStatement,
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext
): Statement[] {
  const variablesRaw = statement.variablesRaw?.trim() ?? "";
  const listRaw = statement.listRaw?.trim() ?? "";
  if (variablesRaw.length === 0 || listRaw.length === 0) {
    context.diagnostics.push({
      severity: "warning",
      code: "invalid-foreach-header",
      message: "Could not parse foreach loop header.",
      span: statement.span
    });
    return [];
  }

  const { iterations, diagnostics } = buildForeachIterations({
    variablesRaw,
    listRaw,
    options: statement.options,
    baseBindings: inheritedBindings,
    loopSpan: statement.span
  });
  context.diagnostics.push(...diagnostics);
  maybeWarnUnsupportedBreakforeach(statement.id, statement.bodyRaw, statement.span, context);
  if (iterations.length === 0) {
    return [];
  }

  const expanded: Statement[] = [];
  for (const iteration of iterations) {
    if (!consumeExpansionBudget(context, statement.span)) {
      break;
    }

    const combinedBindings = {
      ...inheritedBindings,
      ...iteration.bindings
    };
    const frame: ForeachOriginFrame = {
      loopId: statement.id,
      loopSpan: statement.span,
      iterationIndex: iteration.index,
      bindings: { ...iteration.bindings }
    };
    const nextStack = [...stack, frame];

    const substitutedBodyRaw = substituteForeachBindings(statement.bodyRaw, combinedBindings);
    const parsedBody = parseStatementsFromBody(substitutedBodyRaw);
    if (parsedBody.hasParseError) {
      context.diagnostics.push({
        severity: "warning",
        code: "foreach-body-parse-error",
        message: "Could not parse expanded foreach body.",
        span: statement.span
      });
    }

    const expandedIteration = expandStatements(
      parsedBody.value,
      nextStack,
      combinedBindings,
      context,
      { sourceId: statement.id, sourceSpan: statement.span }
    );
    expanded.push(...expandedIteration);
  }

  return expanded;
}

function expandPathStatement(
  statement: PathStatement,
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext
): PathStatement {
  const expandedItems = expandPathItems(statement.items, stack, inheritedBindings, context);
  return {
    ...statement,
    items: expandedItems
  };
}

function expandPathItems(
  items: PathItem[],
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext
): PathItem[] {
  const expanded: PathItem[] = [];

  for (const item of items) {
    if (item.kind === "PathForeach") {
      const variablesRaw = item.variablesRaw?.trim() ?? "";
      const listRaw = item.listRaw?.trim() ?? "";
      if (variablesRaw.length === 0 || listRaw.length === 0) {
        context.diagnostics.push({
          severity: "warning",
          code: "invalid-foreach-header",
          message: "Could not parse path foreach loop header.",
          span: item.span
        });
        continue;
      }

      const { iterations, diagnostics } = buildForeachIterations({
        variablesRaw,
        listRaw,
        options: item.options,
        baseBindings: inheritedBindings,
        loopSpan: item.span
      });
      context.diagnostics.push(...diagnostics);
      maybeWarnUnsupportedBreakforeach(item.id, item.bodyRaw, item.span, context);
      for (const iteration of iterations) {
        if (!consumeExpansionBudget(context, item.span)) {
          break;
        }

        const combinedBindings = {
          ...inheritedBindings,
          ...iteration.bindings
        };
        const frame: ForeachOriginFrame = {
          loopId: item.id,
          loopSpan: item.span,
          iterationIndex: iteration.index,
          bindings: { ...iteration.bindings }
        };
        const nextStack = [...stack, frame];
        const bodyRaw = substituteForeachBindings(item.bodyRaw, combinedBindings);
        const parsedItems = parsePathItemsFromFragment(bodyRaw);
        if (parsedItems.hasParseError) {
          context.diagnostics.push({
            severity: "warning",
            code: "foreach-body-parse-error",
            message: "Could not parse expanded path foreach body.",
            span: item.span
          });
        }

        const expandedItems = expandPathItems(parsedItems.value, nextStack, combinedBindings, context);
        for (const expandedItem of expandedItems) {
          markPathItemForeachStack(expandedItem, nextStack, context);
        }
        expanded.push(...expandedItems);
      }

      continue;
    }

    if (item.kind === "Node" && (item as NodeItem).foreachClauses && (item as NodeItem).foreachClauses!.length > 0) {
      const expandedNodes = expandNodeForeachItem(item as NodeItem, stack, inheritedBindings, context);
      expanded.push(...expandedNodes);
      continue;
    }

    if (stack.length > 0) {
      markPathItemForeachStack(item, stack, context);
    }
    expanded.push(item);
  }

  return expanded;
}

function maybeWarnUnsupportedBreakforeach(
  loopId: string,
  bodyRaw: string,
  span: { from: number; to: number },
  context: ExpandContext
): void {
  if (context.breakforeachWarned.has(loopId)) {
    return;
  }
  if (!/\\breakforeach\b/.test(bodyRaw)) {
    return;
  }
  context.breakforeachWarned.add(loopId);
  context.diagnostics.push({
    severity: "warning",
    code: "unsupported-breakforeach",
    message: "\\breakforeach is not supported yet.",
    span
  });
}

function expandNodeForeachItem(
  item: NodeItem,
  stack: ForeachOriginFrame[],
  inheritedBindings: Record<string, string>,
  context: ExpandContext
): PathItem[] {
  const clauses = item.foreachClauses ?? [];
  if (clauses.length === 0) {
    if (stack.length > 0) {
      markPathItemForeachStack(item, stack, context);
    }
    return [item];
  }

  let variants: Array<{ bindings: Record<string, string>; stack: ForeachOriginFrame[] }> = [
    { bindings: { ...inheritedBindings }, stack: [...stack] }
  ];

  for (const clause of clauses) {
    const nextVariants: Array<{ bindings: Record<string, string>; stack: ForeachOriginFrame[] }> = [];
    for (const variant of variants) {
      const variablesRaw = clause.variablesRaw?.trim() ?? "";
      const listRaw = clause.listRaw?.trim() ?? "";
      if (variablesRaw.length === 0 || listRaw.length === 0) {
        context.diagnostics.push({
          severity: "warning",
          code: "invalid-foreach-header",
          message: "Could not parse node foreach loop header.",
          span: clause.span
        });
        continue;
      }

      const { iterations, diagnostics } = buildForeachIterations({
        variablesRaw,
        listRaw,
        options: clause.options,
        baseBindings: variant.bindings,
        loopSpan: clause.span
      });
      context.diagnostics.push(...diagnostics);

      for (const iteration of iterations) {
        if (!consumeExpansionBudget(context, clause.span)) {
          break;
        }

        const combinedBindings = {
          ...variant.bindings,
          ...iteration.bindings
        };
        const frame: ForeachOriginFrame = {
          loopId: clause.id,
          loopSpan: clause.span,
          iterationIndex: iteration.index,
          bindings: { ...iteration.bindings }
        };
        nextVariants.push({
          bindings: combinedBindings,
          stack: [...variant.stack, frame]
        });
      }
    }
    variants = nextVariants;
  }

  const expanded: PathItem[] = [];
  for (const variant of variants) {
    const nodeRaw = substituteForeachBindings(item.templateRaw, variant.bindings);
    const parsed = parseNodeItemsFromTemplate(nodeRaw);
    if (parsed.hasParseError) {
      context.diagnostics.push({
        severity: "warning",
        code: "foreach-body-parse-error",
        message: "Could not parse expanded node foreach body.",
        span: item.span
      });
    }

    const expandedItems = expandPathItems(parsed.value, variant.stack, variant.bindings, context);
    for (const expandedItem of expandedItems) {
      markPathItemForeachStack(expandedItem, variant.stack, context);
    }
    expanded.push(...expandedItems);
  }

  return expanded;
}

function markPathItemForeachStack(item: PathItem, stack: ForeachOriginFrame[], context: ExpandContext): void {
  if (stack.length === 0) {
    return;
  }
  context.pathItemForeachStack.set(item, cloneForeachStack(stack));
}

function maybeRecordStatementAttribution(
  statement: Statement,
  stack: ForeachOriginFrame[],
  context: ExpandContext,
  templateSource: TemplateSource | undefined
): void {
  if (stack.length === 0 && !templateSource) {
    return;
  }

  context.statementAttribution.set(statement, {
    sourceId: templateSource?.sourceId ?? statement.id,
    sourceSpan: templateSource?.sourceSpan ?? statement.span,
    foreachStack: cloneForeachStack(stack)
  });
}

function consumeExpansionBudget(context: ExpandContext, span: { from: number; to: number }): boolean {
  if (context.expansionCount < context.maxForeachExpansions) {
    context.expansionCount += 1;
    return true;
  }

  context.diagnostics.push({
    severity: "warning",
    code: "foreach-expansion-limit",
    message: `Foreach expansion limit (${context.maxForeachExpansions}) reached.`,
    span
  });
  return false;
}

function cloneForeachStack(stack: ForeachOriginFrame[]): ForeachOriginFrame[] {
  return stack.map((frame) => ({
    loopId: frame.loopId,
    loopSpan: frame.loopSpan,
    iterationIndex: frame.iterationIndex,
    bindings: { ...frame.bindings }
  }));
}

function reindexStatements(statements: Statement[]): void {
  const state = { nextStatementIndex: 0 };
  reindexStatementsInPlace(statements, state);
}

function reindexStatementsInPlace(statements: Statement[], state: { nextStatementIndex: number }): void {
  for (const statement of statements) {
    const statementIndex = state.nextStatementIndex;
    state.nextStatementIndex += 1;

    if (statement.kind === "Path") {
      statement.id = pathStatementId(statementIndex);
      reindexPathItems(statement, statementIndex);
      continue;
    }

    if (statement.kind === "Scope") {
      statement.id = scopeStatementId(statementIndex);
      reindexStatementsInPlace(statement.body, state);
      continue;
    }

    if (statement.kind === "Foreach") {
      statement.id = foreachStatementId(statementIndex);
      continue;
    }

    if (statement.kind === "MacroDefinition") {
      statement.id = macroDefinitionStatementId(statementIndex);
      continue;
    }

    if (statement.kind === "MacroAlias") {
      statement.id = macroAliasStatementId(statementIndex);
      continue;
    }

    if (statement.kind === "MacroCommandDefinition") {
      statement.id = macroCommandDefinitionStatementId(statementIndex);
      continue;
    }

    statement.id = unknownStatementId(statementIndex);
  }
}

function reindexPathItems(statement: PathStatement, statementIndex: number): void {
  for (let itemIndex = 0; itemIndex < statement.items.length; itemIndex += 1) {
    const item = statement.items[itemIndex];
    if (item.kind === "Coordinate") {
      item.id = coordinateItemId(statementIndex, itemIndex);
      continue;
    }
    if (item.kind === "Node") {
      item.id = nodeItemId(statementIndex, itemIndex);
      if (item.foreachClauses) {
        for (let clauseIndex = 0; clauseIndex < item.foreachClauses.length; clauseIndex += 1) {
          item.foreachClauses[clauseIndex].id = nodeForeachClauseId(statementIndex, itemIndex, clauseIndex);
        }
      }
      continue;
    }
    if (item.kind === "PathForeach") {
      item.id = pathForeachItemId(statementIndex, itemIndex);
      continue;
    }
    if (item.kind === "PathComment") {
      item.id = pathCommentItemId(statementIndex, itemIndex);
      continue;
    }
    if (item.kind === "PathOption") {
      item.id = pathOptionItemId(statementIndex, itemIndex);
      continue;
    }
    if (item.kind === "PathKeyword") {
      item.id = pathKeywordItemId(statementIndex, itemIndex);
      continue;
    }
    if (item.kind === "ToOperation") {
      item.id = toOperationItemId(statementIndex, itemIndex);
      continue;
    }
    if (item.kind === "SvgOperation") {
      item.id = svgOperationItemId(statementIndex, itemIndex);
      continue;
    }
    if (item.kind === "LetOperation") {
      item.id = letOperationItemId(statementIndex, itemIndex);
      continue;
    }
    if (item.kind === "CoordinateOperation") {
      item.id = coordinateOperationItemId(statementIndex, itemIndex);
      continue;
    }
    item.id = unknownPathItemId(statementIndex, itemIndex);
  }
}
