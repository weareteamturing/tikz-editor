import type {
  MacroAliasStatement,
  MacroCommandDefinitionStatement,
  MacroDefinitionStatement,
  PathItem,
  PathStatement,
  TikzFigure,
  Statement
} from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { FEATURE_IDS } from "../capabilities/feature-ids.js";
import type { FeatureId } from "../capabilities/feature-ids.js";
import { expandForeachFigure } from "../foreach/index.js";
import {
  DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
  expandMacroBindings,
  isControlSequenceToken,
  type MacroBinding,
  type MacroExpansionTraceEvent,
  type MacroOriginFrame
} from "../macros/index.js";
import type {
  ForeachOriginFrame as ExpansionForeachOriginFrame,
  ForeachStatementAttribution
} from "../foreach/types.js";
import { parseOptionListRaw } from "../options/parse.js";
import type { OptionListAst } from "../options/types.js";
import { createSemanticContext, currentFrame, popFrame, pushFrame, type NodeDistanceSpec } from "./context.js";
import { evaluatePathStatement } from "./path/evaluate.js";
import { applyNameIntersectionsDirective, collectPathIntersectionDirectives, registerNamedPath } from "./path/intersections.js";
import { parseNodeDistance } from "./path/node-positioning.js";
import { DEFAULT_TEXT_FONT_SIZE, defaultStyle, commandDefaultStyle, parseStyleValueAsOptionList, resolveContextDelta } from "./style/resolve.js";
import { applyCustomStyleDefinition, cloneCustomStyleRegistry } from "./style/custom-styles.js";
import { expandOptionListMacros } from "./style/macro-options.js";
import { readBalancedBlock } from "./style/option-utils.js";
import { FONT_SIZE_COMMAND_FACTORS } from "./style/constants.js";
import { identityMatrix } from "./transform.js";
import type {
  Bounds,
  EvaluateOptions,
  FeatureUsage,
  FeatureUsageState,
  SceneElement,
  SceneFigure,
  ScenePathCommand
} from "./types.js";

export type EvaluateTikzResult = {
  scene: SceneFigure;
  diagnostics: Diagnostic[];
  featureUsage: FeatureUsage;
};

export function evaluateTikzFigure(figure: TikzFigure, source: string, opts: EvaluateOptions = {}): EvaluateTikzResult {
  const diagnostics: Diagnostic[] = [];
  const featureUsage = initializeFeatureUsage();
  markForeachFeaturesFromFigure(figure, featureUsage);
  const expanded = expandForeachFigure(figure, source, opts.maxForeachExpansions ?? 10_000);
  for (const diagnostic of expanded.diagnostics) {
    diagnostics.push({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      span: diagnostic.span
    });
  }
  const context = createSemanticContext(defaultStyle(), identityMatrix(), opts.textEngine ?? null);

  if (figure.options) {
    markFeature(featureUsage, "options_structured", "supported");
    const parent = currentFrame(context);
    const rootCustomStyles = cloneCustomStyleRegistry(parent.customStyles);
    const rootOptionLists = expandOptionListMacros(
      [figure.options],
      parent.macroBindings,
      context.macroTraceCollector ?? undefined
    );
    const rootDelta = resolveContextDelta(parent.style, parent.transform, rootOptionLists, rootCustomStyles);
    const rootMeta = resolveFrameMeta(parent, rootDelta.expandedOptionLists);
    pushFrame(context, {
      style: rootDelta.style,
      transform: rootDelta.transform,
      customStyles: rootCustomStyles,
      colorAliases: new Map(parent.colorAliases),
      macroBindings: new Map(parent.macroBindings),
      namePrefix: rootMeta.namePrefix,
      nameSuffix: rootMeta.nameSuffix,
      nodeLayerMode: rootMeta.nodeLayerMode,
      onGrid: rootMeta.onGrid,
      nodeDistance: rootMeta.nodeDistance,
      transformShape: rootMeta.transformShape,
      everyNodeStyles: rootMeta.everyNodeStyles,
      everyRectangleNodeStyles: rootMeta.everyRectangleNodeStyles,
      everyCircleNodeStyles: rootMeta.everyCircleNodeStyles
    });
    for (const code of rootDelta.diagnostics) {
      diagnostics.push({
        severity: "warning",
        code,
        message: `Figure option issue: ${code}`,
        span: figure.options.span
      });
    }
  }

  const elements: SceneElement[] = [];
  const statementMacroAttribution = new WeakMap<Statement, MacroOriginFrame[]>();
  for (const statement of expanded.figureBody) {
    const statementElements = evaluateStatement(statement, context, diagnostics, featureUsage, statementMacroAttribution);
    elements.push(
      ...applyForeachAttributionToElements(
        statement,
        statementElements,
        expanded.statementAttribution,
        expanded.pathItemForeachStack,
        statementMacroAttribution
      )
    );
  }

  if (figure.options) {
    popFrame(context);
  }

  return {
    scene: {
      kind: "SceneFigure",
      span: figure.span,
      elements,
      bounds: computeBounds(elements)
    },
    diagnostics,
    featureUsage
  };
}

function evaluateStatement(
  statement: Statement,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[],
  featureUsage: FeatureUsage,
  statementMacroAttribution: WeakMap<Statement, MacroOriginFrame[]>
): SceneElement[] {
  if (statement.kind === "Path") {
    markFeature(featureUsage, "path_statement", "supported");
    const parent = currentFrame(context);
    const baseStyle = { ...parent.style, ...commandDefaultStyle(statement.command, parent.style) };
    const optionLists = statement.options ? [statement.options] : [];
    const expandedOptionLists = expandOptionListMacros(
      optionLists,
      parent.macroBindings,
      context.macroTraceCollector ?? undefined
    );
    if (optionLists.length > 0) {
      markFeature(featureUsage, "options_structured", "supported");
    }
    const scopedCustomStyles = cloneCustomStyleRegistry(parent.customStyles);
    const resolved = resolveContextDelta(baseStyle, parent.transform, expandedOptionLists, scopedCustomStyles);
    const frameMeta = resolveFrameMeta(parent, resolved.expandedOptionLists);

    if (statement.command === "shade" || statement.command === "shadedraw" || resolved.style.shadeEnabled) {
      markFeature(featureUsage, "path_shading", "supported");
    }
    if (resolved.style.shadowLayers.length > 0) {
      markFeature(featureUsage, "path_shadows", "supported");
    }

    for (const code of resolved.diagnostics) {
      diagnostics.push({
        severity: "warning",
        code,
        message: `Path option issue: ${code}`,
        span: statement.span
      });
    }
    if (resolved.style.markerStart || resolved.style.markerEnd) {
      markFeature(featureUsage, "arrow_tips", "supported");
    }
    const intersectionDirectives = collectPathIntersectionDirectives(resolved.expandedOptionLists);
    if (intersectionDirectives.namedPathNames.length > 0 || intersectionDirectives.nameIntersections) {
      markFeature(featureUsage, "named_coordinates", "supported");
    }
    for (const code of intersectionDirectives.diagnostics) {
      diagnostics.push({
        severity: "warning",
        code,
        message: `Path option issue: ${code}`,
        span: statement.span
      });
    }

    pushFrame(context, {
      style: resolved.style,
      transform: resolved.transform,
      customStyles: scopedCustomStyles,
      colorAliases: new Map(parent.colorAliases),
      macroBindings: new Map(parent.macroBindings),
      namePrefix: frameMeta.namePrefix,
      nameSuffix: frameMeta.nameSuffix,
      nodeLayerMode: frameMeta.nodeLayerMode,
      onGrid: frameMeta.onGrid,
      nodeDistance: frameMeta.nodeDistance,
      transformShape: frameMeta.transformShape,
      everyNodeStyles: frameMeta.everyNodeStyles,
      everyRectangleNodeStyles: frameMeta.everyRectangleNodeStyles,
      everyCircleNodeStyles: frameMeta.everyCircleNodeStyles
    });
    const previousTraceCollector = context.macroTraceCollector;
    const statementMacroTrace: MacroExpansionTraceEvent[] = [];
    context.macroTraceCollector = statementMacroTrace;
    try {
      if (intersectionDirectives.nameIntersections) {
        const directiveDiagnostics = applyNameIntersectionsDirective(intersectionDirectives.nameIntersections, context);
        for (const code of directiveDiagnostics) {
          diagnostics.push({
            severity: "warning",
            code,
            message: `Path intersection issue: ${code}`,
            span: intersectionDirectives.nameIntersections.span
          });
        }
      }

      const elements = evaluatePathStatement(
        statement,
        context,
        resolved.style,
        (featureId, status) => markFeature(featureUsage, featureId, status),
        (code, message, from, to) => {
          diagnostics.push({
            severity: code.startsWith("unsupported") ? "warning" : "error",
            code,
            message,
            span: { from, to }
          });
        }
      );
      for (const name of intersectionDirectives.namedPathNames) {
        registerNamedPath(name, elements, context);
      }
      const originStack = extractStatementMacroOriginStack(statementMacroTrace);
      if (originStack.length > 0) {
        statementMacroAttribution.set(statement, originStack);
      }
      if (
        elements.some(
          (element) => element.kind === "Path" && (element.style.markerStart != null || element.style.markerEnd != null)
        )
      ) {
        markFeature(featureUsage, "arrow_tips", "supported");
      }
      return elements;
    } finally {
      context.macroTraceCollector = previousTraceCollector;
      popFrame(context);
    }
  }

  if (statement.kind === "Scope") {
    markFeature(featureUsage, "scope_statement", "supported");
    const parent = currentFrame(context);
    const optionLists = statement.options ? [statement.options] : [];
    const expandedOptionLists = expandOptionListMacros(
      optionLists,
      parent.macroBindings,
      context.macroTraceCollector ?? undefined
    );
    if (optionLists.length > 0) {
      markFeature(featureUsage, "options_structured", "supported");
    }
    const scopedCustomStyles = cloneCustomStyleRegistry(parent.customStyles);
    const resolved = resolveContextDelta(parent.style, parent.transform, expandedOptionLists, scopedCustomStyles);
    const frameMeta = resolveFrameMeta(parent, resolved.expandedOptionLists);
    pushFrame(context, {
      style: resolved.style,
      transform: resolved.transform,
      customStyles: scopedCustomStyles,
      colorAliases: new Map(parent.colorAliases),
      macroBindings: new Map(parent.macroBindings),
      namePrefix: frameMeta.namePrefix,
      nameSuffix: frameMeta.nameSuffix,
      nodeLayerMode: frameMeta.nodeLayerMode,
      onGrid: frameMeta.onGrid,
      nodeDistance: frameMeta.nodeDistance,
      transformShape: frameMeta.transformShape,
      everyNodeStyles: frameMeta.everyNodeStyles,
      everyRectangleNodeStyles: frameMeta.everyRectangleNodeStyles,
      everyCircleNodeStyles: frameMeta.everyCircleNodeStyles
    });
    for (const code of resolved.diagnostics) {
      diagnostics.push({
        severity: "warning",
        code,
        message: `Scope option issue: ${code}`,
        span: statement.span
      });
    }
    const nested = statement.body.flatMap((entry) =>
      evaluateStatement(entry, context, diagnostics, featureUsage, statementMacroAttribution)
    );
    popFrame(context);
    return nested;
  }

  if (statement.kind === "Foreach") {
    markFeature(featureUsage, "foreach_statement", "supported");
    return [];
  }

  if (statement.kind === "MacroDefinition") {
    applyMacroDefinitionStatement(statement, context);
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  if (statement.kind === "MacroAlias") {
    applyMacroAliasStatement(statement, context);
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  if (statement.kind === "MacroCommandDefinition") {
    applyMacroCommandDefinitionStatement(statement, context, diagnostics);
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  if (applyStandaloneCommandStatement(statement.raw, context, diagnostics, statement.span)) {
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  markFeature(featureUsage, "unknown_statement", "unsupported");
  diagnostics.push({
    severity: "warning",
    code: "unsupported-statement",
    message: "Unknown statements are ignored by the semantic evaluator.",
    span: statement.span
  });
  return [];
}

function applyStandaloneCommandStatement(
  raw: string,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[],
  span: { from: number; to: number }
): boolean {
  const command = parseStandaloneCommandName(raw);
  if (command) {
    const fontFactor = FONT_SIZE_COMMAND_FACTORS[command];
    if (fontFactor != null) {
      const frame = currentFrame(context);
      frame.style = {
        ...frame.style,
        fontSize: DEFAULT_TEXT_FONT_SIZE * fontFactor
      };
      return true;
    }
  }

  const tikzSetOptions = parseTikzSetOptionLists(raw);
  if (tikzSetOptions) {
    applyOptionListsToCurrentFrame(tikzSetOptions, context, diagnostics, span, "\\tikzset");
    return true;
  }

  const pgfkeysOptions = parsePgfkeysOptionLists(raw);
  if (pgfkeysOptions) {
    applyOptionListsToCurrentFrame(pgfkeysOptions, context, diagnostics, span, "\\pgfkeys");
    return true;
  }

  const colorlet = parseColorletDefinition(raw);
  if (colorlet) {
    const frame = currentFrame(context);
    const expandedValue = expandMacroBindings(colorlet.valueRaw, frame.macroBindings, {
      maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
      trace: context.macroTraceCollector ?? undefined
    });
    frame.colorAliases.set(colorlet.name, expandedValue);

    const optionList = parseStyleValueAsOptionList(expandedValue);
    if (optionList) {
      applyCustomStyleDefinition(frame.customStyles, colorlet.name, "style", optionList);
    }
    return true;
  }

  const legacyStyle = parseLegacyTikzStyleDefinition(raw);
  if (legacyStyle) {
    const frame = currentFrame(context);
    applyCustomStyleDefinition(frame.customStyles, legacyStyle.styleName, legacyStyle.kind, legacyStyle.optionList);
    return true;
  }

  return false;
}

function applyOptionListsToCurrentFrame(
  optionLists: OptionListAst[],
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[],
  span: { from: number; to: number },
  sourceLabel: string
): void {
  const frame = currentFrame(context);
  const expandedOptionLists = expandOptionListMacros(optionLists, frame.macroBindings, context.macroTraceCollector ?? undefined);
  const resolved = resolveContextDelta(frame.style, frame.transform, expandedOptionLists, frame.customStyles);
  frame.style = resolved.style;
  frame.transform = resolved.transform;

  const frameMeta = resolveFrameMeta(frame, resolved.expandedOptionLists);
  frame.namePrefix = frameMeta.namePrefix;
  frame.nameSuffix = frameMeta.nameSuffix;
  frame.nodeLayerMode = frameMeta.nodeLayerMode;
  frame.onGrid = frameMeta.onGrid;
  frame.nodeDistance = frameMeta.nodeDistance;
  frame.transformShape = frameMeta.transformShape;
  frame.everyNodeStyles = frameMeta.everyNodeStyles;
  frame.everyRectangleNodeStyles = frameMeta.everyRectangleNodeStyles;
  frame.everyCircleNodeStyles = frameMeta.everyCircleNodeStyles;

  for (const code of resolved.diagnostics) {
    diagnostics.push({
      severity: "warning",
      code,
      message: `${sourceLabel} option issue: ${code}`,
      span
    });
  }
}

function applyMacroDefinitionStatement(
  statement: MacroDefinitionStatement,
  context: ReturnType<typeof createSemanticContext>
): void {
  const name = normalizeMacroName(statement.nameRaw);
  if (!name) {
    return;
  }

  const frame = currentFrame(context);
  frame.macroBindings.set(name, {
    kind: "text",
    value: statement.valueRaw,
    provenance: [buildMacroOriginFrame(name, statement.id, statement.span, statement.commandRaw)]
  });
}

function applyMacroAliasStatement(statement: MacroAliasStatement, context: ReturnType<typeof createSemanticContext>): void {
  const name = normalizeMacroName(statement.nameRaw);
  if (!name) {
    return;
  }

  const frame = currentFrame(context);
  const targetRaw = statement.targetRaw.trim();
  if (targetRaw.length === 0) {
    return;
  }

  const aliasOrigin = buildMacroOriginFrame(name, statement.id, statement.span, statement.commandRaw);
  let binding: MacroBinding | null = null;
  if (isControlSequenceToken(targetRaw)) {
    const targetBinding = frame.macroBindings.get(targetRaw);
    if (targetBinding) {
      binding = cloneMacroBinding(targetBinding);
      binding.provenance.push(aliasOrigin);
    } else {
      binding = {
        kind: "text",
        value: targetRaw,
        provenance: [aliasOrigin]
      };
    }
  } else {
    binding = {
      kind: "text",
      value: expandMacroBindings(targetRaw, frame.macroBindings, {
        maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH
      }),
      provenance: [aliasOrigin]
    };
  }

  if (binding) {
    frame.macroBindings.set(name, binding);
  }
}

function applyMacroCommandDefinitionStatement(
  statement: MacroCommandDefinitionStatement,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[]
): void {
  const name = normalizeMacroName(statement.nameRaw);
  if (!name) {
    return;
  }

  const frame = currentFrame(context);
  const parameterCount = clampMacroParameterCount(statement.arity, diagnostics, statement);
  const optionalFirstArgDefault = resolveOptionalFirstArgDefault(statement, parameterCount, diagnostics);
  const origin = buildMacroOriginFrame(name, statement.id, statement.span, statement.commandRaw);
  const binding: MacroBinding =
    parameterCount === 0
      ? {
          kind: "text",
          value: statement.bodyRaw,
          provenance: [origin]
        }
      : {
          kind: "callable",
          parameterCount,
          optionalFirstArgDefault,
          body: statement.bodyRaw,
          provenance: [origin]
        };
  frame.macroBindings.set(name, binding);
}

function clampMacroParameterCount(arity: number, diagnostics: Diagnostic[], statement: MacroCommandDefinitionStatement): number {
  if (arity <= 9) {
    return Math.max(0, arity);
  }

  diagnostics.push({
    severity: "warning",
    code: "unsupported-macro-arity",
    message: `Only up to 9 macro parameters are supported; ${statement.commandRaw} ${statement.nameRaw} will use 9.`,
    span: statement.aritySpan ?? statement.span
  });
  return 9;
}

function cloneMacroBinding(binding: MacroBinding): MacroBinding {
  if (binding.kind === "text") {
    return {
      kind: "text",
      value: binding.value,
      provenance: cloneMacroOriginStack(binding.provenance)
    };
  }

  return {
    kind: "callable",
    parameterCount: binding.parameterCount,
    optionalFirstArgDefault: binding.optionalFirstArgDefault,
    body: binding.body,
    provenance: cloneMacroOriginStack(binding.provenance)
  };
}

function resolveOptionalFirstArgDefault(
  statement: MacroCommandDefinitionStatement,
  parameterCount: number,
  diagnostics: Diagnostic[]
): string | undefined {
  const defaultRaw = statement.optionalDefaultRaw;
  if (defaultRaw == null) {
    return undefined;
  }

  if (parameterCount <= 0) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-macro-default-arg",
      message: `${statement.commandRaw} ${statement.nameRaw} declares a default argument but has no parameters.`,
      span: statement.optionalDefaultSpan ?? statement.span
    });
    return undefined;
  }

  return defaultRaw;
}

function buildMacroOriginFrame(
  macroName: string,
  definitionId: string,
  definitionSpan: { from: number; to: number },
  commandRaw: MacroOriginFrame["commandRaw"]
): MacroOriginFrame {
  return {
    macroName,
    definitionId,
    definitionSpan,
    commandRaw
  };
}

function extractStatementMacroOriginStack(trace: MacroExpansionTraceEvent[]): MacroOriginFrame[] {
  if (trace.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const ordered: MacroOriginFrame[] = [];
  for (const event of trace) {
    for (const origin of event.provenance) {
      const key = `${origin.definitionId}:${origin.macroName}:${origin.commandRaw}:${origin.definitionSpan.from}:${origin.definitionSpan.to}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      ordered.push({
        macroName: origin.macroName,
        definitionId: origin.definitionId,
        definitionSpan: {
          from: origin.definitionSpan.from,
          to: origin.definitionSpan.to
        },
        commandRaw: origin.commandRaw
      });
    }
  }
  return ordered;
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

function normalizeMacroName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!isControlSequenceToken(trimmed)) {
    return null;
  }
  return trimmed;
}

function parseStandaloneCommandName(raw: string): string | null {
  const stripped = stripOptionalTrailingSemicolon(raw.trim());
  if (!/^\\[A-Za-z@]+$/.test(stripped)) {
    return null;
  }
  return stripped;
}

function parseTikzSetOptionLists(raw: string): OptionListAst[] | null {
  const content = parseBracedCommandContent(raw, "\\tikzset");
  if (content == null) {
    return null;
  }
  return [parseOptionListRaw(content)];
}

function parsePgfkeysOptionLists(raw: string): OptionListAst[] | null {
  const content = parseBracedCommandContent(raw, "\\pgfkeys");
  if (content == null) {
    return null;
  }
  return [normalizePgfkeysOptionList(parseOptionListRaw(content))];
}

function parseColorletDefinition(raw: string): { name: string; valueRaw: string } | null {
  const stripped = stripOptionalTrailingSemicolon(raw.trim());
  if (!stripped.startsWith("\\colorlet")) {
    return null;
  }

  let cursor = "\\colorlet".length;
  cursor = skipWhitespace(stripped, cursor);
  const nameBlock = readBalancedBlock(stripped, cursor, "{", "}");
  if (!nameBlock) {
    return null;
  }

  cursor = skipWhitespace(stripped, nameBlock.nextIndex);
  const valueBlock = readBalancedBlock(stripped, cursor, "{", "}");
  if (!valueBlock) {
    return null;
  }

  cursor = skipWhitespace(stripped, valueBlock.nextIndex);
  if (cursor !== stripped.length) {
    return null;
  }

  const normalizedName = normalizeColorAliasName(nameBlock.content);
  const valueRaw = valueBlock.content.trim();
  if (!normalizedName || valueRaw.length === 0) {
    return null;
  }

  return {
    name: normalizedName,
    valueRaw
  };
}

function parseLegacyTikzStyleDefinition(raw: string): {
  styleName: string;
  kind: "style" | "append";
  optionList: OptionListAst;
} | null {
  const stripped = stripOptionalTrailingSemicolon(raw.trim());
  if (!stripped.startsWith("\\tikzstyle")) {
    return null;
  }

  let cursor = "\\tikzstyle".length;
  cursor = skipWhitespace(stripped, cursor);
  if (cursor >= stripped.length) {
    return null;
  }

  let styleName = "";
  if (stripped[cursor] === "{") {
    const block = readBalancedBlock(stripped, cursor, "{", "}");
    if (!block) {
      return null;
    }
    styleName = block.content.trim();
    cursor = block.nextIndex;
  } else {
    const start = cursor;
    while (cursor < stripped.length) {
      const char = stripped[cursor] ?? "";
      if (char === "=" || char === "+" || /\s/.test(char)) {
        break;
      }
      cursor += 1;
    }
    styleName = stripped.slice(start, cursor).trim();
  }
  if (styleName.length === 0) {
    return null;
  }

  cursor = skipWhitespace(stripped, cursor);
  let kind: "style" | "append" = "style";
  if (stripped[cursor] === "+") {
    kind = "append";
    cursor += 1;
    cursor = skipWhitespace(stripped, cursor);
  }
  if (stripped[cursor] !== "=") {
    return null;
  }
  cursor += 1;
  cursor = skipWhitespace(stripped, cursor);
  if (cursor >= stripped.length) {
    return null;
  }

  let styleValueRaw = "";
  if (stripped[cursor] === "[") {
    const block = readBalancedBlock(stripped, cursor, "[", "]");
    if (!block) {
      return null;
    }
    styleValueRaw = block.content;
    cursor = block.nextIndex;
  } else if (stripped[cursor] === "{") {
    const block = readBalancedBlock(stripped, cursor, "{", "}");
    if (!block) {
      return null;
    }
    styleValueRaw = block.content;
    cursor = block.nextIndex;
  } else {
    styleValueRaw = stripped.slice(cursor).trim();
    cursor = stripped.length;
  }

  cursor = skipWhitespace(stripped, cursor);
  if (cursor !== stripped.length) {
    return null;
  }

  const optionList = parseStyleValueAsOptionList(styleValueRaw);
  if (!optionList) {
    return null;
  }

  return {
    styleName,
    kind,
    optionList
  };
}

function parseBracedCommandContent(raw: string, commandName: string): string | null {
  const stripped = stripOptionalTrailingSemicolon(raw.trim());
  if (!stripped.startsWith(commandName)) {
    return null;
  }

  let cursor = commandName.length;
  cursor = skipWhitespace(stripped, cursor);
  const block = readBalancedBlock(stripped, cursor, "{", "}");
  if (!block) {
    return null;
  }

  cursor = skipWhitespace(stripped, block.nextIndex);
  if (cursor !== stripped.length) {
    return null;
  }
  return block.content;
}

function normalizePgfkeysOptionList(list: OptionListAst): OptionListAst {
  let inTikzDirectory = false;
  const entries: OptionListAst["entries"] = [];
  for (const entry of list.entries) {
    if (entry.kind === "unknown") {
      const normalizedRaw = entry.raw.trim().toLowerCase();
      if (normalizedRaw === "/tikz/.cd" || normalizedRaw === ".cd") {
        inTikzDirectory = normalizedRaw === "/tikz/.cd" || inTikzDirectory;
      }
      continue;
    }

    if (entry.key === "/tikz/.cd" || entry.key === ".cd") {
      inTikzDirectory = entry.key === "/tikz/.cd" || inTikzDirectory;
      continue;
    }

    let normalizedKey: string | null = null;
    if (entry.key.startsWith("/tikz/")) {
      normalizedKey = entry.key.slice("/tikz/".length);
    } else if (inTikzDirectory && !entry.key.startsWith("/")) {
      normalizedKey = entry.key;
    }

    if (!normalizedKey || normalizedKey.length === 0) {
      continue;
    }

    if (entry.kind === "flag") {
      entries.push({ ...entry, key: normalizedKey });
      continue;
    }
    entries.push({ ...entry, key: normalizedKey });
  }

  return {
    ...list,
    entries
  };
}

function stripOptionalTrailingSemicolon(raw: string): string {
  return raw.endsWith(";") ? raw.slice(0, -1).trim() : raw;
}

function normalizeColorAliasName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.toLowerCase();
}

function skipWhitespace(input: string, start: number): number {
  let cursor = start;
  while (cursor < input.length && /\s/.test(input[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function computeBounds(elements: SceneElement[]): Bounds | undefined {
  const points: Array<{ x: number; y: number }> = [];

  for (const element of elements) {
    if (element.kind === "Path") {
      points.push(...pathBoundsPoints(element.commands));
      continue;
    }

    if (element.kind === "Circle") {
      points.push({ x: element.center.x - element.radius, y: element.center.y - element.radius });
      points.push({ x: element.center.x + element.radius, y: element.center.y + element.radius });
      continue;
    }

    if (element.kind === "Ellipse") {
      const rotation = ((element.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const extentX = Math.sqrt(element.rx * element.rx * cos * cos + element.ry * element.ry * sin * sin);
      const extentY = Math.sqrt(element.rx * element.rx * sin * sin + element.ry * element.ry * cos * cos);
      points.push({ x: element.center.x - extentX, y: element.center.y - extentY });
      points.push({ x: element.center.x + extentX, y: element.center.y + extentY });
      continue;
    }

    const lineCount = Math.max(1, element.text.split("\n").length);
    const textHeight = element.textBlockHeight ?? lineCount * element.style.fontSize * 1.15;
    const textWidth = element.textBlockWidth ?? estimateTextWidth(element.text, element.style.fontSize);
    points.push({ x: element.position.x - textWidth / 2, y: element.position.y - textHeight / 2 });
    points.push({ x: element.position.x + textWidth / 2, y: element.position.y + textHeight / 2 });
  }

  if (points.length === 0) {
    return undefined;
  }

  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));

  return { minX, minY, maxX, maxY };
}

function estimateTextWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return maxChars * fontSize * 0.7;
}

function pathBoundsPoints(commands: ScenePathCommand[]): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  let current: { x: number; y: number } | null = null;
  let subpathStart: { x: number; y: number } | null = null;

  for (const command of commands) {
    if (command.kind === "M") {
      current = command.to;
      subpathStart = command.to;
      points.push(command.to);
      continue;
    }

    if (command.kind === "L") {
      current = command.to;
      points.push(command.to);
      continue;
    }

    if (command.kind === "C") {
      points.push(command.c1, command.c2, command.to);
      current = command.to;
      continue;
    }

    if (command.kind === "A") {
      points.push(command.to);
      if (current) {
        points.push(...arcExtremaPoints(current, command));
      }
      current = command.to;
      continue;
    }

    if (command.kind === "Z" && subpathStart) {
      points.push(subpathStart);
      current = subpathStart;
    }
  }

  return points;
}

function arcExtremaPoints(
  from: { x: number; y: number },
  arc: { rx: number; ry: number; xAxisRotation: number; largeArc: boolean; sweep: boolean; to: { x: number; y: number } }
): Array<{ x: number; y: number }> {
  const solution = solveArcCenter(from, arc);
  if (!solution) {
    return [];
  }

  const { center, rx, ry, phi, theta1, deltaTheta } = solution;
  const theta2 = theta1 + deltaTheta;
  const candidates = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  const points: Array<{ x: number; y: number }> = [];

  for (const candidate of candidates) {
    if (!angleOnArc(candidate, theta1, theta2, arc.sweep)) {
      continue;
    }
    points.push(pointOnEllipse(center, rx, ry, phi, candidate));
  }

  return points;
}

function solveArcCenter(
  from: { x: number; y: number },
  arc: { rx: number; ry: number; xAxisRotation: number; largeArc: boolean; sweep: boolean; to: { x: number; y: number } }
): {
  center: { x: number; y: number };
  rx: number;
  ry: number;
  phi: number;
  theta1: number;
  deltaTheta: number;
} | null {
  let rx = Math.abs(arc.rx);
  let ry = Math.abs(arc.ry);
  if (rx <= 1e-9 || ry <= 1e-9) {
    return null;
  }

  const phi = (arc.xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (from.x - arc.to.x) / 2;
  const dy2 = (from.y - arc.to.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const denominator = rx2 * y1p2 + ry2 * x1p2;
  if (denominator <= 1e-12) {
    return null;
  }

  const sign = arc.largeArc === arc.sweep ? -1 : 1;
  const factorBase = Math.max(0, (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / denominator);
  const factor = sign * Math.sqrt(factorBase);
  const cxp = factor * ((rx * y1p) / ry);
  const cyp = factor * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + arc.to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + arc.to.y) / 2;

  const startUnit = { x: (x1p - cxp) / rx, y: (y1p - cyp) / ry };
  const endUnit = { x: (-x1p - cxp) / rx, y: (-y1p - cyp) / ry };
  const theta1 = angleFromUnit(startUnit);
  let deltaTheta = angleBetweenUnits(startUnit, endUnit);

  if (!arc.sweep && deltaTheta > 0) {
    deltaTheta -= 2 * Math.PI;
  } else if (arc.sweep && deltaTheta < 0) {
    deltaTheta += 2 * Math.PI;
  }

  return {
    center: { x: cx, y: cy },
    rx,
    ry,
    phi,
    theta1,
    deltaTheta
  };
}

function pointOnEllipse(
  center: { x: number; y: number },
  rx: number,
  ry: number,
  phi: number,
  theta: number
): { x: number; y: number } {
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  return {
    x: center.x + rx * cosTheta * cosPhi - ry * sinTheta * sinPhi,
    y: center.y + rx * cosTheta * sinPhi + ry * sinTheta * cosPhi
  };
}

function angleFromUnit(unit: { x: number; y: number }): number {
  return Math.atan2(unit.y, unit.x);
}

function angleBetweenUnits(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const cross = from.x * to.y - from.y * to.x;
  const dot = from.x * to.x + from.y * to.y;
  return Math.atan2(cross, dot);
}

function normalizeAngle(angle: number): number {
  const twoPi = 2 * Math.PI;
  let normalized = angle % twoPi;
  if (normalized < 0) {
    normalized += twoPi;
  }
  return normalized;
}

function angleOnArc(angle: number, start: number, end: number, sweep: boolean): boolean {
  const epsilon = 1e-9;
  const a = normalizeAngle(angle);
  const s = normalizeAngle(start);
  let e = normalizeAngle(end);

  if (sweep) {
    if (e < s) {
      e += 2 * Math.PI;
    }
    const aa = a < s ? a + 2 * Math.PI : a;
    return aa >= s - epsilon && aa <= e + epsilon;
  }

  if (e > s) {
    e -= 2 * Math.PI;
  }
  const aa = a > s ? a - 2 * Math.PI : a;
  return aa <= s + epsilon && aa >= e - epsilon;
}

function initializeFeatureUsage(): FeatureUsage {
  const usage: FeatureUsage = {};
  for (const featureId of FEATURE_IDS) {
    usage[featureId] = "unused";
  }
  return usage;
}

function markFeature(featureUsage: FeatureUsage, featureId: FeatureId, status: "supported" | "unsupported"): void {
  if (!(featureId in featureUsage)) {
    return;
  }

  const current = featureUsage[featureId] as FeatureUsageState;
  if (status === "unsupported") {
    featureUsage[featureId] = "used-unsupported";
    return;
  }

  if (current !== "used-unsupported") {
    featureUsage[featureId] = "used-supported";
  }
}

function markForeachFeaturesFromFigure(figure: TikzFigure, featureUsage: FeatureUsage): void {
  const walkStatement = (statement: Statement): void => {
    if (statement.kind === "Foreach") {
      markFeature(featureUsage, "foreach_statement", "supported");
      return;
    }

    if (statement.kind === "Scope") {
      for (const nested of statement.body) {
        walkStatement(nested);
      }
      return;
    }

    if (statement.kind !== "Path") {
      return;
    }

    for (const item of statement.items) {
      if (item.kind === "PathForeach") {
        markFeature(featureUsage, "foreach_path_operation", "supported");
      } else if (item.kind === "Node" && item.foreachClauses && item.foreachClauses.length > 0) {
        markFeature(featureUsage, "foreach_node_operation", "supported");
      }
    }
  };

  for (const statement of figure.body) {
    walkStatement(statement);
  }
}

function applyForeachAttributionToElements(
  statement: Statement,
  elements: SceneElement[],
  statementAttribution: WeakMap<Statement, ForeachStatementAttribution>,
  pathItemForeachStack: WeakMap<PathItem, ExpansionForeachOriginFrame[]>,
  statementMacroAttribution: WeakMap<Statement, MacroOriginFrame[]>
): SceneElement[] {
  if (elements.length === 0) {
    return elements;
  }

  const attribution = statementAttribution.get(statement);
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
    const nextOrigin =
      foreachStack.length > 0 || (macroStack != null && macroStack.length > 0)
        ? {
            foreachStack,
            macroStack
          }
        : undefined;

    const nextSourceId = attribution?.sourceId ?? element.sourceId;
    const nextSourceSpan = attribution?.sourceSpan ?? element.sourceSpan;
    return {
      ...element,
      sourceId: nextSourceId,
      sourceSpan: nextSourceSpan,
      origin: nextOrigin
    };
  });
}

function buildPathItemLookup(statement: PathStatement): Map<string, PathItem> {
  const byId = new Map<string, PathItem>();
  for (const item of statement.items) {
    byId.set(item.id, item);
  }
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
  }
  return undefined;
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

function resolveFrameMeta(
  base: {
    namePrefix: string;
    nameSuffix: string;
    nodeLayerMode: "front" | "behind";
    onGrid: boolean;
    nodeDistance: NodeDistanceSpec;
    transformShape: boolean;
    everyNodeStyles: OptionListAst[];
    everyRectangleNodeStyles: OptionListAst[];
    everyCircleNodeStyles: OptionListAst[];
  },
  optionLists: OptionListAst[]
): {
  namePrefix: string;
  nameSuffix: string;
  nodeLayerMode: "front" | "behind";
  onGrid: boolean;
  nodeDistance: NodeDistanceSpec;
  transformShape: boolean;
  everyNodeStyles: OptionListAst[];
  everyRectangleNodeStyles: OptionListAst[];
  everyCircleNodeStyles: OptionListAst[];
} {
  let namePrefix = base.namePrefix;
  let nameSuffix = base.nameSuffix;
  let nodeLayerMode = base.nodeLayerMode;
  let onGrid = base.onGrid;
  let nodeDistance = base.nodeDistance;
  let transformShape = base.transformShape;
  let everyNodeStyles = [...base.everyNodeStyles];
  let everyRectangleNodeStyles = [...base.everyRectangleNodeStyles];
  let everyCircleNodeStyles = [...base.everyCircleNodeStyles];

  for (const list of optionLists) {
    for (const entry of list.entries) {
      if (entry.kind === "flag") {
        if (entry.key === "behind path") {
          nodeLayerMode = "behind";
        } else if (entry.key === "in front of path") {
          nodeLayerMode = "front";
        } else if (entry.key === "on grid") {
          onGrid = true;
        } else if (entry.key === "transform shape") {
          transformShape = true;
        }
        continue;
      }

      if (entry.kind !== "kv") {
        continue;
      }

      if (entry.key === "name prefix") {
        namePrefix = stripWrappingBraces(entry.valueRaw);
        continue;
      }
      if (entry.key === "name suffix") {
        nameSuffix = stripWrappingBraces(entry.valueRaw);
        continue;
      }

      if (entry.key === "behind path") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed != null) {
          nodeLayerMode = parsed ? "behind" : "front";
        }
        continue;
      }

      if (entry.key === "in front of path") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed != null) {
          nodeLayerMode = parsed ? "front" : "behind";
        }
        continue;
      }

      if (entry.key === "on grid") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed != null) {
          onGrid = parsed;
        }
        continue;
      }

      if (entry.key === "node distance") {
        const parsed = parseNodeDistance(entry.valueRaw);
        if (parsed) {
          nodeDistance = parsed;
        }
        continue;
      }

      if (entry.key === "transform shape") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed != null) {
          transformShape = parsed;
        }
        continue;
      }

      if (entry.key === "every node/.style") {
        const parsed = parseStyleValueAsOptionList(entry.valueRaw);
        if (parsed) {
          everyNodeStyles = [parsed];
        }
        continue;
      }
      if (entry.key === "every node/.append style") {
        const parsed = parseStyleValueAsOptionList(entry.valueRaw);
        if (parsed) {
          everyNodeStyles = [...everyNodeStyles, parsed];
        }
        continue;
      }
      if (entry.key === "every rectangle node/.style") {
        const parsed = parseStyleValueAsOptionList(entry.valueRaw);
        if (parsed) {
          everyRectangleNodeStyles = [parsed];
        }
        continue;
      }
      if (entry.key === "every rectangle node/.append style") {
        const parsed = parseStyleValueAsOptionList(entry.valueRaw);
        if (parsed) {
          everyRectangleNodeStyles = [...everyRectangleNodeStyles, parsed];
        }
        continue;
      }
      if (entry.key === "every circle node/.style") {
        const parsed = parseStyleValueAsOptionList(entry.valueRaw);
        if (parsed) {
          everyCircleNodeStyles = [parsed];
        }
        continue;
      }
      if (entry.key === "every circle node/.append style") {
        const parsed = parseStyleValueAsOptionList(entry.valueRaw);
        if (parsed) {
          everyCircleNodeStyles = [...everyCircleNodeStyles, parsed];
        }
      }
    }
  }

  return {
    namePrefix,
    nameSuffix,
    nodeLayerMode,
    onGrid,
    nodeDistance,
    transformShape,
    everyNodeStyles,
    everyRectangleNodeStyles,
    everyCircleNodeStyles
  };
}

function parseBoolish(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0") {
    return false;
  }
  return null;
}

function stripWrappingBraces(raw: string): string {
  let value = raw.trim();
  while (value.startsWith("{") && value.endsWith("}") && isWrappedBySingleBracePair(value)) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function isWrappedBySingleBracePair(raw: string): boolean {
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && index !== raw.length - 1) {
        return false;
      }
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}
