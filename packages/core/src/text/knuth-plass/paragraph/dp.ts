import { englishDefaults } from '../languages/en.js';
import type { ParagraphModel } from './items.js';
import type { BreakDecision, GreedyLine, TextRun } from './types.js';

export interface DpResult {
  lines: GreedyLine[];
  errors: string[];
  canProceed: boolean;
  totalCost: number;
  mode: 'feasible' | 'infeasible';
}

export interface DpOptions {
  tolerance?: number;
  linepenalty?: number;
  adjdemerits?: number;
  doublehyphendemerits?: number;
  finalhyphendemerits?: number;
  leftskipWidth?: number;
  leftskipStretch?: number;
  leftskipShrink?: number;
  rightskipWidth?: number;
  rightskipStretch?: number;
  rightskipShrink?: number;
  parfillskipWidth?: number;
  parfillskipStretch?: number;
  parfillskipShrink?: number;
  preventOverflow?: boolean;
  allowInfeasible?: boolean;
}

interface Cursor {
  runIndex: number;
  textOffset: number;
}

interface SpacePenalty {
  penalty: number;
  sourceOffset: number;
}

interface ForcedPenalty {
  penalty: number;
  sourceOffset: number;
}

interface GlueMetrics {
  stretch: number;
  shrink: number;
}

interface TextPenalty {
  penalty: number;
  sourceOffset: number;
  splitOffset: number;
  visibleHyphen: boolean;
  width: number;
  flagged: boolean;
  hyphenSource?: 'automatic' | 'explicit';
}

interface BreakCandidate {
  endRun: number;
  endTextOffset: number | null;
  naturalWidth: number;
  spaceCount: number;
  stretch: number;
  shrink: number;
  break: BreakDecision | null;
  breakPenalty: number;
  flagged: boolean;
  nextCursor: Cursor;
}

interface CandidateScore {
  badness: number;
  fitnessClass: FitnessClass;
  demerits: number;
  ratio: number;
  delta: number;
  lineNaturalWidth: number;
  spaceDeltaPerGap: number;
  xOffset: number;
}

interface MemoChoice {
  candidate: BreakCandidate;
  fitnessClass: FitnessClass;
  score: CandidateScore;
}

interface MemoEntry {
  cost: number;
  choice: MemoChoice | null;
  isSingleLine: boolean;
}

type FitnessClass = 0 | 1 | 2 | 3; // very loose, loose, decent, tight

const MAX_RUNS_FOR_DP = 3000;
const MAX_BREAKPOINTS_FOR_DP = 1200;
const MAX_ESTIMATED_EDGES = 2_000_000;
const MAX_DP_STATES = 20000;

function breakSourceOffset(candidate: BreakCandidate): number {
  if (!candidate.break) {
    return Number.POSITIVE_INFINITY;
  }
  return candidate.break.sourceOffset;
}

function badnessFromRatio(ratio: number): number {
  const abs = Math.abs(ratio);
  if (!Number.isFinite(abs)) {
    return 10000;
  }

  const badness = Math.floor(100 * abs * abs * abs + 0.5);
  return Math.min(10000, badness);
}

function fitnessClassForRatio(ratio: number): FitnessClass {
  if (ratio > 1) return 0;
  if (ratio > 0.5) return 1;
  if (ratio >= -0.5) return 2;
  return 3;
}

function incompatibleFitness(a: FitnessClass, b: FitnessClass): boolean {
  return Math.abs(a - b) > 1;
}

function runWidth(model: ParagraphModel, runIndex: number): number {
  return model.runWidths.get(runIndex) ?? 0;
}

function normalizeCursor(
  model: ParagraphModel,
  cursor: Cursor,
  forcedPenalties: Map<number, ForcedPenalty>
): Cursor {
  let { runIndex, textOffset } = cursor;

  while (runIndex < model.runs.length) {
    const run = model.runs[runIndex];
    if (run.kind === 'space') {
      if (forcedPenalties.has(runIndex)) {
        return { runIndex, textOffset: 0 };
      }
      runIndex += 1;
      textOffset = 0;
      continue;
    }

    if (run.kind === 'text') {
      if (textOffset >= run.text.length) {
        runIndex += 1;
        textOffset = 0;
        continue;
      }
      return { runIndex, textOffset };
    }

    return { runIndex, textOffset: 0 };
  }

  return { runIndex: model.runs.length, textOffset: 0 };
}

function collectSpacePenalties(model: ParagraphModel): Map<number, SpacePenalty> {
  const map = new Map<number, SpacePenalty>();

  for (const item of model.items) {
    if (item.kind !== 'penalty') continue;
    if (item.payload.breakKind !== 'space') continue;
    if (item.penalty >= 10_000) continue;

    const runIndex = item.payload.runIndex;
    const existing = map.get(runIndex);
    if (!existing || item.penalty < existing.penalty) {
      map.set(runIndex, {
        penalty: item.penalty,
        sourceOffset: item.payload.sourceOffset,
      });
    }
  }

  return map;
}

function collectForcedPenalties(model: ParagraphModel): Map<number, ForcedPenalty> {
  const map = new Map<number, ForcedPenalty>();

  for (const item of model.items) {
    if (item.kind !== 'penalty') continue;
    if (item.payload.breakKind !== 'forced') continue;
    if (item.penalty > -10_000) continue;

    const runIndex = item.payload.runIndex;
    map.set(runIndex, {
      penalty: item.penalty,
      sourceOffset: item.payload.sourceOffset,
    });
  }

  return map;
}

function collectGlueMetrics(model: ParagraphModel): Map<number, GlueMetrics> {
  const map = new Map<number, GlueMetrics>();

  for (const item of model.items) {
    if (item.kind !== 'glue') continue;
    map.set(item.payload.runIndex, {
      stretch: item.stretch,
      shrink: item.shrink,
    });
  }

  return map;
}

function collectTextPenalties(model: ParagraphModel): Map<number, TextPenalty[]> {
  const map = new Map<number, TextPenalty[]>();

  for (const item of model.items) {
    if (item.kind !== 'penalty') continue;
    if (item.payload.breakKind !== 'hyphen') continue;
    if (item.penalty >= 10_000) continue;
    if (item.payload.splitOffset === undefined) continue;

    const runIndex = item.payload.runIndex;
    const list = map.get(runIndex) ?? [];
    list.push({
      penalty: item.penalty,
      sourceOffset: item.payload.sourceOffset,
      splitOffset: item.payload.splitOffset,
      visibleHyphen: item.payload.visibleHyphen,
      width: item.width,
      flagged: !!item.flagged,
      hyphenSource: item.payload.hyphenSource,
    });
    map.set(runIndex, list);
  }

  for (const [runIndex, list] of map) {
    list.sort((a, b) => a.splitOffset - b.splitOffset);
    const deduped: TextPenalty[] = [];

    for (const item of list) {
      const prev = deduped[deduped.length - 1];
      if (!prev || prev.splitOffset !== item.splitOffset) {
        deduped.push(item);
      } else if (item.penalty < prev.penalty) {
        deduped[deduped.length - 1] = item;
      }
    }

    map.set(runIndex, deduped);
  }

  return map;
}

function textSliceWidth(
  model: ParagraphModel,
  run: TextRun,
  start: number,
  end: number
): number {
  if (end <= start) return 0;
  const endWidth = model.measurement.measurePrefix(run.text, end, run.wrapper);
  const startWidth = model.measurement.measurePrefix(run.text, start, run.wrapper);
  return endWidth - startWidth;
}

function generateCandidates(
  model: ParagraphModel,
  startCursor: Cursor,
  forcedPenalties: Map<number, ForcedPenalty>,
  spacePenalties: Map<number, SpacePenalty>,
  glueMetrics: Map<number, GlueMetrics>,
  textPenalties: Map<number, TextPenalty[]>
): BreakCandidate[] {
  const candidates: BreakCandidate[] = [];
  const cursor = normalizeCursor(model, startCursor, forcedPenalties);

  if (cursor.runIndex >= model.runs.length) {
    return candidates;
  }

  let naturalWidth = 0;
  let spaceCount = 0;
  let stretch = 0;
  let shrink = 0;

  let naturalWidthWithoutTrailingSpaces = 0;
  let spaceCountWithoutTrailingSpaces = 0;
  let stretchWithoutTrailingSpaces = 0;
  let shrinkWithoutTrailingSpaces = 0;
  let lastNonSpaceRun = -1;
  let stoppedAtForcedBoundary = false;

  for (let runIndex = cursor.runIndex; runIndex < model.runs.length; runIndex++) {
    const run = model.runs[runIndex];

    if (run.kind === 'text') {
      const offset = runIndex === cursor.runIndex ? cursor.textOffset : 0;
      const runTextPenalties = textPenalties.get(runIndex) ?? [];

      for (const textPenalty of runTextPenalties) {
        if (textPenalty.splitOffset <= offset || textPenalty.splitOffset >= run.text.length) {
          continue;
        }

        const prefixWidth = textSliceWidth(model, run, offset, textPenalty.splitOffset);
        candidates.push({
          endRun: runIndex,
          endTextOffset: textPenalty.splitOffset,
          naturalWidth: naturalWidth + prefixWidth + textPenalty.width,
          spaceCount,
          stretch,
          shrink,
          break: {
            kind: 'hyphen',
            runIndex,
            sourceOffset: textPenalty.sourceOffset,
            visibleHyphen: textPenalty.visibleHyphen,
            splitOffset: textPenalty.splitOffset,
            hyphenSource: textPenalty.hyphenSource,
            flagged: textPenalty.flagged,
          },
          breakPenalty: textPenalty.penalty,
          flagged: textPenalty.flagged,
          nextCursor: normalizeCursor(model, {
            runIndex,
            textOffset: textPenalty.splitOffset,
          }, forcedPenalties),
        });
      }

      const remaining = textSliceWidth(model, run, offset, run.text.length);
      naturalWidth += remaining;
      naturalWidthWithoutTrailingSpaces = naturalWidth;
      spaceCountWithoutTrailingSpaces = spaceCount;
      stretchWithoutTrailingSpaces = stretch;
      shrinkWithoutTrailingSpaces = shrink;
      lastNonSpaceRun = runIndex;
      continue;
    }

    if (run.kind === 'space') {
      const forcedPenalty = forcedPenalties.get(runIndex);
      if (forcedPenalty) {
        const isEmptyLine = runIndex === cursor.runIndex && lastNonSpaceRun < cursor.runIndex;
        const forcedWidth = isEmptyLine ? runWidth(model, runIndex) : 0;
        candidates.push({
          endRun: isEmptyLine ? runIndex : Math.max(cursor.runIndex, runIndex - 1),
          endTextOffset: null,
          naturalWidth: isEmptyLine ? forcedWidth : naturalWidthWithoutTrailingSpaces,
          spaceCount: isEmptyLine ? 0 : spaceCountWithoutTrailingSpaces,
          stretch: isEmptyLine ? 0 : stretchWithoutTrailingSpaces,
          shrink: isEmptyLine ? 0 : shrinkWithoutTrailingSpaces,
          break: {
            kind: 'forced',
            runIndex,
            sourceOffset: forcedPenalty.sourceOffset,
            visibleHyphen: false,
            flagged: false,
          },
          breakPenalty: forcedPenalty.penalty,
          flagged: false,
          nextCursor: normalizeCursor(model, {
            runIndex: runIndex + 1,
            textOffset: 0,
          }, forcedPenalties),
        });
        stoppedAtForcedBoundary = true;
        break;
      }

      const spacePenalty = spacePenalties.get(runIndex);
      const previousRun = runIndex > 0 ? model.runs[runIndex - 1] : null;
      if (spacePenalty && previousRun && previousRun.kind !== 'space') {
        candidates.push({
          endRun: runIndex - 1,
          endTextOffset: null,
          naturalWidth,
          spaceCount,
          stretch,
          shrink,
          break: {
            kind: 'space',
            runIndex,
            sourceOffset: spacePenalty.sourceOffset,
            visibleHyphen: false,
            flagged: false,
          },
          breakPenalty: spacePenalty.penalty,
          flagged: false,
          nextCursor: normalizeCursor(model, {
            runIndex: runIndex + 1,
            textOffset: 0,
          }, forcedPenalties),
        });
      }

      naturalWidth += runWidth(model, runIndex);
      spaceCount += 1;
      const glue = glueMetrics.get(runIndex);
      stretch += glue?.stretch ?? 0;
      shrink += glue?.shrink ?? 0;
      continue;
    }

    naturalWidth += runWidth(model, runIndex);
    naturalWidthWithoutTrailingSpaces = naturalWidth;
    spaceCountWithoutTrailingSpaces = spaceCount;
    stretchWithoutTrailingSpaces = stretch;
    shrinkWithoutTrailingSpaces = shrink;
    lastNonSpaceRun = runIndex;
  }

  if (!stoppedAtForcedBoundary && lastNonSpaceRun >= cursor.runIndex) {
    candidates.push({
      endRun: lastNonSpaceRun,
      endTextOffset: null,
      naturalWidth: naturalWidthWithoutTrailingSpaces,
      spaceCount: spaceCountWithoutTrailingSpaces,
      stretch: stretchWithoutTrailingSpaces,
      shrink: shrinkWithoutTrailingSpaces,
      break: null,
      breakPenalty: -10_000,
      flagged: false,
      nextCursor: { runIndex: model.runs.length, textOffset: 0 },
    });
  }

  return candidates;
}

function scoreCandidate(
  candidate: BreakCandidate,
  width: number,
  tolerance: number,
  options: Required<
    Pick<
      DpOptions,
      | 'linepenalty'
      | 'leftskipWidth'
      | 'leftskipStretch'
      | 'leftskipShrink'
      | 'rightskipWidth'
      | 'rightskipStretch'
      | 'rightskipShrink'
      | 'parfillskipWidth'
      | 'parfillskipStretch'
      | 'parfillskipShrink'
      | 'preventOverflow'
      | 'allowInfeasible'
    >
  >,
  isLastLine: boolean
): CandidateScore | null {
  const isForcedBreak = candidate.break?.kind === 'forced';
  const lineNaturalWidth =
    candidate.naturalWidth +
    options.leftskipWidth +
    options.rightskipWidth +
    (isLastLine ? options.parfillskipWidth : 0);

  const totalStretch =
    candidate.stretch +
    options.leftskipStretch +
    options.rightskipStretch +
    (isLastLine ? options.parfillskipStretch : 0);
  const totalShrink =
    candidate.shrink +
    options.leftskipShrink +
    options.rightskipShrink +
    (isLastLine ? options.parfillskipShrink : 0);

  const delta = width - lineNaturalWidth;
  let ratio = 0;
  let badness = 0;
  let feasible = true;

  if (delta > 0) {
    if (!Number.isFinite(totalStretch)) {
      ratio = 0;
      badness = 0;
    } else if (totalStretch <= 0) {
      feasible = false;
      if (options.allowInfeasible) {
        ratio = Number.POSITIVE_INFINITY;
        badness = 10_000;
      } else {
        ratio = Number.POSITIVE_INFINITY;
        badness = 10_000;
      }
    } else {
      ratio = delta / totalStretch;
      badness = badnessFromRatio(ratio);
    }
  } else if (delta < 0) {
    if (!Number.isFinite(totalShrink) || totalShrink <= 0) {
      feasible = false;
      if (options.allowInfeasible) {
        ratio = delta / Math.max(width, 1);
        badness = badnessFromRatio(ratio);
      } else {
        ratio = Number.NEGATIVE_INFINITY;
        badness = 10_000;
      }
    } else {
      ratio = delta / totalShrink;
      badness = badnessFromRatio(ratio);
    }
  }

  if (!feasible && !options.allowInfeasible) {
    return null;
  }

  if (delta < 0 && options.preventOverflow && !options.allowInfeasible) {
    return null;
  }

  if (badness > tolerance && !options.allowInfeasible) {
    return null;
  }

  if (options.allowInfeasible) {
    // In infeasible fallback mode we still want TeX-like behavior for ragged
    // paragraph profiles: overflowing a line should be a last resort.
    if (delta < 0 && options.preventOverflow) {
      const overflow = -delta;
      badness += 20_000 + Math.floor((overflow / Math.max(width, 1)) * 10_000);
    }

    if (!Number.isFinite(ratio)) {
      badness = Math.max(badness, 20_000);
    } else {
      const severity = Math.max(0, Math.abs(ratio) - 4.64);
      if (severity > 0) {
        badness += Math.floor(100 * severity * severity + 0.5);
      }
    }

    const isLikelyJustified =
      options.leftskipStretch === 0 &&
      options.leftskipShrink === 0 &&
      options.rightskipStretch === 0 &&
      options.rightskipShrink === 0;
    if (isLikelyJustified && !isLastLine && candidate.spaceCount === 0) {
      badness += 20_000;
    }
  }

  const fitnessClass = fitnessClassForRatio(ratio);
  const linePenalty = options.linepenalty + badness;
  const penalty = isLastLine || isForcedBreak ? -10_000 : candidate.breakPenalty;

  if (penalty >= 10_000) {
    return null;
  }

  const base = linePenalty * linePenalty;
  let demerits = base;

  if (penalty >= 0) {
    demerits += penalty * penalty;
  } else if (penalty > -10_000) {
    demerits -= penalty * penalty;
  }

  let xOffset = options.leftskipWidth;
  if (ratio > 0 && Number.isFinite(options.leftskipStretch)) {
    xOffset += ratio * options.leftskipStretch;
  } else if (ratio < 0 && Number.isFinite(options.leftskipShrink)) {
    xOffset += ratio * options.leftskipShrink;
  }

  return {
    badness,
    fitnessClass,
    demerits,
    ratio,
    delta,
    lineNaturalWidth,
    spaceDeltaPerGap:
      candidate.spaceCount > 0
        ? ratio > 0
          ? Number.isFinite(candidate.stretch)
            ? (ratio * candidate.stretch) / candidate.spaceCount
            : 0
          : ratio < 0
            ? Number.isFinite(candidate.shrink)
              ? (ratio * candidate.shrink) / candidate.spaceCount
              : 0
            : 0
        : 0,
    xOffset: Number.isFinite(xOffset) ? xOffset : 0,
  };
}

function cursorKey(
  cursor: Cursor,
  previousFitnessClass: FitnessClass | null,
  previousFlagged: boolean
): string {
  return `${cursor.runIndex}:${cursor.textOffset}:${previousFitnessClass ?? -1}:${
    previousFlagged ? 1 : 0
  }`;
}

export function breakWithDp(
  model: ParagraphModel,
  width: number,
  options: DpOptions = {}
): DpResult {
  const errors: string[] = [];

  if (width <= 0) {
    return {
      lines: [],
      errors: ['Target width is non-positive; DP linebreaking skipped.'],
      canProceed: false,
      totalCost: Infinity,
      mode: options.allowInfeasible ? 'infeasible' : 'feasible',
    };
  }

  if (model.runs.length > MAX_RUNS_FOR_DP) {
    return {
      lines: [],
      errors: [
        `Pathological DP size: ${model.runs.length} runs exceeds limit ${MAX_RUNS_FOR_DP}.`,
      ],
      canProceed: false,
      totalCost: Infinity,
      mode: options.allowInfeasible ? 'infeasible' : 'feasible',
    };
  }

  const forcedPenalties = collectForcedPenalties(model);
  const firstCursor = normalizeCursor(
    model,
    { runIndex: 0, textOffset: 0 },
    forcedPenalties
  );
  if (firstCursor.runIndex >= model.runs.length) {
    return {
      lines: [],
      errors: ['Paragraph has no breakable content after trimming leading spaces.'],
      canProceed: false,
      totalCost: Infinity,
      mode: options.allowInfeasible ? 'infeasible' : 'feasible',
    };
  }

  const spacePenalties = collectSpacePenalties(model);
  const glueMetrics = collectGlueMetrics(model);
  const textPenalties = collectTextPenalties(model);

  const totalBreakpoints =
    forcedPenalties.size +
    spacePenalties.size +
    [...textPenalties.values()].reduce((sum, list) => sum + list.length, 0);

  if (totalBreakpoints > MAX_BREAKPOINTS_FOR_DP) {
    return {
      lines: [],
      errors: [
        `Pathological DP size: ${totalBreakpoints} breakpoints exceeds limit ${MAX_BREAKPOINTS_FOR_DP}.`,
      ],
      canProceed: false,
      totalCost: Infinity,
      mode: options.allowInfeasible ? 'infeasible' : 'feasible',
    };
  }

  const estimatedEdges =
    (model.runs.length + totalBreakpoints + 1) * (totalBreakpoints + 1);
  if (estimatedEdges > MAX_ESTIMATED_EDGES) {
    return {
      lines: [],
      errors: [
        `Pathological DP graph: estimated ${estimatedEdges} edges exceeds limit ${MAX_ESTIMATED_EDGES}.`,
      ],
      canProceed: false,
      totalCost: Infinity,
      mode: options.allowInfeasible ? 'infeasible' : 'feasible',
    };
  }

  const resolvedOptions = {
    tolerance: options.tolerance ?? englishDefaults.tolerance,
    linepenalty: options.linepenalty ?? englishDefaults.linepenalty,
    adjdemerits: options.adjdemerits ?? englishDefaults.adjdemerits,
    doublehyphendemerits:
      options.doublehyphendemerits ?? englishDefaults.doublehyphendemerits,
    finalhyphendemerits:
      options.finalhyphendemerits ?? englishDefaults.finalhyphendemerits,
    leftskipWidth: options.leftskipWidth ?? 0,
    leftskipStretch: options.leftskipStretch ?? 0,
    leftskipShrink: options.leftskipShrink ?? 0,
    rightskipWidth: options.rightskipWidth ?? 0,
    rightskipStretch: options.rightskipStretch ?? width,
    rightskipShrink: options.rightskipShrink ?? 0,
    parfillskipWidth: options.parfillskipWidth ?? 0,
    parfillskipStretch: options.parfillskipStretch ?? Number.POSITIVE_INFINITY,
    parfillskipShrink: options.parfillskipShrink ?? 0,
    preventOverflow: options.preventOverflow ?? false,
    allowInfeasible: options.allowInfeasible ?? false,
  };

  const memo = new Map<string, MemoEntry>();
  const active = new Set<string>();
  let stateCount = 0;

  const solve = (
    cursor: Cursor,
    previousFitnessClass: FitnessClass | null,
    previousFlagged: boolean
  ): MemoEntry => {
    const normalizedCursor = normalizeCursor(model, cursor, forcedPenalties);
    if (normalizedCursor.runIndex >= model.runs.length) {
      return { cost: 0, choice: null, isSingleLine: false };
    }

    const key = cursorKey(normalizedCursor, previousFitnessClass, previousFlagged);
    const cached = memo.get(key);
    if (cached) return cached;

    if (active.has(key)) {
      return { cost: Infinity, choice: null, isSingleLine: false };
    }

    active.add(key);
    stateCount += 1;
    if (stateCount > MAX_DP_STATES) {
      active.delete(key);
      return {
        cost: Infinity,
        choice: null,
        isSingleLine: false,
      };
    }

    let bestCost = Infinity;
    let bestChoice: MemoChoice | null = null;
    let bestBadness = Infinity;
    let bestNaturalWidth = -Infinity;
    let bestSourceOffset = -Infinity;

    const candidates = generateCandidates(
      model,
      normalizedCursor,
      forcedPenalties,
      spacePenalties,
      glueMetrics,
      textPenalties
    );

    for (const candidate of candidates) {
      const isLastLine = candidate.break === null;
      const score = scoreCandidate(
        candidate,
        width,
        resolvedOptions.tolerance,
        resolvedOptions,
        isLastLine
      );
      if (!score) {
        continue;
      }

      let totalCost = score.demerits;

      if (
        previousFitnessClass !== null &&
        incompatibleFitness(previousFitnessClass, score.fitnessClass)
      ) {
        totalCost += resolvedOptions.adjdemerits;
      }

      if (previousFlagged && candidate.flagged) {
        totalCost += resolvedOptions.doublehyphendemerits;
      }

      let future: MemoEntry | null = null;
      if (!isLastLine) {
        future = solve(candidate.nextCursor, score.fitnessClass, candidate.flagged);
        totalCost += future.cost;

        if (candidate.flagged && future.isSingleLine) {
          totalCost += resolvedOptions.finalhyphendemerits;
        }
      }

      if (totalCost < bestCost) {
        bestCost = totalCost;
        bestBadness = score.badness;
        bestNaturalWidth = candidate.naturalWidth;
        bestSourceOffset = breakSourceOffset(candidate);
        bestChoice = {
          candidate,
          fitnessClass: score.fitnessClass,
          score,
        };
        continue;
      }

      if (totalCost !== bestCost) {
        continue;
      }

      // TeX-style ragged-right configurations frequently produce equal
      // demerits. Prefer the candidate with lower badness, then a fuller
      // line and later breakpoint to avoid a systematic "earliest break"
      // bias from iteration order.
      const sourceOffset = breakSourceOffset(candidate);
      const isBetterTie =
        score.badness < bestBadness ||
        (score.badness === bestBadness &&
          (candidate.naturalWidth > bestNaturalWidth ||
            (candidate.naturalWidth === bestNaturalWidth &&
              sourceOffset > bestSourceOffset)));

      if (isBetterTie) {
        bestBadness = score.badness;
        bestNaturalWidth = candidate.naturalWidth;
        bestSourceOffset = sourceOffset;
        bestChoice = {
          candidate,
          fitnessClass: score.fitnessClass,
          score,
        };
      }
    }

    const result: MemoEntry = {
      cost: bestCost,
      choice: bestChoice,
      isSingleLine: bestChoice ? bestChoice.candidate.break === null : false,
    };

    memo.set(key, result);
    active.delete(key);
    return result;
  };

  const root = solve(firstCursor, null, false);

  if (!Number.isFinite(root.cost) || !root.choice) {
    return {
      lines: [],
      errors: [
        'DP failed to find a valid linebreak sequence.',
        stateCount > MAX_DP_STATES
          ? `DP state limit exceeded (${MAX_DP_STATES}).`
          : 'No valid candidate transitions were found.',
      ],
      canProceed: false,
      totalCost: Infinity,
      mode: resolvedOptions.allowInfeasible ? 'infeasible' : 'feasible',
    };
  }

  const lines: GreedyLine[] = [];
  const seen = new Set<string>();

  let lineIndex = 0;
  let cursor = firstCursor;
  let previousFitnessClass: FitnessClass | null = null;
  let previousFlagged = false;

  while (cursor.runIndex < model.runs.length) {
    const normalizedCursor = normalizeCursor(model, cursor, forcedPenalties);
    const key = cursorKey(normalizedCursor, previousFitnessClass, previousFlagged);

    if (seen.has(key)) {
      return {
        lines: [],
        errors: ['DP reconstruction loop detected.'],
        canProceed: false,
        totalCost: Infinity,
        mode: resolvedOptions.allowInfeasible ? 'infeasible' : 'feasible',
      };
    }
    seen.add(key);

    const entry = memo.get(key);
    if (!entry?.choice) {
      return {
        lines: [],
        errors: [`DP reconstruction failed at state ${key}.`],
        canProceed: false,
        totalCost: Infinity,
        mode: resolvedOptions.allowInfeasible ? 'infeasible' : 'feasible',
      };
    }

    const { candidate, score } = entry.choice;
    lines.push({
      lineIndex,
      startRun: normalizedCursor.runIndex,
      startTextOffset: normalizedCursor.textOffset,
      endRun: candidate.endRun,
      endTextOffset: candidate.endTextOffset,
      width: candidate.naturalWidth,
      targetWidth: width,
      lineNaturalWidth: score.lineNaturalWidth,
      glueSetRatio: score.ratio,
      badness: score.badness,
      spaceCount: candidate.spaceCount,
      spaceDeltaPerGap: score.spaceDeltaPerGap,
      xOffset: score.xOffset,
      break: candidate.break,
    });

    lineIndex += 1;

    if (!candidate.break) {
      break;
    }

    cursor = candidate.nextCursor;
    previousFitnessClass = entry.choice.fitnessClass;
    previousFlagged = candidate.flagged;
  }

  return {
    lines,
    errors,
    canProceed: true,
    totalCost: root.cost,
    mode: resolvedOptions.allowInfeasible ? 'infeasible' : 'feasible',
  };
}
