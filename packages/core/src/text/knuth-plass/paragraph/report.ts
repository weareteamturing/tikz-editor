import type { MeasurementService } from './measure.js';
import type { AppliedBreak } from './applyBreaks.js';
import type { GreedyLine, ParagraphRun } from './types.js';
import type { ParagraphAlignment } from '../alignment.js';
import type { KnuthPlassLayoutMode } from '../install.js';

const JUSTIFY_SPACER = '\u200A';
const JUSTIFY_SPACER_WIDTH_FACTOR = 0.2;
const JUSTIFY_SPACER_MIN_DELTA = 0.01;
const MAX_JUSTIFY_SPACERS_PER_GAP = 12;

export interface ParagraphLayoutReport {
  paragraphId: string;
  width: number;
  alignment: ParagraphAlignment;
  layoutMode: KnuthPlassLayoutMode;
  lines: LineReport[];
  runs: RunReport[];
  errors: string[];
  internalMode: 'canonical' | 'degraded';
  internalDegradeReason: string | null;
  externalFallbackUsed: boolean;
  linebreakingMode: 'feasible' | 'infeasible' | 'unknown';
}

export interface LineSegmentReport {
  runIndex: number;
  kind: 'text' | 'space' | 'math';
  text?: string;
  startOffset?: number;
  endOffset?: number;
  sourceStartRaw?: number;
  sourceEndRaw?: number;
  sourceKind?: 'text' | 'math';
  x: number;
  width: number;
  caretStops?: number[];
}

export interface LineReport {
  lineIndex: number;
  startRun: number;
  endRun: number;
  width: number;
  targetWidth: number;
  naturalWidth: number;
  glueSetRatio: number;
  badness: number;
  spaceCount: number;
  spaceDeltaPerGap: number;
  ascent: number;
  descent: number;
  xStart: number;
  xEnd: number;
  break: BreakReport | null;
  segments: LineSegmentReport[];
}

export interface BreakReport {
  kind: 'space' | 'hyphen' | 'forced';
  runIndex: number;
  sourceOffset: number;
  visibleHyphen: boolean;
  lineLeading?: string;
  hyphenSource?: 'automatic' | 'explicit';
  splitOffset?: number;
}

export interface RunReport {
  runIndex: number;
  kind: 'text' | 'space' | 'math';
  sourceStart?: number;
  sourceEnd?: number;
  width: number;
  text?: string;
}

export interface BuildReportInput {
  paragraphId: string;
  width: number;
  alignment: ParagraphAlignment;
  layoutMode: KnuthPlassLayoutMode;
  runs: ParagraphRun[];
  runWidths: Map<number, number>;
  lines: GreedyLine[];
  appliedBreaks: AppliedBreak[];
  measurement?: MeasurementService;
  errors?: string[];
  internalMode?: 'canonical' | 'degraded';
  internalDegradeReason?: string | null;
  externalFallbackUsed?: boolean;
  linebreakingMode?: 'feasible' | 'infeasible' | 'unknown';
  lineMetrics?: Array<{ ascent: number; descent: number }>;
}

function textSliceWidth(
  measurement: MeasurementService | undefined,
  run: Extract<ParagraphRun, { kind: 'text' }>,
  start: number,
  end: number,
  fullWidth: number
): number {
  if (end <= start) {
    return 0;
  }

  if (measurement) {
    const endWidth = measurement.measurePrefix(run.text, end, run.wrapper);
    const startWidth = measurement.measurePrefix(run.text, start, run.wrapper);
    return endWidth - startWidth;
  }

  if (!run.text.length) {
    return 0;
  }

  return (fullWidth * (end - start)) / run.text.length;
}

function buildTextCaretStops(
  measurement: MeasurementService | undefined,
  run: Extract<ParagraphRun, { kind: 'text' }>,
  segmentX: number,
  start: number,
  end: number,
  segmentWidth: number
): number[] {
  const length = Math.max(0, end - start);
  if (length === 0) {
    return [segmentX];
  }

  const stops = new Array<number>(length + 1);
  if (measurement) {
    const base = measurement.measurePrefix(run.text, start, run.wrapper);
    for (let i = 0; i <= length; i++) {
      const width = measurement.measurePrefix(run.text, start + i, run.wrapper) - base;
      stops[i] = segmentX + width;
    }
    return stops;
  }

  for (let i = 0; i <= length; i++) {
    const t = i / length;
    stops[i] = segmentX + segmentWidth * t;
  }
  return stops;
}

function justifiedSpacerCount(deltaPerGap: number, spaceWidth: number): number {
  if (deltaPerGap <= JUSTIFY_SPACER_MIN_DELTA || spaceWidth <= 0) {
    return 0;
  }

  const unit = Math.max(spaceWidth * JUSTIFY_SPACER_WIDTH_FACTOR, 1e-6);
  return Math.min(
    MAX_JUSTIFY_SPACERS_PER_GAP,
    Math.max(0, Math.round(deltaPerGap / unit))
  );
}

export function buildParagraphLayoutReport({
  paragraphId,
  width,
  alignment,
  layoutMode,
  runs,
  runWidths,
  lines,
  appliedBreaks,
  measurement,
  errors = [],
  internalMode = 'canonical',
  internalDegradeReason = null,
  externalFallbackUsed = false,
  linebreakingMode = 'unknown',
  lineMetrics = [],
}: BuildReportInput): ParagraphLayoutReport {
  const breakByLine = new Map<number, AppliedBreak>();
  for (const entry of appliedBreaks) {
    breakByLine.set(entry.lineIndex, entry);
  }

  const runReports: RunReport[] = runs.map((run) => ({
    runIndex: run.runIndex,
    kind: run.kind,
    sourceStart: run.sourceStart,
    sourceEnd: run.sourceEnd,
    width: runWidths.get(run.runIndex) ?? 0,
    text: run.kind === 'text' || run.kind === 'space' ? run.text : undefined,
  }));

  const lineReports: LineReport[] = lines.map((line) => {
    const appliedBreak = breakByLine.get(line.lineIndex) ?? null;
    const segments: LineSegmentReport[] = [];
    const xStart = line.xOffset ?? 0;
    let x = xStart;
    let pendingJustifyPrefixWidth = 0;

    for (let i = line.startRun; i <= line.endRun && i < runReports.length; i++) {
      const run = runs[i];
      if (!run) continue;

      if (run.kind === 'text') {
        if (pendingJustifyPrefixWidth > 0) {
          x += pendingJustifyPrefixWidth;
          pendingJustifyPrefixWidth = 0;
        }

        const startOffset = i === line.startRun ? line.startTextOffset : 0;
        const endOffset =
          i === line.endRun && line.endTextOffset !== null
            ? line.endTextOffset
            : run.text.length;

        if (endOffset <= startOffset) {
          continue;
        }

        const segmentWidth = textSliceWidth(
          measurement,
          run,
          startOffset,
          endOffset,
          runWidths.get(run.runIndex) ?? 0
        );

        segments.push({
          runIndex: run.runIndex,
          kind: run.kind,
          text: run.text.slice(startOffset, endOffset),
          startOffset,
          endOffset,
          x,
          width: segmentWidth,
          caretStops: buildTextCaretStops(
            measurement,
            run,
            x,
            startOffset,
            endOffset,
            segmentWidth
          ),
        });
        x += segmentWidth;
        continue;
      }

      let segmentWidth = runWidths.get(run.runIndex) ?? 0;
      if (
        alignment !== 'justified' &&
        run.kind === 'space' &&
        (line.spaceCount ?? 0) > 0 &&
        Number.isFinite(line.spaceDeltaPerGap ?? 0)
      ) {
        segmentWidth = Math.max(
          0,
          segmentWidth + (line.spaceDeltaPerGap ?? 0)
        );
      }

      if (
        alignment === 'justified' &&
        run.kind === 'space' &&
        run.breakRef.kind === 'mtext-space'
      ) {
        const deltaPerGap = Number(line.spaceDeltaPerGap ?? 0);
        if (Number.isFinite(deltaPerGap) && deltaPerGap > 0) {
          const count = justifiedSpacerCount(deltaPerGap, segmentWidth);
          if (count > 0) {
            if (!measurement) {
              throw new Error(
                'Missing measurement service for justified spacer-prefix geometry.'
              );
            }
            const measuredPrefix = measurement.measureText(
              JUSTIFY_SPACER.repeat(count),
              run.wrapper
            );
            if (Number.isFinite(measuredPrefix) && measuredPrefix > 0) {
              pendingJustifyPrefixWidth += measuredPrefix;
            }
          }
        }
      }
      segments.push({
        runIndex: run.runIndex,
        kind: run.kind,
        text: run.kind === 'space' ? run.text : undefined,
        x,
        width: segmentWidth,
        caretStops:
          run.kind === 'space'
            ? [x, x + segmentWidth]
            : [x, x + segmentWidth],
      });
      x += segmentWidth;
    }

    const metrics = lineMetrics[line.lineIndex] ?? { ascent: 0, descent: 0 };

    return {
      lineIndex: line.lineIndex,
      startRun: line.startRun,
      endRun: line.endRun,
      width: line.lineNaturalWidth ?? line.width,
      targetWidth: line.targetWidth ?? width,
      naturalWidth: line.lineNaturalWidth ?? line.width,
      glueSetRatio: line.glueSetRatio ?? 0,
      badness: line.badness ?? 0,
      spaceCount: line.spaceCount ?? 0,
      spaceDeltaPerGap: line.spaceDeltaPerGap ?? 0,
      ascent: Number.isFinite(metrics.ascent) ? metrics.ascent : 0,
      descent: Number.isFinite(metrics.descent) ? metrics.descent : 0,
      xStart,
      xEnd: x,
      segments,
      break: appliedBreak
        ? {
            kind: appliedBreak.kind,
            runIndex: appliedBreak.runIndex,
            sourceOffset: appliedBreak.sourceOffset,
            visibleHyphen: appliedBreak.visibleHyphen,
            lineLeading: appliedBreak.lineLeading,
            hyphenSource: appliedBreak.hyphenSource,
            splitOffset: appliedBreak.splitOffset,
          }
        : line.break
          ? {
              kind: line.break.kind,
              runIndex: line.break.runIndex,
              sourceOffset: line.break.sourceOffset,
              visibleHyphen: line.break.visibleHyphen,
              lineLeading: line.break.lineLeading,
              hyphenSource: line.break.hyphenSource,
              splitOffset: line.break.splitOffset,
            }
          : null,
    };
  });

  return {
    paragraphId,
    width,
    alignment,
    layoutMode,
    lines: lineReports,
    runs: runReports,
    errors,
    internalMode,
    internalDegradeReason,
    externalFallbackUsed,
    linebreakingMode,
  };
}
