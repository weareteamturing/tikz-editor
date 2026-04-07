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
import { createEnglishHyphenator, type Hyphenator } from './paragraph/hyphenate.js';
import { runsToItems } from './paragraph/items.js';
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

interface KnuthPlassLinebreakOptions {
  alignment?: ParagraphAlignment;
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
      originalComputeBBox.call(this, bbox, recompute);
      const overflow = this?.node?.attributes?.get?.('data-overflow');
      if (overflow !== 'linebreak') {
        return;
      }

      const child = this?.childNodes?.[0];
      if (!child || typeof child.breakToWidth !== 'function') {
        return;
      }

      const linebreaks = this?.jax?.linebreaks as any;
      if (!(linebreaks instanceof visitorClass)) {
        return;
      }

      if (
        typeof linebreaks.isEligibleParboxParagraph === 'function' &&
        !linebreaks.isEligibleParboxParagraph(child)
      ) {
        return;
      }

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

      let y = this.dh;
      for (const k of parents.keys()) {
        const lbox = lines[k];
        if (!lbox) {
          continue;
        }
        this.place(lbox.L || 0, y, parents[k]);
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
      const diagnostics = [
        ...errors,
        unsupportedKinds.length
          ? `flattenWarnings=${unsupportedKinds.join(', ')}`
          : 'flattenWarnings=none',
        'internalDegradeReason=no-runs',
      ];
      this.saveReport(
        wrapper,
        width,
        runs,
        emptyRunWidths,
        singleLine(runs, emptyRunWidths),
        [],
        diagnostics,
        undefined,
        'degraded',
        'no-runs',
        false,
        'unknown',
        resolved.alignment
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

    try {
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

      const fallbackDp = breakWithDp(pass2Model, width, {
        ...commonDpOptions,
        tolerance: resolved.tolerance,
        allowInfeasible: true,
      });

      let chosenModel = pass1Model;
      let chosenDp = pass1Dp;
      let passLabel = 'pretolerance';
      let internalMode: 'canonical' | 'degraded' = 'canonical';
      let internalDegradeReason: string | null = null;

      if (!pass1Dp.canProceed || !pass1Dp.lines.length) {
        chosenModel = pass2Model;
        chosenDp = pass2Dp;
        passLabel = 'tolerance';
      }

      if (!chosenDp.canProceed || !chosenDp.lines.length) {
        chosenModel = pass2Model;
        chosenDp = fallbackDp;
        passLabel = 'infeasible';
      }

      if (!chosenDp.canProceed || !chosenDp.lines.length) {
        const diagnostics = [
          ...errors,
          unsupportedKinds.length
            ? `flattenWarnings=${unsupportedKinds.join(', ')}`
            : 'flattenWarnings=none',
          ...pass1Model.errors,
          ...pass1Dp.errors,
          ...pass2Model.errors,
          ...pass2Dp.errors,
          ...fallbackDp.errors,
          'internalDegradeReason=dp-no-solution',
        ];
        internalMode = 'degraded';
        internalDegradeReason = 'dp-no-solution';
        this.saveReport(
          wrapper,
          width,
          runs,
          pass2Model.runWidths,
          singleLine(runs, chosenModel.runWidths),
          [],
          diagnostics,
          measurement,
          internalMode,
          internalDegradeReason,
          false,
          'unknown',
          resolved.alignment
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

      let appliedBreaks = applyResult.appliedBreaks;
      if (!applyResult.canProceed) {
        internalMode = 'degraded';
        internalDegradeReason = 'mutation-writeback-failed';
        appliedBreaks = [];
      }

      const stats = measurement.getStats();
      this.saveReport(
        wrapper,
        width,
        runs,
        chosenModel.runWidths,
        chosenDp.lines,
        appliedBreaks,
        [
          ...errors,
          unsupportedKinds.length
            ? `flattenWarnings=${unsupportedKinds.join(', ')}`
            : 'flattenWarnings=none',
          ...pass1Model.errors,
          ...pass1Dp.errors,
          ...pass2Model.errors,
          ...pass2Dp.errors,
          ...fallbackDp.errors,
          ...applyResult.errors,
          `alignment=${resolved.alignment}`,
          `pass=${passLabel}`,
          `dpMode=${chosenDp.mode}`,
          `dpCost=${chosenDp.totalCost}`,
          `measurement: textCache=${stats.textCacheEntries}, prefixCache=${stats.wordPrefixEntries}, mathCache=${stats.mathCacheEntries}`,
          `internalMode=${internalMode}`,
          `internalDegradeReason=${internalDegradeReason ?? 'none'}`,
        ],
        measurement,
        internalMode,
        internalDegradeReason,
        false,
        chosenDp.mode,
        resolved.alignment
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown error during DP linebreaking.';
      console.error('[mathjax-knuthplass] Canonical linebreaker failed:', error);
      this.saveReport(
        wrapper,
        width,
        runs,
        pass1Model.runWidths,
        singleLine(runs, pass1Model.runWidths),
        [],
        [
          ...errors,
          unsupportedKinds.length
            ? `flattenWarnings=${unsupportedKinds.join(', ')}`
            : 'flattenWarnings=none',
          ...pass1Model.errors,
          message,
          'internalDegradeReason=exception',
        ],
        measurement,
        'degraded',
        'exception',
        false,
        'unknown',
        resolved.alignment
      );
    }
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
    alignment: ParagraphAlignment = DEFAULT_PARAGRAPH_ALIGNMENT
  ) {
    const paragraphId = this.getParagraphId(wrapper);
    const lineMetrics = this.readLineMetrics(wrapper, lines.length);
    const report = buildParagraphLayoutReport({
      paragraphId,
      width,
      alignment,
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
    const parent = wrapper?.parent;
    const parentNode = parent?.node;
    if (!parentNode || !parentNode.isKind?.('mpadded')) {
      return false;
    }

    const overflow = parentNode.attributes?.get?.('data-overflow');
    const width = parentNode.attributes?.get?.('width');
    if (overflow !== 'linebreak') {
      return false;
    }

    return typeof width === 'string' && width.trim().length > 0;
  }
}
