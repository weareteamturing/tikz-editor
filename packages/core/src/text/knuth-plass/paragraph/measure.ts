import type { AnyWrapper, ParagraphRun } from './types.js';

export interface MeasurementStats {
  textCacheEntries: number;
  wordPrefixEntries: number;
  mathCacheEntries: number;
}

export interface MeasurementService {
  measureText(text: string, mtextWrapper: AnyWrapper): number;
  measureWord(word: string, mtextWrapper: AnyWrapper): number;
  measurePrefix(word: string, n: number, mtextWrapper: AnyWrapper): number;
  measureMath(wrapper: AnyWrapper): number;
  precomputeWord(word: string, mtextWrapper: AnyWrapper): void;
  primeRuns(runs: ParagraphRun[]): void;
  getStats(): MeasurementStats;
}

interface InternalStats {
  mathEntries: number;
}

export function createMeasurementService(): MeasurementService {
  const textWidthCache = new Map<string, number>();
  const wordPrefixWidthCache = new Map<string, number[]>();
  const mathWidthCache = new WeakMap<object, number>();
  const wrapperIds = new WeakMap<object, number>();
  let nextWrapperId = 1;
  const stats: InternalStats = {
    mathEntries: 0,
  };

  const getWrapperId = (wrapper: AnyWrapper): number => {
    if (!wrapper || typeof wrapper !== 'object') return 0;
    if (!wrapperIds.has(wrapper)) {
      wrapperIds.set(wrapper, nextWrapperId++);
    }
    return wrapperIds.get(wrapper) as number;
  };

  const textKey = (text: string, wrapper: AnyWrapper): string => {
    return `${getWrapperId(wrapper)}::${text}`;
  };

  const measureText = (text: string, mtextWrapper: AnyWrapper): number => {
    const key = textKey(text, mtextWrapper);
    const cached = textWidthCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    if (!mtextWrapper || typeof mtextWrapper.textWidth !== 'function') {
      throw new Error('Missing textWidth() on mtext wrapper for strict measurement.');
    }
    const width = Number(mtextWrapper.textWidth(text)) || 0;

    textWidthCache.set(key, width);
    return width;
  };

  const buildPrefixWidths = (
    word: string,
    mtextWrapper: AnyWrapper
  ): number[] => {
    const key = textKey(word, mtextWrapper);
    const existing = wordPrefixWidthCache.get(key);
    if (existing) {
      return existing;
    }

    const widths = Array.from({ length: word.length + 1 }, () => 0);
    widths[0] = 0;
    for (let i = 1; i <= word.length; i++) {
      widths[i] = measureText(word.slice(0, i), mtextWrapper);
    }

    wordPrefixWidthCache.set(key, widths);
    return widths;
  };

  const precomputeWord = (word: string, mtextWrapper: AnyWrapper): void => {
    void measureText(word, mtextWrapper);
  };

  const measureWord = (word: string, mtextWrapper: AnyWrapper): number => {
    return measureText(word, mtextWrapper);
  };

  const measurePrefix = (
    word: string,
    n: number,
    mtextWrapper: AnyWrapper
  ): number => {
    const widths = buildPrefixWidths(word, mtextWrapper);
    const clamped = Math.max(0, Math.min(n, word.length));
    return widths[clamped] || 0;
  };

  const measureMath = (wrapper: AnyWrapper): number => {
    if (!wrapper || typeof wrapper !== 'object') return 0;

    const cached = mathWidthCache.get(wrapper);
    if (cached !== undefined) {
      return cached;
    }

    const bbox =
      (typeof wrapper.getOuterBBox === 'function' && wrapper.getOuterBBox()) ||
      (typeof wrapper.getBBox === 'function' && wrapper.getBBox()) ||
      null;
    const width = bbox
      ? (Number(bbox.L) || 0) + (Number(bbox.w) || 0) + (Number(bbox.R) || 0)
      : 0;

    mathWidthCache.set(wrapper, width);
    stats.mathEntries += 1;
    return width;
  };

  const primeRuns = (runs: ParagraphRun[]): void => {
    for (const run of runs) {
      if (run.kind === 'text') {
        precomputeWord(run.text, run.wrapper);
      } else if (run.kind === 'space') {
        if (run.breakRef.kind === 'mspace') {
          measureMath(run.wrapper);
        } else {
          measureText(' ', run.wrapper);
        }
      } else {
        measureMath(run.wrapper);
      }
    }
  };

  const getStats = (): MeasurementStats => {
    return {
      textCacheEntries: textWidthCache.size,
      wordPrefixEntries: wordPrefixWidthCache.size,
      mathCacheEntries: stats.mathEntries,
    };
  };

  return {
    measureText,
    measureWord,
    measurePrefix,
    measureMath,
    precomputeWord,
    primeRuns,
    getStats,
  };
}
