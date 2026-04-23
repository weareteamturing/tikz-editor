import { KnuthPlassVisitor } from './KnuthPlassVisitor.js';
import type { ParagraphLayoutReport } from './paragraph/report.js';
import type { ParagraphAlignment } from './alignment.js';
import {
  clearKnuthPlassCaretMappingCache,
  getKnuthPlassCaretFromPoint,
  getKnuthPlassLineRangeFromPoint,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects,
  type CaretFromPointParams,
  type CaretHitResult,
  type LineRangeFromPointResult,
  type CaretPointResult,
  type PointFromOffsetParams,
  type SelectionRectsParams,
  type SelectionRectsResult,
} from './editor/hitmap.js';

export type OutputJaxName = 'svg' | 'chtml';
export type KnuthPlassLayoutMode =
  | 'wrap'
  | 'fixed-lines'
  | 'wrapped-explicit';

export interface WrappedTextGap {
  sourceStart: number;
  widthEm: number;
}

export interface KnuthPlassConfig {
  alignment?: ParagraphAlignment;
  layoutMode?: KnuthPlassLayoutMode;
  wrappedTextGaps?: WrappedTextGap[];
  pretolerance?: number;
  tolerance?: number;
  linepenalty?: number;
  hyphenpenalty?: number;
  exhyphenpenalty?: number;
  adjdemerits?: number;
  doublehyphendemerits?: number;
  finalhyphendemerits?: number;
  lefthyphenmin?: number;
  righthyphenmin?: number;
}

export interface MathJaxOutputConfig {
  linebreaks?: {
    LinebreakVisitor?: typeof KnuthPlassVisitor;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface MathJaxConfigLike {
  svg?: MathJaxOutputConfig;
  chtml?: MathJaxOutputConfig;
  [key: string]: unknown;
}

export function installKnuthPlassVisitor(
  config: MathJaxConfigLike,
  outputs: OutputJaxName[] = ['svg']
): MathJaxConfigLike {
  for (const output of outputs) {
    const outputConfig = (config[output] ||= {}) as MathJaxOutputConfig;
    const linebreaks = (outputConfig.linebreaks ||= {});
    linebreaks.LinebreakVisitor = KnuthPlassVisitor;
  }

  return config;
}

export function setKnuthPlassOptionsOnOutputJax(
  outputJax: any,
  options: KnuthPlassConfig
): void {
  if (!outputJax || typeof outputJax !== 'object') {
    return;
  }
  if (!options || typeof options !== 'object') {
    return;
  }

  const existing =
    outputJax.knuthPlassOptions && typeof outputJax.knuthPlassOptions === 'object'
      ? outputJax.knuthPlassOptions
      : {};

  outputJax.knuthPlassOptions = {
    ...existing,
    ...options,
  };
}

export function getKnuthPlassReportsFromOutputJax(
  outputJax: any
): ParagraphLayoutReport[] {
  if (!outputJax || typeof outputJax !== 'object') {
    return [];
  }

  const fromVisitor = outputJax.linebreaks?.getReports?.();
  if (Array.isArray(fromVisitor)) {
    return fromVisitor;
  }
  return [];
}

export {
  getKnuthPlassCaretFromPoint,
  getKnuthPlassLineRangeFromPoint,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects,
  clearKnuthPlassCaretMappingCache,
  type CaretFromPointParams,
  type PointFromOffsetParams,
  type SelectionRectsParams,
  type CaretHitResult,
  type LineRangeFromPointResult,
  type CaretPointResult,
  type SelectionRectsResult,
};
