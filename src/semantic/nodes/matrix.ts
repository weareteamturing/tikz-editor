import type { NodeItem, PathStatement } from "../../ast/types.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings } from "../../macros/index.js";
import { parseOptionListRaw, splitTopLevel } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";
import { parseLength } from "../coords/parse-length.js";
import type { SemanticContext } from "../context.js";
import type { NodePositioningResolution } from "../path/node-positioning.js";
import type { DiagnosticPushFn, FeatureMarkFn } from "../path/types.js";
import { normalizeOptionValue, parseStyleValueAsOptionList, readBalancedBlock } from "../style/option-utils.js";
import type { ResolvedStyle, SceneElement } from "../types.js";
import { placeNodeCenter, registerNamedNodeAnchors } from "./anchors.js";
import {
  applyNodeBoxPaintMode,
  makeCircleElement,
  makeNodeBoxElement,
  makeNodeDiamondElement,
  makeNodeEllipseElement,
  makeNodeTrapeziumElement,
  resolveNodeBoxPaintMode
} from "./elements.js";
import { resolveNodeLayout } from "./layout.js";
import { collectScopedNodeNames } from "./named-coordinates.js";
import {
  resolveNodeLayer,
  resolveNodeOptionScale,
  resolveNodeStyle
} from "./options.js";
import { resolveNodeShapeGeometryParams } from "./shape-geometry.js";
import type { NodeLayout, NodeShape } from "./types.js";

type MatrixSpacingSpec = {
  gap: number;
  betweenOrigins: boolean;
};

export type MatrixMode = {
  enabled: boolean;
  matrixOfNodes: boolean;
  includeEmptyCells: boolean;
  cellSeparator: string;
  rowSep: MatrixSpacingSpec;
  columnSep: MatrixSpacingSpec;
  nodesOption?: OptionListAst;
  matrixAnchor?: string;
};

type MatrixParsedRows = {
  rows: Array<{
    cells: string[];
    columnGapOverrides: number[];
  }>;
  rowGapOverrides: number[];
};

type MatrixCell = {
  raw: string;
  text: string;
  name?: string;
  aliases?: string[];
  options?: OptionListAst;
};

type ResolvedMatrixCell = {
  cell: MatrixCell;
  options?: OptionListAst;
};

export type MatrixNodeEvaluation = {
  behindElements: SceneElement[];
  frontElements: SceneElement[];
};

type MatrixNodeEvaluator = (item: NodeItem) => MatrixNodeEvaluation;

export type EvaluateMatrixNodeParams = {
  item: NodeItem;
  statement: PathStatement;
  context: SemanticContext;
  style: ResolvedStyle;
  markFeature: FeatureMarkFn;
  pushDiagnostic: DiagnosticPushFn;
  forcedName?: string;
  matrixMode: MatrixMode;
  nodeShape: NodeShape;
  nodeStyle: ResolvedStyle;
  effectiveNodeOptions: OptionListAst | undefined;
  effectiveNodeLocalOptions: OptionListAst | undefined;
  inheritedTransformScale: number;
  resolvedPositioning: NodePositioningResolution;
  fallbackAnchor: string;
  evaluateNestedNode: MatrixNodeEvaluator;
};

const MATRIX_FLAG_KEYS = new Set(["matrix", "matrix of nodes", "matrix of math nodes", "nodes in empty cells"]);
const MATRIX_KEY_VALUE_KEYS = new Set(["matrix", "matrix of nodes", "matrix of math nodes", "row sep", "column sep", "ampersand replacement", "matrix anchor"]);

export function evaluateMatrixNodeItem(params: EvaluateMatrixNodeParams): MatrixNodeEvaluation {
  params.markFeature("matrix_node", "supported");

  const parsed = parseMatrixRows(params.item.text, params.matrixMode.cellSeparator);
  const rowCount = Math.max(1, parsed.rows.length);
  const colCount = Math.max(1, parsed.rows.reduce((max, row) => Math.max(max, row.cells.length), 0));

  const columnGapOverrides = new Array(Math.max(0, colCount - 1)).fill(0);
  for (const row of parsed.rows) {
    for (let column = 0; column < Math.min(row.columnGapOverrides.length, columnGapOverrides.length); column += 1) {
      columnGapOverrides[column] = Math.max(columnGapOverrides[column], row.columnGapOverrides[column] ?? 0);
    }
  }

  const rowGapOverrides = new Array(Math.max(0, rowCount - 1)).fill(0);
  for (let row = 0; row < Math.min(parsed.rowGapOverrides.length, rowGapOverrides.length); row += 1) {
    rowGapOverrides[row] = parsed.rowGapOverrides[row] ?? 0;
  }

  const cellGrid: Array<Array<ResolvedMatrixCell | null>> = Array.from({ length: rowCount }, () => Array.from({ length: colCount }, () => null));
  const colWidths = new Array(colCount).fill(0);
  const rowHeights = new Array(rowCount).fill(0);

  for (let row = 0; row < rowCount; row += 1) {
    const rawRow = parsed.rows[row] ?? { cells: [], columnGapOverrides: [] };
    for (let column = 0; column < colCount; column += 1) {
      const rawCell = rawRow.cells[column] ?? "";
      const parsedCell = parseMatrixCell(rawCell, params.matrixMode);
      if (!parsedCell) {
        continue;
      }

      const combinedCellOptions = stripMatrixSpecificOptions(mergeOptionLists([params.matrixMode.nodesOption, parsedCell.options]));
      const cellOptionScale = resolveNodeOptionScale(combinedCellOptions, params.style, params.context);
      const cellTransformScale = params.inheritedTransformScale * cellOptionScale;
      const cellStyle = resolveNodeStyle(combinedCellOptions, params.style, params.context, cellTransformScale);
      const expandedCellText = expandMacroBindings(
        parsedCell.text,
        params.context.stack[params.context.stack.length - 1].macroBindings,
        {
          maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
          trace: params.context.macroTraceCollector ?? undefined
        }
      );
      const cellLayout = resolveNodeLayout(
        expandedCellText,
        combinedCellOptions,
        cellStyle,
        cellTransformScale,
        params.context.textEngine
      );

      cellGrid[row][column] = {
        cell: parsedCell,
        options: combinedCellOptions
      };
      colWidths[column] = Math.max(colWidths[column], cellLayout.visualWidth);
      rowHeights[row] = Math.max(rowHeights[row], cellLayout.visualHeight);
    }
  }

  for (let column = 0; column < colCount; column += 1) {
    if (colWidths[column] <= 0) {
      colWidths[column] = 1;
    }
  }
  for (let row = 0; row < rowCount; row += 1) {
    if (rowHeights[row] <= 0) {
      rowHeights[row] = 1;
    }
  }

  const columnGaps = new Array(Math.max(0, colCount - 1))
    .fill(params.matrixMode.columnSep.gap)
    .map((gap, index) => gap + (columnGapOverrides[index] ?? 0));
  const rowGaps = new Array(Math.max(0, rowCount - 1))
    .fill(params.matrixMode.rowSep.gap)
    .map((gap, index) => gap + (rowGapOverrides[index] ?? 0));

  const xCenters = computeAxisCenters(colWidths, columnGaps, params.matrixMode.columnSep.betweenOrigins, 1);
  const yCenters = computeAxisCenters(rowHeights, rowGaps, params.matrixMode.rowSep.betweenOrigins, -1);

  const xBounds = computeBoundsFromCenters(xCenters, colWidths);
  const yBounds = computeBoundsFromCenters(yCenters, rowHeights);
  const contentWidth = Math.max(1, xBounds.max - xBounds.min);
  const contentHeight = Math.max(1, yBounds.max - yBounds.min);
  const contentCenter = {
    x: (xBounds.min + xBounds.max) / 2,
    y: (yBounds.min + yBounds.max) / 2
  };

  const matrixLayout = makeMatrixLayout(contentWidth, contentHeight);
  const matrixAnchor = params.matrixMode.matrixAnchor ?? params.fallbackAnchor;
  const shapeGeometry = resolveNodeShapeGeometryParams(params.effectiveNodeOptions);
  const matrixCenter = placeNodeCenter(
    params.resolvedPositioning.anchorPoint,
    params.nodeShape,
    matrixLayout,
    matrixAnchor,
    params.effectiveNodeOptions
  );
  const scopedMatrixNames = collectScopedNodeNames(params.forcedName ?? params.item.name, params.item.aliases, params.context);

  for (const name of scopedMatrixNames) {
    registerNamedNodeAnchors(params.context, name, matrixCenter, params.nodeShape, matrixLayout, params.effectiveNodeOptions);
  }

  const matrixNodeElements: SceneElement[] = [];
  const matrixBoxPaintMode = resolveNodeBoxPaintMode(params.effectiveNodeLocalOptions);
  if (matrixBoxPaintMode.draw || matrixBoxPaintMode.fill || params.nodeStyle.shadowLayers.length > 0) {
    const matrixBoxStyle = applyNodeBoxPaintMode(params.nodeStyle, matrixBoxPaintMode);
    if (params.nodeShape === "circle") {
      matrixNodeElements.push(makeCircleElement(params.statement.id, matrixCenter, matrixLayout.visualRadius, matrixBoxStyle, params.item.span));
      params.markFeature("shape_circle", "supported");
      params.markFeature("svg_circle", "supported");
    } else if (params.nodeShape === "ellipse") {
      matrixNodeElements.push(
        makeNodeEllipseElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.visualWidth,
          matrixLayout.visualHeight,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("keyword_ellipse", "supported");
    } else if (params.nodeShape === "diamond") {
      matrixNodeElements.push(
        makeNodeDiamondElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.visualWidth,
          matrixLayout.visualHeight,
          shapeGeometry.diamondAspect,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_diamond", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "trapezium") {
      matrixNodeElements.push(
        makeNodeTrapeziumElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.trapeziumLeftAngle,
          shapeGeometry.trapeziumRightAngle,
          shapeGeometry.shapeBorderRotate,
          shapeGeometry.trapeziumStretches,
          shapeGeometry.trapeziumStretchesBody,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_trapezium", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "rectangle") {
      matrixNodeElements.push(
        makeNodeBoxElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.visualWidth,
          matrixLayout.visualHeight,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_rectangle", "supported");
      params.markFeature("svg_path", "supported");
    }
  }

  const behindCellElements: SceneElement[] = [];
  const frontCellElements: SceneElement[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < colCount; column += 1) {
      const resolvedCell = cellGrid[row][column];
      if (!resolvedCell) {
        continue;
      }

      const generatedCellNames = scopedMatrixNames.map((matrixName) => `${matrixName}-${row + 1}-${column + 1}`);
      const namedCell = resolveMatrixCellNames(resolvedCell.cell, generatedCellNames);
      const position = {
        x: matrixCenter.x + xCenters[column] - contentCenter.x,
        y: matrixCenter.y + yCenters[row] - contentCenter.y
      };

      const cellItem: NodeItem = {
        kind: "Node",
        id: `${params.item.id}:matrix-cell:${row + 1}:${column + 1}`,
        span: params.item.span,
        raw: resolvedCell.cell.raw,
        templateRaw: resolvedCell.cell.raw,
        name: namedCell.name,
        aliases: namedCell.aliases,
        optionsSpan: resolvedCell.options?.span,
        options: resolvedCell.options,
        atSpan: params.item.span,
        atRaw: `(${formatCoordinateValue(position.x)},${formatCoordinateValue(position.y)})`,
        textSource: "group",
        textSpan: params.item.textSpan,
        text: expandMacroBindings(
          resolvedCell.cell.text,
          params.context.stack[params.context.stack.length - 1].macroBindings,
          {
            maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
            trace: params.context.macroTraceCollector ?? undefined
          }
        )
      };
      const evaluatedCell = params.evaluateNestedNode(cellItem);
      behindCellElements.push(...evaluatedCell.behindElements);
      frontCellElements.push(...evaluatedCell.frontElements);
    }
  }

  const matrixLayer = resolveNodeLayer(params.effectiveNodeOptions, params.context);
  if (matrixLayer === "behind") {
    return {
      behindElements: [...matrixNodeElements, ...behindCellElements, ...frontCellElements],
      frontElements: []
    };
  }
  return {
    behindElements: behindCellElements,
    frontElements: [...matrixNodeElements, ...frontCellElements]
  };
}

export function resolveMatrixMode(options: OptionListAst | undefined): MatrixMode {
  let enabled = false;
  let matrixOfNodes = false;
  let includeEmptyCells = false;
  let cellSeparator = "&";
  let rowSep: MatrixSpacingSpec = { gap: 0, betweenOrigins: false };
  let columnSep: MatrixSpacingSpec = { gap: 0, betweenOrigins: false };
  let matrixAnchor: string | undefined;
  const nodesOptionLists: OptionListAst[] = [];

  if (!options) {
    return {
      enabled,
      matrixOfNodes,
      includeEmptyCells,
      cellSeparator,
      rowSep,
      columnSep,
      nodesOption: mergeOptionLists(nodesOptionLists),
      matrixAnchor
    };
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "matrix") {
        enabled = true;
      } else if (entry.key === "matrix of nodes" || entry.key === "matrix of math nodes") {
        enabled = true;
        matrixOfNodes = true;
      } else if (entry.key === "nodes in empty cells") {
        includeEmptyCells = true;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "matrix") {
      const parsed = parseBoolish(normalizeOptionValue(entry.valueRaw));
      if (parsed === true) {
        enabled = true;
      } else if (parsed === false) {
        enabled = false;
      }
      continue;
    }

    if (entry.key === "matrix of nodes" || entry.key === "matrix of math nodes") {
      const parsed = parseBoolish(normalizeOptionValue(entry.valueRaw));
      if (parsed === true) {
        enabled = true;
        matrixOfNodes = true;
      } else if (parsed === false) {
        matrixOfNodes = false;
      }
      continue;
    }

    if (entry.key === "row sep") {
      rowSep = parseMatrixSpacing(entry.valueRaw);
      continue;
    }

    if (entry.key === "column sep") {
      columnSep = parseMatrixSpacing(entry.valueRaw);
      continue;
    }

    if (entry.key === "ampersand replacement") {
      const replacement = normalizeOptionValue(entry.valueRaw).trim();
      cellSeparator = replacement.length > 0 ? replacement : "&";
      continue;
    }

    if (entry.key === "nodes") {
      const parsedNodes = parseStyleValueAsOptionList(entry.valueRaw);
      if (parsedNodes) {
        nodesOptionLists.push(parsedNodes);
      }
      continue;
    }

    if (entry.key === "matrix anchor") {
      const normalized = normalizeOptionValue(entry.valueRaw).trim().toLowerCase().replaceAll("_", " ");
      if (normalized.length > 0) {
        matrixAnchor = normalized;
      }
    }
  }

  if (matrixOfNodes) {
    enabled = true;
  }

  return {
    enabled,
    matrixOfNodes,
    includeEmptyCells,
    cellSeparator,
    rowSep,
    columnSep,
    nodesOption: mergeOptionLists(nodesOptionLists),
    matrixAnchor
  };
}

function parseMatrixRows(input: string, cellSeparator: string): MatrixParsedRows {
  const rows: Array<{ cells: string[]; columnGapOverrides: number[] }> = [];
  const rowGapOverrides: number[] = [];
  let start = 0;
  let cursor = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  while (cursor < input.length) {
    const char = input[cursor];
    if (char === "\\") {
      if (braceDepth === 0 && bracketDepth === 0 && parenDepth === 0 && input.startsWith("\\\\", cursor)) {
        const rowRaw = input.slice(start, cursor);
        const split = splitMatrixRowCells(rowRaw, cellSeparator);
        rows.push(split);

        cursor += 2;
        while (cursor < input.length && /\s/u.test(input[cursor] ?? "")) {
          cursor += 1;
        }
        let rowGap = 0;
        if (input[cursor] === "[") {
          const block = readBalancedBlock(input, cursor, "[", "]");
          if (block) {
            rowGap = parseMatrixSpacing(block.content).gap;
            cursor = block.nextIndex;
          }
        }
        rowGapOverrides.push(rowGap);
        start = cursor;
        continue;
      }

      cursor += input[cursor + 1] != null ? 2 : 1;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    }

    cursor += 1;
  }

  rows.push(splitMatrixRowCells(input.slice(start), cellSeparator));
  while (rows.length > 1 && rows[rows.length - 1]?.cells.every((cell) => cell.trim().length === 0)) {
    rows.pop();
    rowGapOverrides.pop();
  }

  return { rows, rowGapOverrides };
}

function splitMatrixRowCells(rowRaw: string, cellSeparator: string): { cells: string[]; columnGapOverrides: number[] } {
  const cells: string[] = [];
  const columnGapOverrides: number[] = [];
  let start = 0;
  let cursor = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  while (cursor < rowRaw.length) {
    const separatorLength =
      braceDepth === 0 && bracketDepth === 0 && parenDepth === 0 ? matchMatrixCellSeparator(rowRaw, cursor, cellSeparator) : 0;
    if (separatorLength > 0) {
      cells.push(rowRaw.slice(start, cursor));
      cursor += separatorLength;
      while (cursor < rowRaw.length && /\s/u.test(rowRaw[cursor] ?? "")) {
        cursor += 1;
      }
      let columnGap = 0;
      if (rowRaw[cursor] === "[") {
        const block = readBalancedBlock(rowRaw, cursor, "[", "]");
        if (block) {
          columnGap = parseMatrixSpacing(block.content).gap;
          cursor = block.nextIndex;
        }
      }
      columnGapOverrides.push(columnGap);
      start = cursor;
      continue;
    }

    const char = rowRaw[cursor];
    if (char === "\\") {
      cursor += rowRaw[cursor + 1] != null ? 2 : 1;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    }
    cursor += 1;
  }

  cells.push(rowRaw.slice(start));
  return { cells, columnGapOverrides };
}

function parseMatrixCell(rawCell: string, mode: MatrixMode): MatrixCell | null {
  let working = rawCell.trim();
  if (working.length === 0 && !mode.includeEmptyCells) {
    return null;
  }

  const prefixOptions: OptionListAst[] = [];
  let prefixName: string | undefined;
  while (working.startsWith("|")) {
    const closing = findMatrixPipeClosing(working);
    if (closing <= 0) {
      break;
    }
    const prefixRaw = working.slice(1, closing).trim();
    if (prefixRaw.startsWith("[") && prefixRaw.endsWith("]")) {
      prefixOptions.push(parseOptionListRaw(prefixRaw));
    } else if (prefixRaw.startsWith("(") && prefixRaw.endsWith(")")) {
      const parsedName = prefixRaw.slice(1, -1).trim();
      if (parsedName.length > 0) {
        prefixName = parsedName;
      }
    }
    working = working.slice(closing + 1).trimStart();
  }

  const explicitNode = parseExplicitMatrixNode(working);
  if (explicitNode) {
    const options = mergeOptionLists([mergeOptionLists(prefixOptions), explicitNode.options]);
    const explicitAliases = explicitNode.aliases ?? [];
    const optionAliases = extractNodeAliasesFromOptions(options);
    const aliases = dedupeNames([...explicitAliases, ...optionAliases]);
    const name = explicitNode.name ?? prefixName ?? extractNodeNameFromOptions(options);
    return {
      raw: working,
      text: explicitNode.text,
      name,
      aliases: aliases.length > 0 ? aliases : undefined,
      options
    };
  }

  const text = working.replace(/;\s*$/u, "").trim();
  if (text.length === 0 && !mode.includeEmptyCells) {
    return null;
  }
  if (!mode.matrixOfNodes && text.startsWith("\\")) {
    return null;
  }

  const options = mergeOptionLists(prefixOptions);
  const optionAliases = extractNodeAliasesFromOptions(options);
  const name = prefixName ?? extractNodeNameFromOptions(options);
  return {
    raw: working,
    text,
    name,
    aliases: optionAliases.length > 0 ? optionAliases : undefined,
    options
  };
}

function parseExplicitMatrixNode(raw: string): { text: string; name?: string; aliases?: string[]; options?: OptionListAst } | null {
  let cursor = skipWhitespace(raw, 0);
  if (!raw.startsWith("\\node", cursor)) {
    return null;
  }

  cursor += "\\node".length;
  const optionLists: OptionListAst[] = [];
  let explicitName: string | undefined;

  while (cursor < raw.length) {
    cursor = skipWhitespace(raw, cursor);
    const char = raw[cursor];
    if (char === "[") {
      const block = readBalancedBlock(raw, cursor, "[", "]");
      if (!block) {
        return null;
      }
      optionLists.push(parseOptionListRaw(raw.slice(cursor, block.nextIndex)));
      cursor = block.nextIndex;
      continue;
    }

    if (char === "(") {
      const block = readBalancedBlock(raw, cursor, "(", ")");
      if (!block) {
        return null;
      }
      const name = block.content.trim();
      if (name.length > 0) {
        explicitName = name;
      }
      cursor = block.nextIndex;
      continue;
    }

    if (raw.slice(cursor, cursor + 2) === "at" && /[\s(]/u.test(raw[cursor + 2] ?? "")) {
      cursor += 2;
      cursor = skipWhitespace(raw, cursor);
      if (raw[cursor] === "(") {
        const block = readBalancedBlock(raw, cursor, "(", ")");
        if (!block) {
          return null;
        }
        cursor = block.nextIndex;
      }
      continue;
    }

    break;
  }

  cursor = skipWhitespace(raw, cursor);
  if (raw[cursor] !== "{") {
    return null;
  }
  const textBlock = readBalancedBlock(raw, cursor, "{", "}");
  if (!textBlock) {
    return null;
  }

  const options = mergeOptionLists(optionLists);
  const optionName = extractNodeNameFromOptions(options);
  const aliases = extractNodeAliasesFromOptions(options);
  return {
    text: textBlock.content,
    name: explicitName ?? optionName,
    aliases: aliases.length > 0 ? aliases : undefined,
    options
  };
}

function resolveMatrixCellNames(cell: MatrixCell, generatedNames: string[]): { name?: string; aliases?: string[] } {
  const explicitName = cell.name?.trim();
  const explicitAliases = dedupeNames(cell.aliases ?? []);
  if (explicitName && explicitName.length > 0) {
    const aliases = dedupeNames([...explicitAliases, ...generatedNames]).filter((entry) => entry !== explicitName);
    return {
      name: explicitName,
      aliases: aliases.length > 0 ? aliases : undefined
    };
  }

  if (generatedNames.length > 0) {
    const name = generatedNames[0];
    const aliases = dedupeNames([...generatedNames.slice(1), ...explicitAliases]).filter((entry) => entry !== name);
    return {
      name,
      aliases: aliases.length > 0 ? aliases : undefined
    };
  }

  return {
    name: explicitName && explicitName.length > 0 ? explicitName : undefined,
    aliases: explicitAliases.length > 0 ? explicitAliases : undefined
  };
}

function parseMatrixSpacing(raw: string): MatrixSpacingSpec {
  const normalized = normalizeOptionValue(raw);
  const tokens = splitTopLevel(normalized, ",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  let gap = 0;
  let betweenOrigins = false;
  for (const token of tokens) {
    const normalizedToken = normalizeOptionValue(token).toLowerCase();
    if (normalizedToken === "between origins") {
      betweenOrigins = true;
      continue;
    }
    if (normalizedToken === "between borders") {
      betweenOrigins = false;
      continue;
    }
    const parsed = parseLength(token, "pt");
    if (parsed != null) {
      gap += parsed;
    }
  }

  return { gap, betweenOrigins };
}

function stripMatrixSpecificOptions(options: OptionListAst | undefined): OptionListAst | undefined {
  if (!options) {
    return undefined;
  }
  const filteredEntries = options.entries.filter((entry) => {
    if (entry.kind === "flag") {
      return !MATRIX_FLAG_KEYS.has(entry.key);
    }
    if (entry.kind === "kv") {
      return !MATRIX_KEY_VALUE_KEYS.has(entry.key);
    }
    return true;
  });
  if (filteredEntries.length === options.entries.length) {
    return options;
  }
  if (filteredEntries.length === 0) {
    return undefined;
  }
  return {
    ...options,
    entries: filteredEntries
  };
}

function mergeOptionLists(lists: Array<OptionListAst | undefined>): OptionListAst | undefined {
  const present = lists.filter((list): list is OptionListAst => Boolean(list));
  if (present.length === 0) {
    return undefined;
  }

  const spanFrom = present.reduce((min, list) => Math.min(min, list.span.from), Number.POSITIVE_INFINITY);
  const spanTo = present.reduce((max, list) => Math.max(max, list.span.to), 0);
  return {
    span: {
      from: Number.isFinite(spanFrom) ? spanFrom : 0,
      to: spanTo
    },
    raw: present.map((list) => list.raw).join(", "),
    entries: present.flatMap((list) => list.entries)
  };
}

function extractNodeNameFromOptions(options: OptionListAst | undefined): string | undefined {
  if (!options) {
    return undefined;
  }
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "name") {
      continue;
    }
    const parsed = normalizeNodeName(entry.valueRaw);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

function extractNodeAliasesFromOptions(options: OptionListAst | undefined): string[] {
  if (!options) {
    return [];
  }

  const aliases: string[] = [];
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "alias") {
      continue;
    }
    const parsed = normalizeNodeName(entry.valueRaw);
    if (parsed) {
      aliases.push(parsed);
    }
  }
  return dedupeNames(aliases);
}

function normalizeNodeName(raw: string): string | undefined {
  let normalized = normalizeOptionValue(raw).trim();
  if (normalized.startsWith("(") && normalized.endsWith(")")) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.length > 0 ? normalized : undefined;
}

function computeAxisCenters(sizes: number[], gaps: number[], betweenOrigins: boolean, direction: 1 | -1): number[] {
  if (sizes.length === 0) {
    return [];
  }

  const centers = new Array(sizes.length).fill(0);
  if (!betweenOrigins) {
    centers[0] = direction * (sizes[0] / 2);
  }

  for (let index = 1; index < sizes.length; index += 1) {
    if (betweenOrigins) {
      centers[index] = centers[index - 1] + direction * (gaps[index - 1] ?? 0);
      continue;
    }
    centers[index] =
      centers[index - 1] +
      direction * (sizes[index - 1] / 2 + (gaps[index - 1] ?? 0) + sizes[index] / 2);
  }

  return centers;
}

function computeBoundsFromCenters(centers: number[], sizes: number[]): { min: number; max: number } {
  if (centers.length === 0 || sizes.length === 0) {
    return { min: 0, max: 1 };
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < centers.length; index += 1) {
    const half = (sizes[index] ?? 0) / 2;
    min = Math.min(min, centers[index] - half);
    max = Math.max(max, centers[index] + half);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { min: 0, max: 1 };
  }
  return { min, max };
}

function makeMatrixLayout(width: number, height: number): NodeLayout {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  return {
    textLines: [""],
    textBlockWidth: 0,
    textBlockHeight: 0,
    textRenderInfo: { mode: "plain" },
    naturalWidth: safeWidth,
    naturalHeight: safeHeight,
    minimumWidth: safeWidth,
    minimumHeight: safeHeight,
    outerXSep: 0,
    outerYSep: 0,
    visualWidth: safeWidth,
    visualHeight: safeHeight,
    visualRadius: Math.max(safeWidth, safeHeight) / 2,
    anchorHalfWidth: safeWidth / 2,
    anchorHalfHeight: safeHeight / 2,
    anchorRadius: Math.max(safeWidth, safeHeight) / 2,
    baseLineY: 0,
    midLineY: 0
  };
}

function parseBoolish(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
    return false;
  }
  return null;
}

function dedupeNames(names: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    deduped.push(trimmed);
  }
  return deduped;
}

function matchMatrixCellSeparator(input: string, cursor: number, separator: string): number {
  if (separator.length === 0) {
    return 0;
  }

  if (separator === "&") {
    if (input[cursor] === "&" && input[cursor - 1] !== "\\") {
      return 1;
    }
    return 0;
  }

  return input.startsWith(separator, cursor) ? separator.length : 0;
}

function findMatrixPipeClosing(input: string): number {
  for (let index = 1; index < input.length; index += 1) {
    if (input[index] === "|" && input[index - 1] !== "\\") {
      return index;
    }
  }
  return -1;
}

function skipWhitespace(input: string, start: number): number {
  let cursor = start;
  while (cursor < input.length && /\s/u.test(input[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function formatCoordinateValue(value: number): string {
  return Number(value.toFixed(6)).toString();
}
