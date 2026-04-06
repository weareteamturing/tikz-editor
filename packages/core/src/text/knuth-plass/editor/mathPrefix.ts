import type { MathDelimiterKind, MathSourceSpan } from './sourceParser.js';

const TRAILING_ESCAPE_DISCHARGE_SUFFIX = 'phantom{}';
const MATH_MODE_NONE = 'none';
const MATH_MODE_DOLLAR = 'dollar';
const MATH_MODE_PAREN = 'paren';
const DEFAULT_PREFIX_CACHE_LIMIT = 64;

interface PrefixState {
  inMath: boolean;
  mathMode: 'none' | 'dollar' | 'paren';
  braceDepth: number;
  trailingEscape: boolean;
  unclosedLeftCount: number;
}

export interface MathPrefixCache {
  getOrBuild(
    outputJax: any,
    span: MathSourceSpan
  ): Promise<number[]>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp(Math.floor(value), 0, max);
}

export function hasDanglingMathScriptOperator(text: string): boolean {
  let index = text.length - 1;
  while (index >= 0 && /\s/.test(text.charAt(index))) {
    index -= 1;
  }
  if (index < 0) {
    return false;
  }

  const char = text.charAt(index);
  if (char !== '^' && char !== '_') {
    return false;
  }

  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text.charAt(cursor) === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 0;
}

export function scanTeXPrefixState(text: string): PrefixState {
  let braceDepth = 0;
  let mathMode: PrefixState['mathMode'] = MATH_MODE_NONE;
  let unclosedLeftCount = 0;
  let trailingEscape = false;

  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);

    if (char === '\\') {
      const nextIndex = index + 1;
      if (nextIndex >= text.length) {
        trailingEscape = true;
        break;
      }

      const nextChar = text.charAt(nextIndex);
      if (nextChar === '(') {
        if (mathMode === MATH_MODE_NONE) {
          mathMode = MATH_MODE_PAREN;
        }
        index += 2;
        continue;
      }

      if (nextChar === ')') {
        if (mathMode === MATH_MODE_PAREN) {
          mathMode = MATH_MODE_NONE;
        }
        index += 2;
        continue;
      }

      if (/[A-Za-z]/.test(nextChar)) {
        let commandEnd = nextIndex + 1;
        while (commandEnd < text.length && /[A-Za-z]/.test(text.charAt(commandEnd))) {
          commandEnd += 1;
        }
        const command = text.slice(nextIndex, commandEnd);
        if (mathMode !== MATH_MODE_NONE && command === 'left') {
          unclosedLeftCount += 1;
        } else if (mathMode !== MATH_MODE_NONE && command === 'right') {
          unclosedLeftCount = Math.max(0, unclosedLeftCount - 1);
        }
        index = commandEnd;
        continue;
      }

      index += 2;
      continue;
    }

    if (char === '$') {
      if (mathMode === MATH_MODE_NONE) {
        mathMode = MATH_MODE_DOLLAR;
      } else if (mathMode === MATH_MODE_DOLLAR) {
        mathMode = MATH_MODE_NONE;
      }
      index += 1;
      continue;
    }

    if (char === '{') {
      braceDepth += 1;
      index += 1;
      continue;
    }

    if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      index += 1;
      continue;
    }

    index += 1;
  }

  return {
    inMath: mathMode !== MATH_MODE_NONE,
    mathMode,
    braceDepth,
    trailingEscape,
    unclosedLeftCount,
  };
}

export function stabilizePrefixForMeasurement(prefix: string): string {
  let stabilized = prefix;
  let state = scanTeXPrefixState(stabilized);

  if (state.trailingEscape) {
    stabilized += TRAILING_ESCAPE_DISCHARGE_SUFFIX;
    state = scanTeXPrefixState(stabilized);
  }

  if (state.braceDepth > 0) {
    stabilized += '}'.repeat(state.braceDepth);
    state = scanTeXPrefixState(stabilized);
  }

  if (state.inMath && state.unclosedLeftCount > 0) {
    stabilized += '\\right.'.repeat(state.unclosedLeftCount);
    state = scanTeXPrefixState(stabilized);
  }

  if (state.inMath && hasDanglingMathScriptOperator(stabilized)) {
    stabilized += '{}';
    state = scanTeXPrefixState(stabilized);
  }

  if (state.inMath) {
    if (state.trailingEscape) {
      stabilized += TRAILING_ESCAPE_DISCHARGE_SUFFIX;
    }
    stabilized += state.mathMode === MATH_MODE_PAREN ? '\\)' : '$';
  }

  return stabilized;
}

function readViewBoxWidth(node: any): number {
  if (!node) {
    return 0;
  }

  const attr = typeof node.getAttribute === 'function' ? node.getAttribute('viewBox') : null;
  if (typeof attr === 'string' && attr.trim()) {
    const parts = attr
      .trim()
      .split(/\s+/)
      .map((part) => Number(part));
    if (parts.length === 4 && Number.isFinite(parts[2])) {
      return parts[2];
    }
  }

  if (
    node?.viewBox?.baseVal &&
    Number.isFinite(node.viewBox.baseVal.width) &&
    node.viewBox.baseVal.width > 0
  ) {
    return Number(node.viewBox.baseVal.width);
  }

  const widthAttr = Number(
    typeof node.getAttribute === 'function' ? node.getAttribute('width') : NaN
  );
  if (Number.isFinite(widthAttr) && widthAttr > 0) {
    return widthAttr;
  }

  const bbox = typeof node.getBBox === 'function' ? node.getBBox() : null;
  if (bbox && Number.isFinite(bbox.width) && bbox.width > 0) {
    return Number(bbox.width);
  }

  return 0;
}

function extractRenderedWidth(rendered: any): number {
  if (!rendered) {
    return 0;
  }

  if (typeof rendered.querySelector === 'function') {
    const svg = rendered.querySelector('svg');
    if (svg) {
      return readViewBoxWidth(svg);
    }
  }

  if (rendered.firstElementChild) {
    const width = readViewBoxWidth(rendered.firstElementChild);
    if (width > 0) {
      return width;
    }
  }

  return readViewBoxWidth(rendered);
}

type Tex2Svg = (tex: string, options?: { display?: boolean }) => any;

function getTex2Svg(outputJax: any): Tex2Svg | null {
  const candidates = [
    outputJax,
    outputJax?.mathjax,
    outputJax?.constructor?.mathjax,
    (globalThis as any)?.MathJax,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    if (typeof candidate.tex2svg === 'function') {
      return candidate.tex2svg.bind(candidate);
    }
  }

  return null;
}

async function measureTexWidth(tex2svg: Tex2Svg, tex: string): Promise<number> {
  const rendered = await Promise.resolve(tex2svg(tex, { display: false }));
  return extractRenderedWidth(rendered);
}

function stabilizeMathContentForMeasurement(prefix: string): string {
  // Reuse delimiter-balancing logic by entering math mode with a synthetic '$',
  // then strip the outer delimiters before measuring via tex2svg().
  const wrapped = `$${prefix}`;
  const stabilizedWrapped = stabilizePrefixForMeasurement(wrapped);
  let stabilized = stabilizedWrapped;
  if (stabilized.startsWith('$')) {
    stabilized = stabilized.slice(1);
  }
  if (stabilized.endsWith('$')) {
    stabilized = stabilized.slice(0, -1);
  }
  return stabilized;
}

function toInlineMathMeasurementTeX(content: string): string {
  return `\\textstyle{${content}}`;
}

export function seedPrefixWidthTable(length: number, totalWidth: number): number[] {
  const table = new Array<number>(length + 1);
  table[0] = 0;
  table[length] = totalWidth;
  return table;
}

export function finalizePrefixWidthTable(table: number[], totalWidth: number): number[] {
  const lastIndex = table.length - 1;
  if (lastIndex < 0) {
    return [];
  }

  const boundedTotal = Number.isFinite(totalWidth) && totalWidth > 0 ? totalWidth : 0;
  table[0] = 0;
  table[lastIndex] = boundedTotal;

  let index = 1;
  while (index < lastIndex) {
    if (Number.isFinite(table[index])) {
      index += 1;
      continue;
    }

    const gapStart = index - 1;
    let gapEnd = index;
    while (gapEnd <= lastIndex && !Number.isFinite(table[gapEnd])) {
      gapEnd += 1;
    }

    const leftIndex = Math.max(0, gapStart);
    const rightIndex = Math.min(lastIndex, gapEnd);
    const leftValue = Number.isFinite(table[leftIndex]) ? Number(table[leftIndex]) : 0;
    const rightValue = Number.isFinite(table[rightIndex])
      ? Number(table[rightIndex])
      : boundedTotal;
    const span = Math.max(1, rightIndex - leftIndex);

    for (let cursor = leftIndex + 1; cursor < rightIndex; cursor++) {
      const t = (cursor - leftIndex) / span;
      table[cursor] = leftValue + (rightValue - leftValue) * t;
    }

    index = rightIndex + 1;
  }

  let previous = 0;
  for (let cursor = 1; cursor < lastIndex; cursor++) {
    const raw = table[cursor];
    const normalized = Number.isFinite(raw)
      ? Number(raw)
      : boundedTotal * (cursor / Math.max(1, lastIndex));
    const clamped = clamp(normalized, previous, boundedTotal);
    table[cursor] = clamped;
    previous = clamped;
  }

  return table;
}

export function readPrefixUnitsFromTable(
  index: number,
  sourceLength: number,
  totalWidth: number,
  table: number[]
): number {
  if (sourceLength === 0 || index <= 0) {
    return 0;
  }

  const normalized = normalizeIndex(index, sourceLength);
  if (Array.isArray(table) && table.length === sourceLength + 1) {
    const measured = table[normalized];
    if (Number.isFinite(measured)) {
      return Number(measured);
    }
  }

  return totalWidth * (normalized / sourceLength);
}

export function findNearestPrefixIndexFromTable(
  targetUnits: number,
  sourceLength: number,
  totalWidth: number,
  table: number[]
): number {
  if (sourceLength === 0 || totalWidth <= 0) {
    return 0;
  }

  const boundedTarget = clamp(targetUnits, 0, totalWidth);
  if (!Array.isArray(table) || table.length !== sourceLength + 1) {
    return normalizeIndex(Math.round((boundedTarget / totalWidth) * sourceLength), sourceLength);
  }

  let low = 0;
  let high = sourceLength;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const widthAtMid = Number(table[mid]) || 0;
    if (widthAtMid < boundedTarget) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const rightIndex = clamp(low, 0, sourceLength);
  const leftIndex = clamp(rightIndex - 1, 0, sourceLength);
  const leftDistance = Math.abs((Number(table[leftIndex]) || 0) - boundedTarget);
  const rightDistance = Math.abs((Number(table[rightIndex]) || totalWidth) - boundedTarget);
  return leftDistance <= rightDistance ? leftIndex : rightIndex;
}

export function normalizeMathSourceForCache(
  delimiter: MathDelimiterKind,
  content: string
): string {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  return `${delimiter}:${normalizedContent}`;
}

async function buildMeasuredPrefixWidths(
  outputJax: any,
  span: MathSourceSpan
): Promise<number[]> {
  const tex2svg = getTex2Svg(outputJax);
  if (!tex2svg) {
    throw new Error('No tex2svg() runtime is available on outputJax or global MathJax.');
  }

  const content = span.content;
  const table = seedPrefixWidthTable(content.length, 0);

  for (let i = 1; i <= content.length; i++) {
    const prefix = content.slice(0, i);
    const stabilized = stabilizeMathContentForMeasurement(prefix);
    table[i] = await measureTexWidth(tex2svg, toInlineMathMeasurementTeX(stabilized));
  }

  finalizePrefixWidthTable(table, table[content.length] ?? 0);

  const total = table[content.length] ?? 0;
  if (total > 0) {
    return table.map((entry) => clamp(entry / total, 0, 1));
  }

  const fallback = new Array<number>(content.length + 1);
  for (let i = 0; i <= content.length; i++) {
    fallback[i] = content.length > 0 ? i / content.length : 0;
  }
  return fallback;
}

export function createMathPrefixCache(limit = DEFAULT_PREFIX_CACHE_LIMIT): MathPrefixCache {
  const tableByKey = new Map<string, Promise<number[]>>();

  const touch = (key: string, value: Promise<number[]>) => {
    tableByKey.delete(key);
    tableByKey.set(key, value);
    while (tableByKey.size > limit) {
      const oldest = tableByKey.keys().next();
      if (oldest.done) {
        break;
      }
      tableByKey.delete(oldest.value);
    }
  };

  return {
    async getOrBuild(outputJax: any, span: MathSourceSpan): Promise<number[]> {
      const key = normalizeMathSourceForCache(span.delimiter, span.content);
      const cached = tableByKey.get(key);
      if (cached) {
        touch(key, cached);
        return cached;
      }

      const pending = buildMeasuredPrefixWidths(outputJax, span)
        .then((table) => {
          return table;
        })
        .catch((error) => {
          tableByKey.delete(key);
          throw error;
        });

      touch(key, pending);
      return pending;
    },
  };
}
