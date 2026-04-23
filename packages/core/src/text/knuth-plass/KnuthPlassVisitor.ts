import { LinebreakVisitor } from '@mathjax/src/cjs/output/common/LinebreakVisitor.js';

import {
  buildAlignmentProfile,
  DEFAULT_PARAGRAPH_ALIGNMENT,
  normalizeParagraphAlignment,
  type ParagraphAlignment,
} from './alignment.js';
import { englishDefaults } from './languages/en.js';
import { applyBreaks, type AppliedBreak } from './paragraph/applyBreaks.js';
import { breakWithDp } from './paragraph/dp.js';
import { greedyBreakParagraph } from './paragraph/greedy.js';
import { createEnglishHyphenator, type Hyphenator } from './paragraph/hyphenate.js';
import { runsToItems, type ParagraphModel } from './paragraph/items.js';
import {
  createMeasurementService,
  type MeasurementService,
} from './paragraph/measure.js';
import {
  buildParagraphLayoutReport,
  type ParagraphLayoutReport,
} from './paragraph/report.js';
import { flattenParagraph } from './paragraph/tokenize.js';
import type { AnyWrapper, GreedyLine, ParagraphRun } from './paragraph/types.js';
import type { KnuthPlassLayoutMode } from './install.js';

function widthOfRuns(runs: ParagraphRun[], runWidths: Map<number, number>): number {
  return runs.reduce((sum, run) => sum + (runWidths.get(run.runIndex) ?? 0), 0);
}

function singleLine(
  runs: ParagraphRun[],
  runWidths: Map<number, number>
): GreedyLine[] {
  if (!runs.length) {
    return [
      {
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 0,
        endRun: 0,
        endTextOffset: null,
        width: 0,
        break: null,
      },
    ];
  }

  return [
    {
      lineIndex: 0,
      startRun: 0,
      startTextOffset: 0,
      endRun: runs.length - 1,
      endTextOffset: null,
      width: widthOfRuns(runs, runWidths),
      break: null,
    },
  ];
}

function lineAlignmentOffset(
  alignment: ParagraphAlignment,
  targetWidth: number,
  naturalWidth: number
): number {
  const delta = Math.max(0, targetWidth - naturalWidth);
  if (alignment === 'center') {
    return delta / 2;
  }
  if (alignment === 'ragged-left') {
    return delta;
  }
  return 0;
}

interface ExplicitSegment {
  startRun: number;
  endRun: number;
  forcedBreakRun: number | null;
}

function isForcedBreakRun(run: ParagraphRun | undefined): boolean {
  return !!(
    run?.kind === 'space' &&
    run.breakRef.kind === 'mspace' &&
    run.breakRef.isForcedLineBreak
  );
}

function forcedBreakDecision(runIndex: number, run: ParagraphRun): GreedyLine['break'] {
  if (run.kind !== 'space' || run.breakRef.kind !== 'mspace') {
    return {
      kind: 'forced',
      runIndex,
      sourceOffset: run.sourceEnd,
      visibleHyphen: false,
    };
  }

  return {
    kind: 'forced',
    runIndex,
    sourceOffset: run.sourceEnd,
    visibleHyphen: false,
    lineLeading: run.breakRef.lineLeading,
  };
}

function collectExplicitSegments(runs: ParagraphRun[]): ExplicitSegment[] {
  const segments: ExplicitSegment[] = [];
  let startRun = 0;

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    if (!isForcedBreakRun(run)) {
      continue;
    }
    segments.push({
      startRun,
      endRun: runIndex - 1,
      forcedBreakRun: runIndex,
    });
    startRun = runIndex + 1;
  }

  segments.push({
    startRun,
    endRun: runs.length - 1,
    forcedBreakRun: null,
  });
  return segments;
}

function cloneRunsWithLocalIndices(runs: ParagraphRun[]): ParagraphRun[] {
  return runs.map((run, runIndex) => ({
    ...run,
    runIndex,
  }));
}

function mapBreakToGlobal(
  breakDecision: GreedyLine['break'],
  localRuns: ParagraphRun[]
): GreedyLine['break'] {
  if (!breakDecision) {
    return null;
  }

  const globalRun = localRuns[breakDecision.runIndex];
  if (!globalRun) {
    throw new Error(
      `Wrapped-explicit linebreak mapping failed: local break run ${breakDecision.runIndex} is missing.`
    );
  }

  return {
    ...breakDecision,
    runIndex: globalRun.runIndex,
  };
}

function mapLocalLinesToGlobal(
  localLines: GreedyLine[],
  localRuns: ParagraphRun[],
  lineIndexOffset: number,
  alignment: ParagraphAlignment,
  targetWidth: number,
  forcedBreak: GreedyLine['break']
): GreedyLine[] {
  const mapped = localLines.map((line, offset) => {
    const globalStartRun =
      line.startRun >= 0 && line.startRun < localRuns.length
        ? localRuns[line.startRun]!.runIndex
        : localRuns[0]?.runIndex ?? 0;
    const globalEndRun =
      line.endRun >= 0 && line.endRun < localRuns.length
        ? localRuns[line.endRun]!.runIndex
        : (localRuns[0]?.runIndex ?? 0) - 1;
    const naturalWidth = line.lineNaturalWidth ?? line.width;

    return {
      ...line,
      lineIndex: lineIndexOffset + offset,
      startRun: globalStartRun,
      endRun: globalEndRun,
      targetWidth,
      lineNaturalWidth: naturalWidth,
      xOffset:
        line.xOffset ?? lineAlignmentOffset(alignment, targetWidth, naturalWidth),
      break: mapBreakToGlobal(line.break, localRuns),
    };
  });

  if (mapped.length > 0) {
    mapped[mapped.length - 1] = {
      ...mapped[mapped.length - 1]!,
      break: forcedBreak,
    };
  }

  return mapped;
}

function buildFixedLines(
  runs: ParagraphRun[],
  runWidths: Map<number, number>,
  alignment: ParagraphAlignment
): GreedyLine[] {
  const rawLines: Array<{
    startRun: number;
    endRun: number;
    naturalWidth: number;
    breakDecision: GreedyLine['break'];
  }> = [];

  let startRun = 0;
  let naturalWidth = 0;

  const pushLine = (endRun: number, breakDecision: GreedyLine['break']) => {
    rawLines.push({
      startRun,
      endRun,
      naturalWidth,
      breakDecision,
    });
    startRun = endRun + 2;
    naturalWidth = 0;
  };

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    if (
      run.kind === 'space' &&
      run.breakRef.kind === 'mspace' &&
      run.breakRef.isForcedLineBreak
    ) {
      pushLine(runIndex - 1, {
        kind: 'forced',
        runIndex,
        sourceOffset: run.sourceEnd,
        visibleHyphen: false,
      });
      continue;
    }
    naturalWidth += runWidths.get(run.runIndex) ?? 0;
  }

  rawLines.push({
    startRun,
    endRun: runs.length - 1,
    naturalWidth,
    breakDecision: null,
  });

  const paragraphWidth = rawLines.reduce(
    (max, line) => Math.max(max, line.naturalWidth),
    0
  );

  return rawLines.map((line, lineIndex) => ({
    lineIndex,
    startRun: Math.max(0, line.startRun),
    startTextOffset: 0,
    endRun: line.endRun,
    endTextOffset: null,
    width: line.naturalWidth,
    targetWidth: paragraphWidth,
    lineNaturalWidth: line.naturalWidth,
    glueSetRatio: 0,
    badness: 0,
    spaceCount: 0,
    spaceDeltaPerGap: 0,
    xOffset: lineAlignmentOffset(alignment, paragraphWidth, line.naturalWidth),
    break: line.breakDecision,
  }));
}

function buildGreedyWrappedLines(
  model: ParagraphModel,
  targetWidth: number,
  alignment: ParagraphAlignment
): { lines: GreedyLine[]; errors: string[] } {
  const lines: GreedyLine[] = [];
  const errors: string[] = [];
  for (const segment of collectExplicitSegments(model.runs)) {
    const forcedBreak =
      segment.forcedBreakRun == null
        ? null
        : forcedBreakDecision(segment.forcedBreakRun, model.runs[segment.forcedBreakRun]!);
    const segmentRuns = model.runs.slice(segment.startRun, segment.endRun + 1);
    if (segmentRuns.length === 0) {
      lines.push({
        lineIndex: lines.length,
        startRun: Math.max(0, segment.startRun),
        startTextOffset: 0,
        endRun: segment.startRun - 1,
        endTextOffset: null,
        width: 0,
        targetWidth,
        lineNaturalWidth: 0,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: 0,
        spaceDeltaPerGap: 0,
        xOffset: lineAlignmentOffset(alignment, targetWidth, 0),
        break: forcedBreak,
      });
      continue;
    }

    const localRuns = cloneRunsWithLocalIndices(segmentRuns);
    const globalToLocalRunIndex = new Map<number, number>();
    for (const [localRunIndex, run] of segmentRuns.entries()) {
      globalToLocalRunIndex.set(run.runIndex, localRunIndex);
    }
    const localModel: ParagraphModel = {
      ...model,
      runs: localRuns,
      items: model.items
        .filter((item) => globalToLocalRunIndex.has(item.payload.runIndex))
        .map((item) => {
          const localRunIndex = globalToLocalRunIndex.get(item.payload.runIndex)!;
          if (item.kind === 'box') {
            return {
              ...item,
              payload: {
                ...item.payload,
                runIndex: localRunIndex,
              },
            };
          }
          if (item.kind === 'glue') {
            return {
              ...item,
              payload: {
                ...item.payload,
                runIndex: localRunIndex,
              },
            };
          }
          return {
            ...item,
            payload: {
              ...item.payload,
              runIndex: localRunIndex,
            },
          };
        }),
    };
    const broken = greedyBreakParagraph(localModel, targetWidth);
    errors.push(...broken.errors);
    lines.push(
      ...mapLocalLinesToGlobal(
        broken.lines,
        segmentRuns,
        lines.length,
        alignment,
        targetWidth,
        forcedBreak
      )
    );
  }

  return { lines, errors };
}

function buildWrappedExplicitLines(params: {
  runs: ParagraphRun[];
  measurement: MeasurementService;
  hyphenator: Hyphenator;
  targetWidth: number;
  alignment: ParagraphAlignment;
  resolved: ResolvedKnuthPlassOptions;
  commonDpOptions: {
    linepenalty: number;
    adjdemerits: number;
    doublehyphendemerits: number;
    finalhyphendemerits: number;
    leftskipWidth: number;
    leftskipStretch: number;
    leftskipShrink: number;
    rightskipWidth: number;
    rightskipStretch: number;
    rightskipShrink: number;
    parfillskipWidth: number;
    parfillskipStretch: number;
    parfillskipShrink: number;
    preventOverflow: boolean;
  };
  alignmentProfile: ReturnType<typeof buildAlignmentProfile>;
}): {
  lines: GreedyLine[];
  errors: string[];
  passLabel: 'wrapped-explicit-pretolerance' | 'wrapped-explicit-tolerance' | 'wrapped-explicit-greedy';
  linebreakingMode: 'feasible' | 'infeasible';
} {
  const {
    runs,
    measurement,
    hyphenator,
    targetWidth,
    alignment,
    resolved,
    commonDpOptions,
    alignmentProfile,
  } = params;
  const lines: GreedyLine[] = [];
  const errors: string[] = [];
  let usedTolerance = false;
  let usedGreedy = false;

  for (const [segmentIndex, segment] of collectExplicitSegments(runs).entries()) {
    const forcedBreak =
      segment.forcedBreakRun == null
        ? null
        : forcedBreakDecision(segment.forcedBreakRun, runs[segment.forcedBreakRun]!);
    const segmentRuns = runs.slice(segment.startRun, segment.endRun + 1);
    if (segmentRuns.length === 0) {
      lines.push({
        lineIndex: lines.length,
        startRun: Math.max(0, segment.startRun),
        startTextOffset: 0,
        endRun: segment.startRun - 1,
        endTextOffset: null,
        width: 0,
        targetWidth,
        lineNaturalWidth: 0,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: 0,
        spaceDeltaPerGap: 0,
        xOffset: lineAlignmentOffset(alignment, targetWidth, 0),
        break: forcedBreak,
      });
      continue;
    }

    const localRuns = cloneRunsWithLocalIndices(segmentRuns);
    const pass1Model = runsToItems(localRuns, measurement, {
      enableAutomaticHyphenation: false,
      hyphenator: null,
      hyphenpenalty: resolved.hyphenpenalty,
      exhyphenpenalty: resolved.exhyphenpenalty,
      spaceStretch: alignmentProfile.interwordStretch,
      spaceShrink: alignmentProfile.interwordShrink,
    });
    const pass1Dp = breakWithDp(pass1Model, targetWidth, {
      ...commonDpOptions,
      tolerance: resolved.pretolerance,
    });

    const pass2Model = runsToItems(localRuns, measurement, {
      enableAutomaticHyphenation: true,
      hyphenator,
      hyphenpenalty: resolved.hyphenpenalty,
      exhyphenpenalty: resolved.exhyphenpenalty,
      spaceStretch: alignmentProfile.interwordStretch,
      spaceShrink: alignmentProfile.interwordShrink,
    });
    const pass2Dp = breakWithDp(pass2Model, targetWidth, {
      ...commonDpOptions,
      tolerance: resolved.tolerance,
    });

    let chosenLines: GreedyLine[] | null = null;
    if (pass1Dp.canProceed && pass1Dp.lines.length) {
      chosenLines = pass1Dp.lines;
    } else if (pass2Dp.canProceed && pass2Dp.lines.length) {
      chosenLines = pass2Dp.lines;
      usedTolerance = true;
    } else {
      const greedy = greedyBreakParagraph(pass2Model, targetWidth);
      chosenLines = greedy.lines;
      usedGreedy = true;
      errors.push(
        ...pass1Model.errors,
        ...pass1Dp.errors,
        ...pass2Model.errors,
        ...pass2Dp.errors,
        ...greedy.errors,
        `wrapped-explicit segment ${segmentIndex} used greedy rescue`,
      );
    }

    if (!chosenLines.length) {
      throw new Error(
        `Wrapped-explicit segment ${segmentIndex} produced no lines.`
      );
    }

    if (!usedGreedy) {
      errors.push(...pass1Model.errors);
      if (usedTolerance) {
        errors.push(...pass1Dp.errors, ...pass2Model.errors, ...pass2Dp.errors);
      }
    }

    lines.push(
      ...mapLocalLinesToGlobal(
        chosenLines,
        segmentRuns,
        lines.length,
        alignment,
        targetWidth,
        forcedBreak
      )
    );
  }

  return {
    lines,
    errors,
    passLabel: usedGreedy
      ? 'wrapped-explicit-greedy'
      : usedTolerance
        ? 'wrapped-explicit-tolerance'
        : 'wrapped-explicit-pretolerance',
    linebreakingMode: usedGreedy ? 'infeasible' : 'feasible',
  };
}

interface KnuthPlassLinebreakOptions {
  alignment?: ParagraphAlignment;
  layoutMode?: KnuthPlassLayoutMode;
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

interface ResolvedKnuthPlassOptions {
  alignment: ParagraphAlignment;
  layoutMode: KnuthPlassLayoutMode;
  pretolerance: number;
  tolerance: number;
  linepenalty: number;
  hyphenpenalty: number;
  exhyphenpenalty: number;
  adjdemerits: number;
  doublehyphendemerits: number;
  finalhyphendemerits: number;
  lefthyphenmin: number;
  righthyphenmin: number;
}

export class KnuthPlassVisitor extends LinebreakVisitor<
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any
> {
  private static readonly patchedWrapperPrototypes = new WeakSet<object>();
  private static readonly patchedMrowPlaceLinePrototypes = new WeakSet<object>();
  private static configuredOptions: KnuthPlassLinebreakOptions = {};

  public static configure(options: KnuthPlassLinebreakOptions): void {
    if (!options || typeof options !== 'object') {
      return;
    }
    KnuthPlassVisitor.configuredOptions = {
      ...KnuthPlassVisitor.configuredOptions,
      ...options,
    };
  }

  public static getConfiguredOptions(): KnuthPlassLinebreakOptions {
    return { ...KnuthPlassVisitor.configuredOptions };
  }

  private readonly reportByWrapper = new WeakMap<object, ParagraphLayoutReport>();
  private readonly paragraphIdByWrapper = new WeakMap<object, string>();
  private readonly originalMtextTextByWrapper = new WeakMap<object, string[]>();
  private nextParagraphNumber = 1;

  public readonly reports: ParagraphLayoutReport[] = [];

  public constructor(factory: any) {
    super(factory);
    this.patchMpaddedWrapperComputeBBox(factory);
    this.patchMrowWrapperPlaceLines(factory);
  }

  public getReports(): ParagraphLayoutReport[] {
    return [...this.reports];
  }

  private patchMpaddedWrapperComputeBBox(factory: any): void {
    const nodeMap = factory?.nodeMap;
    const MpaddedWrapperCtor = nodeMap?.get?.('mpadded');
    if (typeof MpaddedWrapperCtor !== 'function') {
      return;
    }

    const proto = MpaddedWrapperCtor.prototype as any;
    if (!proto || KnuthPlassVisitor.patchedWrapperPrototypes.has(proto)) {
      return;
    }

    const originalComputeBBox = proto.computeBBox;
    if (typeof originalComputeBBox !== 'function') {
      return;
    }

    const visitorClass = KnuthPlassVisitor;
    proto.computeBBox = function patchedComputeBBox(this: any, bbox: any, recompute = false): void {
      const overflow = this?.node?.attributes?.get?.('data-overflow');
      if (overflow !== 'linebreak') {
        originalComputeBBox.call(this, bbox, recompute);
        return;
      }

      const child = this?.childNodes?.[0];
      if (!child || typeof child.breakToWidth !== 'function') {
        originalComputeBBox.call(this, bbox, recompute);
        return;
      }

      const linebreaks = this?.jax?.linebreaks as any;
      if (!(linebreaks instanceof visitorClass)) {
        originalComputeBBox.call(this, bbox, recompute);
        return;
      }

      if (
        typeof linebreaks.isEligibleParboxParagraph === 'function' &&
        !linebreaks.isEligibleParboxParagraph(child)
      ) {
        originalComputeBBox.call(this, bbox, recompute);
        return;
      }

      const rawWidthAttr = this?.node?.attributes?.get?.('width');
      const configuredWidth =
        typeof rawWidthAttr === 'string'
          ? Number.parseFloat(rawWidthAttr)
          : Number.NaN;
      const initialWidth = Number(this?.containerWidth);
      const targetWidth =
        initialWidth > 0
          ? initialWidth
          : configuredWidth > 0
            ? configuredWidth
            : Number.NaN;
      if (!(targetWidth > 0)) {
        originalComputeBBox.call(this, bbox, recompute);
        const width = Number(bbox?.w ?? this?.containerWidth);
        if (!(width > 0)) {
          return;
        }
        child.breakToWidth(width);
        if (typeof this.setBBoxDimens === 'function') {
          this.setBBoxDimens(bbox);
        }
        if (typeof this.setChildPWidths === 'function') {
          this.setChildPWidths(recompute, width);
        }
        return;
      }

      child.breakToWidth(targetWidth);
      originalComputeBBox.call(this, bbox, recompute);
    };

    KnuthPlassVisitor.patchedWrapperPrototypes.add(proto);
  }

  private patchMrowWrapperPlaceLines(factory: any): void {
    const nodeMap = factory?.nodeMap;
    const MrowWrapperCtor = nodeMap?.get?.('mrow');
    if (typeof MrowWrapperCtor !== 'function') {
      return;
    }

    const proto = MrowWrapperCtor.prototype as any;
    if (!proto || KnuthPlassVisitor.patchedMrowPlaceLinePrototypes.has(proto)) {
      return;
    }

    const originalPlaceLines = proto.placeLines;
    if (typeof originalPlaceLines !== 'function') {
      return;
    }
    const visitorClass = KnuthPlassVisitor;

    proto.placeLines = function patchedPlaceLines(this: any, parents: any[]): void {
      const paragraphId = this?.parent?.node?.attributes?.get?.('data-paragraph-id');
      if (!paragraphId) {
        originalPlaceLines.call(this, parents);
        return;
      }

      const lines = this?.lineBBox;
      if (!Array.isArray(lines) || !Array.isArray(parents)) {
        originalPlaceLines.call(this, parents);
        return;
      }
      const linebreaks = this?.jax?.linebreaks;
      const report =
        linebreaks instanceof visitorClass &&
        typeof linebreaks.getReportFor === 'function'
          ? linebreaks.getReportFor(this)
          : null;
      const reportLines = Array.isArray(report?.lines) ? report.lines : null;

      let y = this.dh;
      for (const k of parents.keys()) {
        const lbox = lines[k];
        if (!lbox) {
          continue;
        }
        const reportLine = reportLines?.[k];
        const lineX =
          reportLine && Number.isFinite(reportLine.xStart)
            ? reportLine.xStart
            : lbox.L || 0;
        this.place(lineX, y, parents[k]);
        y -=
          Math.max(0.25, lbox.d) +
          (Number.isFinite(lbox.lineLeading) ? lbox.lineLeading : 0) +
          Math.max(0.75, lines[k + 1]?.h || 0);
      }
    };

    KnuthPlassVisitor.patchedMrowPlaceLinePrototypes.add(proto);
  }

  public getLatestReport(): ParagraphLayoutReport | null {
    return this.reports.length ? this.reports[this.reports.length - 1] : null;
  }

  public getReportFor(wrapper: AnyWrapper): ParagraphLayoutReport | null {
    if (!wrapper || typeof wrapper !== 'object') {
      return null;
    }
    return this.reportByWrapper.get(wrapper) ?? null;
  }

  public override breakToWidth(wrapper: AnyWrapper, width: number): void {
    if (!this.isEligibleParboxParagraph(wrapper)) {
      super.breakToWidth(wrapper, width);
      return;
    }

    this.restoreParagraphMtextState(wrapper);

    const options = this.getKnuthPlassOptions(wrapper);
    const resolved = this.resolveKnuthPlassOptions(options);
    const hyphenator: Hyphenator = createEnglishHyphenator({
      leftMin: resolved.lefthyphenmin,
      rightMin: resolved.righthyphenmin,
    });
    const measurement = createMeasurementService();
    const { runs, errors, unsupportedKinds } = flattenParagraph(wrapper);
    const emptyRunWidths = new Map<number, number>();

    if (!runs.length) {
      this.saveReport(
        wrapper,
        width,
        runs,
        emptyRunWidths,
        singleLine(runs, emptyRunWidths),
        [],
        [
          ...errors,
          unsupportedKinds.length
            ? `flattenWarnings=${unsupportedKinds.join(', ')}`
            : 'flattenWarnings=none',
          `alignment=${resolved.alignment}`,
          `layoutMode=${resolved.layoutMode}`,
          'pass=empty',
        ],
        undefined,
        'canonical',
        null,
        false,
        'unknown',
        resolved.alignment,
        resolved.layoutMode
      );
      return;
    }

    this.captureOriginalMtextStateFromRuns(runs);

    const spaceWidth = this.estimateSpaceWidth(runs, measurement, width);
    const alignmentProfile = buildAlignmentProfile(resolved.alignment, spaceWidth);

    const pass1Model = runsToItems(runs, measurement, {
      enableAutomaticHyphenation: false,
      hyphenator: null,
      hyphenpenalty: resolved.hyphenpenalty,
      exhyphenpenalty: resolved.exhyphenpenalty,
      spaceStretch: alignmentProfile.interwordStretch,
      spaceShrink: alignmentProfile.interwordShrink,
    });

    const commonDpOptions = {
      linepenalty: resolved.linepenalty,
      adjdemerits: resolved.adjdemerits,
      doublehyphendemerits: resolved.doublehyphendemerits,
      finalhyphendemerits: resolved.finalhyphendemerits,
      leftskipWidth: alignmentProfile.leftskip.width,
      leftskipStretch: alignmentProfile.leftskip.stretch,
      leftskipShrink: alignmentProfile.leftskip.shrink,
      rightskipWidth: alignmentProfile.rightskip.width,
      rightskipStretch: alignmentProfile.rightskip.stretch,
      rightskipShrink: alignmentProfile.rightskip.shrink,
      parfillskipWidth: alignmentProfile.parfillskip.width,
      parfillskipStretch: alignmentProfile.parfillskip.stretch,
      parfillskipShrink: alignmentProfile.parfillskip.shrink,
      preventOverflow: alignmentProfile.preventOverflow,
    };

    if (resolved.layoutMode === 'fixed-lines') {
      const lines = buildFixedLines(runs, pass1Model.runWidths, resolved.alignment);
      const paragraphId = this.getParagraphId(wrapper);
      const targetWidth =
        lines.reduce(
          (max, line) => Math.max(max, line.targetWidth ?? line.width),
          0
        ) || width;
      const applyResult = applyBreaks(wrapper, runs, lines, {
        originalMtextTextByWrapper: this.originalMtextTextByWrapper,
        alignment: resolved.alignment,
        targetWidth,
        spaceWidth,
        paragraphId,
      });
      if (!applyResult.canProceed) {
        throw new Error(
          `Fixed-lines paragraph mutation failed: ${applyResult.errors.join('; ') || 'unknown error'}`
        );
      }
      const stats = measurement.getStats();
      this.saveReport(
        wrapper,
        targetWidth,
        runs,
        pass1Model.runWidths,
        lines,
        applyResult.appliedBreaks,
        [
          ...errors,
          unsupportedKinds.length
            ? `flattenWarnings=${unsupportedKinds.join(', ')}`
            : 'flattenWarnings=none',
          ...pass1Model.errors,
          ...applyResult.errors,
          `alignment=${resolved.alignment}`,
          `layoutMode=${resolved.layoutMode}`,
          'pass=fixed-lines',
          'dpMode=feasible',
          'dpCost=0',
          `measurement: textCache=${stats.textCacheEntries}, prefixCache=${stats.wordPrefixEntries}, mathCache=${stats.mathCacheEntries}`,
          'internalMode=canonical',
          'internalDegradeReason=none',
        ],
        measurement,
        'canonical',
        null,
        false,
        'feasible',
        resolved.alignment,
        resolved.layoutMode
      );
      return;
    }

    if (resolved.layoutMode === 'wrapped-explicit') {
      const wrappedExplicit = buildWrappedExplicitLines({
        runs,
        measurement,
        hyphenator,
        targetWidth: width,
        alignment: resolved.alignment,
        resolved,
        commonDpOptions,
        alignmentProfile,
      });
      const paragraphId = this.getParagraphId(wrapper);
      const applyResult = applyBreaks(wrapper, runs, wrappedExplicit.lines, {
        originalMtextTextByWrapper: this.originalMtextTextByWrapper,
        alignment: resolved.alignment,
        targetWidth: width,
        spaceWidth,
        paragraphId,
      });
      if (!applyResult.canProceed) {
        const diagnostics = [
          ...errors,
          unsupportedKinds.length
            ? `flattenWarnings=${unsupportedKinds.join(', ')}`
            : 'flattenWarnings=none',
          ...pass1Model.errors,
          ...wrappedExplicit.errors,
          ...applyResult.errors,
        ];
        throw new Error(
          `Knuth-Plass wrapped-explicit layout failed: ${diagnostics.join('; ') || 'no solution'}`
        );
      }
      const stats = measurement.getStats();
      this.saveReport(
        wrapper,
        width,
        runs,
        pass1Model.runWidths,
        wrappedExplicit.lines,
        applyResult.appliedBreaks,
        [
          ...errors,
          unsupportedKinds.length
            ? `flattenWarnings=${unsupportedKinds.join(', ')}`
            : 'flattenWarnings=none',
          ...pass1Model.errors,
          ...wrappedExplicit.errors,
          ...applyResult.errors,
          `alignment=${resolved.alignment}`,
          `layoutMode=${resolved.layoutMode}`,
          `pass=${wrappedExplicit.passLabel}`,
          `dpMode=${wrappedExplicit.linebreakingMode}`,
          'dpCost=0',
          `measurement: textCache=${stats.textCacheEntries}, prefixCache=${stats.wordPrefixEntries}, mathCache=${stats.mathCacheEntries}`,
          'internalMode=canonical',
          'internalDegradeReason=none',
        ],
        measurement,
        'canonical',
        null,
        false,
        wrappedExplicit.linebreakingMode,
        resolved.alignment,
        resolved.layoutMode
      );
      return;
    }

    const pass1Dp = breakWithDp(pass1Model, width, {
      ...commonDpOptions,
      tolerance: resolved.pretolerance,
    });

    const pass2Model = runsToItems(runs, measurement, {
      enableAutomaticHyphenation: true,
      hyphenator,
      hyphenpenalty: resolved.hyphenpenalty,
      exhyphenpenalty: resolved.exhyphenpenalty,
      spaceStretch: alignmentProfile.interwordStretch,
      spaceShrink: alignmentProfile.interwordShrink,
    });

    const pass2Dp = breakWithDp(pass2Model, width, {
      ...commonDpOptions,
      tolerance: resolved.tolerance,
    });

    let chosenModel = pass1Model;
    let chosenDp = pass1Dp;
    let passLabel = 'pretolerance';

    if (!pass1Dp.canProceed || !pass1Dp.lines.length) {
      chosenModel = pass2Model;
      chosenDp = pass2Dp;
      passLabel = 'tolerance';
    }

    if (!chosenDp.canProceed || !chosenDp.lines.length) {
      const singleLineWidth = widthOfRuns(runs, pass2Model.runWidths);
      if (singleLineWidth <= width + 1e-6) {
        const lines = singleLine(runs, pass2Model.runWidths);
        const paragraphId = this.getParagraphId(wrapper);
        const applyResult = applyBreaks(wrapper, runs, lines, {
          originalMtextTextByWrapper: this.originalMtextTextByWrapper,
          alignment: resolved.alignment,
          targetWidth: width,
          spaceWidth,
          paragraphId,
        });
        if (!applyResult.canProceed) {
          throw new Error(
            `Single-line paragraph mutation failed: ${applyResult.errors.join('; ') || 'unknown error'}`
          );
        }
        const stats = measurement.getStats();
        this.saveReport(
          wrapper,
          width,
          runs,
          pass2Model.runWidths,
          lines,
          applyResult.appliedBreaks,
          [
            ...errors,
            unsupportedKinds.length
              ? `flattenWarnings=${unsupportedKinds.join(', ')}`
              : 'flattenWarnings=none',
            ...pass1Model.errors,
            ...pass1Dp.errors,
            ...pass2Model.errors,
            ...pass2Dp.errors,
            ...applyResult.errors,
            `alignment=${resolved.alignment}`,
            `layoutMode=${resolved.layoutMode}`,
            'pass=single-line',
            'dpMode=feasible',
            'dpCost=0',
            `measurement: textCache=${stats.textCacheEntries}, prefixCache=${stats.wordPrefixEntries}, mathCache=${stats.mathCacheEntries}`,
            'internalMode=canonical',
            'internalDegradeReason=none',
          ],
          measurement,
          'canonical',
          null,
          false,
          'feasible',
          resolved.alignment,
          resolved.layoutMode
        );
        return;
      }
      const greedyResult = buildGreedyWrappedLines(
        pass2Model,
        width,
        resolved.alignment
      );
      const paragraphId = this.getParagraphId(wrapper);
      const applyResult = applyBreaks(wrapper, runs, greedyResult.lines, {
        originalMtextTextByWrapper: this.originalMtextTextByWrapper,
        alignment: resolved.alignment,
        targetWidth: width,
        spaceWidth,
        paragraphId,
      });
      if (!applyResult.canProceed) {
        const diagnostics = [
          ...errors,
          unsupportedKinds.length
            ? `flattenWarnings=${unsupportedKinds.join(', ')}`
            : 'flattenWarnings=none',
          ...pass1Model.errors,
          ...pass1Dp.errors,
          ...pass2Model.errors,
          ...pass2Dp.errors,
          ...greedyResult.errors,
          ...applyResult.errors,
        ];
        throw new Error(
          `Knuth-Plass ${resolved.layoutMode} layout failed: ${diagnostics.join('; ') || 'no solution'}`
        );
      }
      const stats = measurement.getStats();
      this.saveReport(
        wrapper,
        width,
        runs,
        pass2Model.runWidths,
        greedyResult.lines,
        applyResult.appliedBreaks,
        [
          ...errors,
          unsupportedKinds.length
            ? `flattenWarnings=${unsupportedKinds.join(', ')}`
            : 'flattenWarnings=none',
          ...pass1Model.errors,
          ...pass1Dp.errors,
          ...pass2Model.errors,
          ...pass2Dp.errors,
          ...greedyResult.errors,
          ...applyResult.errors,
          `alignment=${resolved.alignment}`,
          `layoutMode=${resolved.layoutMode}`,
          'pass=greedy-wrap',
          'dpMode=infeasible',
          'dpCost=0',
          `measurement: textCache=${stats.textCacheEntries}, prefixCache=${stats.wordPrefixEntries}, mathCache=${stats.mathCacheEntries}`,
          'internalMode=canonical',
          'internalDegradeReason=none',
        ],
        measurement,
        'canonical',
        null,
        false,
        'infeasible',
        resolved.alignment,
        resolved.layoutMode
      );
      return;
    }

    const paragraphId = this.getParagraphId(wrapper);
    const applyResult = applyBreaks(wrapper, runs, chosenDp.lines, {
      originalMtextTextByWrapper: this.originalMtextTextByWrapper,
      alignment: resolved.alignment,
      targetWidth: width,
      spaceWidth,
      paragraphId,
    });
    if (!applyResult.canProceed) {
      throw new Error(
        `Paragraph mutation failed: ${applyResult.errors.join('; ') || 'unknown error'}`
      );
    }

    const stats = measurement.getStats();
    this.saveReport(
      wrapper,
      width,
      runs,
      chosenModel.runWidths,
      chosenDp.lines,
      applyResult.appliedBreaks,
      [
        ...errors,
        unsupportedKinds.length
          ? `flattenWarnings=${unsupportedKinds.join(', ')}`
          : 'flattenWarnings=none',
        ...pass1Model.errors,
        ...pass1Dp.errors,
        ...pass2Model.errors,
        ...pass2Dp.errors,
        ...applyResult.errors,
        `alignment=${resolved.alignment}`,
        `layoutMode=${resolved.layoutMode}`,
        `pass=${passLabel}`,
        `dpMode=${chosenDp.mode}`,
        `dpCost=${chosenDp.totalCost}`,
        `measurement: textCache=${stats.textCacheEntries}, prefixCache=${stats.wordPrefixEntries}, mathCache=${stats.mathCacheEntries}`,
        'internalMode=canonical',
        'internalDegradeReason=none',
      ],
      measurement,
      'canonical',
      null,
      false,
      chosenDp.mode,
      resolved.alignment,
      resolved.layoutMode
    );
  }

  private getKnuthPlassOptions(wrapper: AnyWrapper): KnuthPlassLinebreakOptions {
    const jax = wrapper?.jax;
    const raw = jax?.knuthPlassOptions;
    const configured = KnuthPlassVisitor.getConfiguredOptions();
    const fromRuntime =
      raw && typeof raw === 'object' ? (raw as KnuthPlassLinebreakOptions) : {};

    return {
      ...configured,
      ...fromRuntime,
    };
  }

  private resolveKnuthPlassOptions(
    options: KnuthPlassLinebreakOptions
  ): ResolvedKnuthPlassOptions {
    return {
      alignment: normalizeParagraphAlignment(options.alignment),
      layoutMode: options.layoutMode ?? 'wrap',
      pretolerance: options.pretolerance ?? englishDefaults.pretolerance,
      tolerance: options.tolerance ?? englishDefaults.tolerance,
      linepenalty: options.linepenalty ?? englishDefaults.linepenalty,
      hyphenpenalty: options.hyphenpenalty ?? englishDefaults.hyphenpenalty,
      exhyphenpenalty: options.exhyphenpenalty ?? englishDefaults.exhyphenpenalty,
      adjdemerits: options.adjdemerits ?? englishDefaults.adjdemerits,
      doublehyphendemerits:
        options.doublehyphendemerits ?? englishDefaults.doublehyphendemerits,
      finalhyphendemerits:
        options.finalhyphendemerits ?? englishDefaults.finalhyphendemerits,
      lefthyphenmin: options.lefthyphenmin ?? englishDefaults.lefthyphenmin,
      righthyphenmin: options.righthyphenmin ?? englishDefaults.righthyphenmin,
    };
  }

  private estimateSpaceWidth(
    runs: ParagraphRun[],
    measurement: MeasurementService,
    width: number
  ): number {
    for (const run of runs) {
      if (run.kind === 'space') {
        if (run.breakRef.kind === 'mspace') {
          continue;
        }
        const w = measurement.measureText(' ', run.wrapper);
        if (w > 0) {
          return w;
        }
      }
      if (run.kind === 'text') {
        const w = measurement.measureText(' ', run.wrapper);
        if (w > 0) {
          return w;
        }
      }
    }

    return Math.max(width / 40, 0.25);
  }

  private captureOriginalMtextStateFromRuns(runs: ParagraphRun[]): void {
    const wrappers = new Set<any>();
    for (const run of runs) {
      if (run.kind === 'text') {
        wrappers.add(run.wrapper);
      }
    }

    for (const wrapper of wrappers) {
      this.captureOriginalMtextState(wrapper);
    }
  }

  private captureOriginalMtextState(wrapper: AnyWrapper): void {
    if (!wrapper || typeof wrapper !== 'object') return;
    if (!wrapper.node?.isKind?.('mtext')) return;
    if (this.originalMtextTextByWrapper.has(wrapper)) return;

    const childNodes = Array.isArray(wrapper.childNodes) ? wrapper.childNodes : [];
    const snapshot = childNodes.map((child: any) => {
      if (!child?.node?.isKind?.('text')) return '';
      return String(child.node.getText?.() ?? '');
    });
    this.originalMtextTextByWrapper.set(wrapper, snapshot);
  }

  private restoreParagraphMtextState(paragraphWrapper: AnyWrapper): void {
    const stack: AnyWrapper[] = [paragraphWrapper];
    const seen = new Set<object>();

    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;
      if (seen.has(current)) continue;
      seen.add(current);

      if (current.node?.isKind?.('mtext')) {
        this.restoreMtextWrapper(current);
      }

      const children = Array.isArray(current.childNodes) ? current.childNodes : [];
      for (const child of children) {
        stack.push(child);
      }
    }
  }

  private restoreMtextWrapper(wrapper: AnyWrapper): void {
    const snapshot = this.originalMtextTextByWrapper.get(wrapper);
    if (!snapshot) return;

    const children = Array.isArray(wrapper.childNodes) ? wrapper.childNodes : [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child?.node?.isKind?.('text')) continue;
      if (typeof child.node?.setText !== 'function') continue;
      if (snapshot[i] === undefined) continue;
      child.node.setText(snapshot[i]);
      if (typeof child.invalidateBBox === 'function') {
        child.invalidateBBox();
      }
    }

    if (typeof wrapper.clearBreakPoints === 'function') {
      wrapper.clearBreakPoints();
    }
    if (typeof wrapper.invalidateBBox === 'function') {
      wrapper.invalidateBBox();
    }
  }

  private saveReport(
    wrapper: AnyWrapper,
    width: number,
    runs: ParagraphRun[],
    runWidths: Map<number, number>,
    lines: GreedyLine[],
    appliedBreaks: AppliedBreak[],
    errors: string[],
    measurement?: MeasurementService,
    internalMode: 'canonical' | 'degraded' = 'canonical',
    internalDegradeReason: string | null = null,
    externalFallbackUsed = false,
    linebreakingMode: 'feasible' | 'infeasible' | 'unknown' = 'unknown',
    alignment: ParagraphAlignment = DEFAULT_PARAGRAPH_ALIGNMENT,
    layoutMode: KnuthPlassLayoutMode = 'wrap'
  ) {
    const paragraphId = this.getParagraphId(wrapper);
    const lineMetrics = this.readLineMetrics(wrapper, lines.length);
    const report = buildParagraphLayoutReport({
      paragraphId,
      width,
      alignment,
      layoutMode,
      runs,
      runWidths,
      lines,
      appliedBreaks,
      measurement,
      errors,
      internalMode,
      internalDegradeReason,
      externalFallbackUsed,
      linebreakingMode,
      lineMetrics,
    });

    this.reports.push(report);
    if (wrapper && typeof wrapper === 'object') {
      this.reportByWrapper.set(wrapper, report);
    }

  }

  private getParagraphId(wrapper: AnyWrapper): string {
    if (!wrapper || typeof wrapper !== 'object') {
      return `paragraph-${this.nextParagraphNumber++}`;
    }

    const existing = this.paragraphIdByWrapper.get(wrapper);
    if (existing) {
      return existing;
    }

    const id = `paragraph-${this.nextParagraphNumber++}`;
    this.paragraphIdByWrapper.set(wrapper, id);
    return id;
  }

  private readLineMetrics(
    wrapper: AnyWrapper,
    lineCount: number
  ): Array<{ ascent: number; descent: number }> {
    const metrics: Array<{ ascent: number; descent: number }> = [];
    const lineWrapper = Array.isArray(wrapper?.childNodes)
      ? wrapper.childNodes[0]
      : null;

    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
      const bbox =
        lineWrapper?.lineBBox?.[lineIndex] ?? null;
      const ascent = Number(bbox?.h);
      const descent = Number(bbox?.d);
      metrics.push({
        ascent: Number.isFinite(ascent) ? ascent : 0,
        descent: Number.isFinite(descent) ? descent : 0,
      });
    }

    return metrics;
  }

  private isEligibleParboxParagraph(wrapper: AnyWrapper): boolean {
    let current = wrapper?.parent;
    while (current && typeof current === 'object') {
      const currentNode = current.node;
      if (currentNode?.isKind?.('mpadded')) {
        const overflow = currentNode.attributes?.get?.('data-overflow');
        const width = currentNode.attributes?.get?.('width');
        return overflow === 'linebreak' && typeof width === 'string' && width.trim().length > 0;
      }
      current = current.parent;
    }
    return false;
  }
}
