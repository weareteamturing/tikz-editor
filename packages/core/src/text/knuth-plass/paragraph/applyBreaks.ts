import type {
  BreakDecision,
  GreedyLine,
  ParagraphRun,
} from './types.js';
import type { ParagraphAlignment } from '../alignment.js';

export interface AppliedBreak extends BreakDecision {
  lineIndex: number;
}

export interface ApplyBreaksOptions {
  originalMtextTextByWrapper?: WeakMap<object, string[]>;
  alignment?: ParagraphAlignment;
  targetWidth?: number;
  spaceWidth?: number;
  paragraphId?: string;
}

export interface ApplyBreaksResult {
  appliedBreaks: AppliedBreak[];
  canProceed: boolean;
  errors: string[];
}

interface WrapperMutationPlan {
  childWordSplits: Map<number, Map<number, SplitMutation[]>>;
  spacePrefixes: Map<number, Map<number, string>>;
}

interface SplitMutation {
  splitOffset: number;
  insertKind: 'hyphen' | 'space';
}

interface TextMutationToken {
  kind: 'space' | 'word';
  text: string;
}

interface MtextBreakAction {
  lineIndex: number;
  kind: 'space' | 'hyphen';
  runIndex: number;
  sourceOffset: number;
  visibleHyphen: boolean;
  wrapper: any;
  childIndex: number;
  wordIndex: number;
  splitOffset?: number;
}

const JUSTIFY_SPACER = '\u200A';
const JUSTIFY_SPACER_WIDTH_FACTOR = 0.2;
const JUSTIFY_SPACER_MIN_DELTA = 0.01;
const MAX_JUSTIFY_SPACERS_PER_GAP = 12;
const MTEXT_INDENT_PATCHED = Symbol('kp-mtext-indent-patched');
const MTEXT_INDENT_PATCH_ORIGINAL = Symbol('kp-mtext-indent-original');

function alignmentToHorizontalAlign(alignment: ParagraphAlignment): 'left' | 'right' | 'center' {
  if (alignment === 'ragged-left') {
    return 'right';
  }
  if (alignment === 'center') {
    return 'center';
  }
  return 'left';
}

function safeInvalidate(wrapper: any) {
  if (wrapper && typeof wrapper.invalidateBBox === 'function') {
    wrapper.invalidateBBox();
  }
}

function isTextChild(child: any): boolean {
  return !!child?.node?.isKind?.('text');
}

function getTextChildren(wrapper: any): any[] {
  return Array.isArray(wrapper?.childNodes) ? wrapper.childNodes : [];
}

function normalizeSplitMutations(values: SplitMutation[]): SplitMutation[] {
  const byOffset = new Map<number, SplitMutation>();
  for (const value of values) {
    const existing = byOffset.get(value.splitOffset);
    if (!existing) {
      byOffset.set(value.splitOffset, value);
      continue;
    }
    if (existing.insertKind === 'space' && value.insertKind === 'hyphen') {
      byOffset.set(value.splitOffset, value);
    }
  }

  return [...byOffset.values()].sort((a, b) => a.splitOffset - b.splitOffset);
}

function restoreMtextWrapper(
  wrapper: any,
  originalMap?: WeakMap<object, string[]>
): void {
  if (!wrapper || typeof wrapper !== 'object') return;
  if (!originalMap) return;
  const snapshot = originalMap.get(wrapper);
  if (!snapshot) return;

  const children = getTextChildren(wrapper);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!isTextChild(child)) continue;
    const text = snapshot[i];
    if (text === undefined) continue;
    if (typeof child.node?.setText === 'function') {
      child.node.setText(text);
      safeInvalidate(child);
    }
  }

  if (typeof wrapper.clearBreakPoints === 'function') {
    wrapper.clearBreakPoints();
  }

  safeInvalidate(wrapper);
}

function ensureWrapperPlan(
  plans: Map<any, WrapperMutationPlan>,
  wrapper: any
): WrapperMutationPlan {
  let plan = plans.get(wrapper);
  if (!plan) {
    plan = {
      childWordSplits: new Map<number, Map<number, SplitMutation[]>>(),
      spacePrefixes: new Map<number, Map<number, string>>(),
    };
    plans.set(wrapper, plan);
  }
  return plan;
}

function pushSplit(
  plans: Map<any, WrapperMutationPlan>,
  wrapper: any,
  childIndex: number,
  wordIndex: number,
  splitOffset: number,
  insertKind: 'hyphen' | 'space'
): void {
  const plan = ensureWrapperPlan(plans, wrapper);
  let wordMap = plan.childWordSplits.get(childIndex);
  if (!wordMap) {
    wordMap = new Map<number, SplitMutation[]>();
    plan.childWordSplits.set(childIndex, wordMap);
  }
  const current = wordMap.get(wordIndex) ?? [];
  current.push({ splitOffset, insertKind });
  wordMap.set(wordIndex, current);
}

function pushSpacePrefix(
  plans: Map<any, WrapperMutationPlan>,
  wrapper: any,
  childIndex: number,
  wordIndex: number,
  prefix: string
): void {
  if (!prefix) {
    return;
  }

  const plan = ensureWrapperPlan(plans, wrapper);
  let childMap = plan.spacePrefixes.get(childIndex);
  if (!childMap) {
    childMap = new Map<number, string>();
    plan.spacePrefixes.set(childIndex, childMap);
  }
  childMap.set(wordIndex, (childMap.get(wordIndex) ?? '') + prefix);
}

function normalizePlans(plans: Map<any, WrapperMutationPlan>): void {
  for (const plan of plans.values()) {
    for (const [childIndex, wordSplits] of plan.childWordSplits.entries()) {
      for (const [wordIndex, splits] of wordSplits.entries()) {
        wordSplits.set(wordIndex, normalizeSplitMutations(splits));
      }
      plan.childWordSplits.set(childIndex, wordSplits);
    }
  }
}

function patchMtextIndentBehavior(wrapper: any): void {
  if (!wrapper || typeof wrapper !== 'object') {
    return;
  }
  if ((wrapper as Record<symbol, unknown>)[MTEXT_INDENT_PATCHED]) {
    return;
  }
  if (typeof wrapper.computeLineBBox !== 'function') {
    return;
  }

  const original = wrapper.computeLineBBox.bind(wrapper);
  (wrapper as Record<symbol, unknown>)[MTEXT_INDENT_PATCH_ORIGINAL] = original;
  (wrapper as Record<symbol, unknown>)[MTEXT_INDENT_PATCHED] = true;

  wrapper.computeLineBBox = function patchedComputeLineBBox(i: number) {
    const bbox = original(i);
    if (
      bbox &&
      typeof bbox.getIndentData === 'function' &&
      this?.node?.attributes
    ) {
      bbox.getIndentData(this.node);
    }
    return bbox;
  };
}

function applyMtextAlignment(wrapper: any, alignment: ParagraphAlignment): void {
  if (!wrapper?.node?.attributes || typeof wrapper.node.attributes.set !== 'function') {
    return;
  }

  const align = alignmentToHorizontalAlign(alignment);
  wrapper.node.attributes.set('indentalign', align);
  wrapper.node.attributes.set('indentalignfirst', align);
  wrapper.node.attributes.set('indentalignlast', align);
  wrapper.node.attributes.set('indentshift', '0');
  wrapper.node.attributes.set('indentshiftfirst', '0');
  wrapper.node.attributes.set('indentshiftlast', '0');
}

function justifiedSpacerPrefix(deltaPerGap: number, spaceWidth: number): string {
  if (deltaPerGap <= JUSTIFY_SPACER_MIN_DELTA || spaceWidth <= 0) {
    return '';
  }

  const unit = Math.max(spaceWidth * JUSTIFY_SPACER_WIDTH_FACTOR, 1e-6);
  const count = Math.min(
    MAX_JUSTIFY_SPACERS_PER_GAP,
    Math.max(0, Math.round(deltaPerGap / unit))
  );

  if (count <= 0) {
    return '';
  }
  return JUSTIFY_SPACER.repeat(count);
}

function countSplitsBeforeWord(
  wordSplits: Map<number, SplitMutation[]>,
  wordIndex: number
): number {
  let total = 0;
  for (const [index, splits] of wordSplits.entries()) {
    if (index < wordIndex) {
      total += splits.length;
    }
  }
  return total;
}

function tokenizeForMutation(text: string): TextMutationToken[] {
  const tokens = text.match(/\s+|[^\s]+/g) ?? [];
  return tokens.map((token) => ({
    kind: /^\s+$/.test(token) ? 'space' : 'word',
    text: token,
  }));
}

function wordTokenIndices(tokens: TextMutationToken[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind === 'word') {
      indices.push(i);
    }
  }
  return indices;
}

function normalizeWhitespaceToken(text: string): string {
  return /^[\t\n\r\f ]+$/.test(text) ? ' ' : text;
}

function mutateWrapperText(
  wrapper: any,
  plan: WrapperMutationPlan,
  errors: string[]
): boolean {
  const children = getTextChildren(wrapper);
  const allChildIndices = new Set<number>([
    ...plan.childWordSplits.keys(),
    ...plan.spacePrefixes.keys(),
  ]);

  for (const childIndex of allChildIndices) {
    const wordSplits = plan.childWordSplits.get(childIndex) ?? new Map();
    const spacePrefixes = plan.spacePrefixes.get(childIndex) ?? new Map();
    const child = children[childIndex];
    if (!child || !isTextChild(child)) {
      errors.push(
        `Mutation failed: mtext child ${childIndex} is missing or not text.`
      );
      return false;
    }

    if (typeof child.node?.getText !== 'function') {
      errors.push(`Mutation failed: child ${childIndex} does not expose getText().`);
      return false;
    }

    if (typeof child.node?.setText !== 'function') {
      errors.push(`Mutation failed: child ${childIndex} does not expose setText().`);
      return false;
    }

    const originalText = String(child.node.getText() ?? '');
    const tokens = tokenizeForMutation(originalText);
    const wordIndices = wordTokenIndices(tokens);

    for (const [wordIndex, splitsAscending] of wordSplits.entries()) {
      if (wordIndex < 0 || wordIndex >= wordIndices.length) {
        errors.push(
          `Mutation failed: wordIndex ${wordIndex} out of range for child ${childIndex}.`
        );
        return false;
      }

      const tokenIndex = wordIndices[wordIndex];
      let word = tokens[tokenIndex].text;
      const splitsDescending = [...splitsAscending].sort(
        (a, b) => b.splitOffset - a.splitOffset
      );
      for (const mutation of splitsDescending) {
        const split = mutation.splitOffset;
        if (split <= 0 || split >= word.length) {
          errors.push(
            `Mutation failed: splitOffset ${split} invalid for word '${word}'.`
          );
          return false;
        }
        const insertion = mutation.insertKind === 'hyphen' ? '- ' : ' ';
        word = `${word.slice(0, split)}${insertion}${word.slice(split)}`;
      }

      tokens[tokenIndex].text = word;
    }

    for (const [wordIndex, prefix] of spacePrefixes.entries()) {
      if (wordIndex <= 0 || wordIndex >= wordIndices.length) {
        errors.push(
          `Mutation failed: justified prefix wordIndex ${wordIndex} out of range for child ${childIndex}.`
        );
        return false;
      }
      const tokenIndex = wordIndices[wordIndex];
      tokens[tokenIndex].text = `${prefix}${tokens[tokenIndex].text}`;
    }

    child.node.setText(
      tokens
        .map((token) =>
          token.kind === 'space' ? normalizeWhitespaceToken(token.text) : token.text
        )
        .join('')
    );
    safeInvalidate(child);
  }

  if (typeof wrapper.clearBreakPoints === 'function') {
    wrapper.clearBreakPoints();
  }
  safeInvalidate(wrapper);
  return true;
}

function mappedIndexForSpace(
  wordSplits: Map<number, SplitMutation[]>,
  wordIndex: number
): number {
  return wordIndex + countSplitsBeforeWord(wordSplits, wordIndex);
}

function mappedIndexForHyphen(
  wordSplits: Map<number, SplitMutation[]>,
  wordIndex: number,
  splitOffset: number
): number | null {
  const splits = wordSplits.get(wordIndex) ?? [];
  const rank = splits.findIndex((split) => split.splitOffset === splitOffset);
  if (rank < 0) {
    return null;
  }

  return wordIndex + countSplitsBeforeWord(wordSplits, wordIndex) + rank + 1;
}

function clearExistingBreakStyles(
  runs: ParagraphRun[],
  touchedMtextWrappers: Set<any>,
  touchedMspaceWrappers: Set<any>
): void {
  for (const run of runs) {
    if (run.kind === 'text') {
      touchedMtextWrappers.add(run.wrapper);
      continue;
    }

    if (run.kind === 'space') {
      if (run.breakRef.kind === 'mtext-space') {
        touchedMtextWrappers.add(run.breakRef.wrapper);
      } else if (run.breakRef.kind === 'mspace') {
        touchedMspaceWrappers.add(run.breakRef.wrapper);
      }
    }
  }

  for (const wrapper of touchedMtextWrappers) {
    if (wrapper && typeof wrapper.clearBreakPoints === 'function') {
      wrapper.clearBreakPoints();
      safeInvalidate(wrapper);
    }
  }

  for (const wrapper of touchedMspaceWrappers) {
    if (wrapper && typeof wrapper.setBreakStyle === 'function') {
      wrapper.setBreakStyle('');
      safeInvalidate(wrapper);
    }
  }
}

function applyParagraphAlignment(
  paragraphWrapper: any,
  alignment: ParagraphAlignment,
  paragraphId?: string
): void {
  const parentNode = paragraphWrapper?.parent?.node;
  const attrs = parentNode?.attributes;
  if (!attrs || typeof attrs.set !== 'function') {
    return;
  }

  const align = alignmentToHorizontalAlign(alignment);
  attrs.set('data-align', align);
  attrs.set('indentalign', align);
  attrs.set('indentalignfirst', align);
  attrs.set('indentalignlast', align);
  attrs.set('indentshift', '0');
  attrs.set('indentshiftfirst', '0');
  attrs.set('indentshiftlast', '0');
  if (paragraphId) {
    attrs.set('data-paragraph-id', paragraphId);
  }
}

export function applyBreaks(
  paragraphWrapper: any,
  runs: ParagraphRun[],
  lines: GreedyLine[],
  options: ApplyBreaksOptions = {}
): ApplyBreaksResult {
  const errors: string[] = [];
  const appliedBreaks: AppliedBreak[] = [];
  const alignment = options.alignment ?? 'ragged-right';

  applyParagraphAlignment(paragraphWrapper, alignment, options.paragraphId);

  const touchedMtextWrappers = new Set<any>();
  const touchedMspaceWrappers = new Set<any>();
  clearExistingBreakStyles(runs, touchedMtextWrappers, touchedMspaceWrappers);

  for (const wrapper of touchedMtextWrappers) {
    patchMtextIndentBehavior(wrapper);
    applyMtextAlignment(wrapper, alignment);
  }

  const plans = new Map<any, WrapperMutationPlan>();
  const mtextActionsInLineOrder: MtextBreakAction[] = [];

  if (alignment === 'justified') {
    const spaceWidth = Math.max(options.spaceWidth ?? 0, 0);
    for (const line of lines) {
      const delta = Number(line.spaceDeltaPerGap ?? 0);
      if (!Number.isFinite(delta) || delta <= 0) {
        continue;
      }
      const prefix = justifiedSpacerPrefix(delta, spaceWidth);
      if (!prefix) {
        continue;
      }

      for (let runIndex = line.startRun; runIndex <= line.endRun; runIndex++) {
        const run = runs[runIndex];
        if (!run || run.kind !== 'space') {
          continue;
        }
        if (run.breakRef.kind !== 'mtext-space') {
          continue;
        }

        pushSpacePrefix(
          plans,
          run.breakRef.wrapper,
          run.breakRef.childIndex,
          run.breakRef.wordIndex,
          prefix
        );
      }
    }
  }

  for (const line of lines) {
    if (!line.break) continue;
    const breakDecision = line.break;

    if (breakDecision.kind === 'hyphen') {
      const run = runs[breakDecision.runIndex];
      if (!run || run.kind !== 'text') {
        errors.push(
          `Hyphen break points to non-text run index ${breakDecision.runIndex}.`
        );
        continue;
      }

      if (typeof breakDecision.splitOffset !== 'number') {
        errors.push(
          `Hyphen break at run ${breakDecision.runIndex} is missing splitOffset.`
        );
        continue;
      }

      pushSplit(
        plans,
        run.wrapper,
        run.childIndex,
        run.wordIndex,
        breakDecision.splitOffset,
        breakDecision.visibleHyphen ? 'hyphen' : 'space'
      );

      mtextActionsInLineOrder.push({
        lineIndex: line.lineIndex,
        kind: 'hyphen',
        runIndex: breakDecision.runIndex,
        sourceOffset: breakDecision.sourceOffset,
        visibleHyphen: breakDecision.visibleHyphen,
        wrapper: run.wrapper,
        childIndex: run.childIndex,
        wordIndex: run.wordIndex,
        splitOffset: breakDecision.splitOffset,
      });
      continue;
    }

    const run = runs[breakDecision.runIndex];
    if (!run || run.kind !== 'space') {
      appliedBreaks.push({
        lineIndex: line.lineIndex,
        kind: 'forced',
        runIndex: breakDecision.runIndex,
        sourceOffset: breakDecision.sourceOffset,
        visibleHyphen: false,
      });
      continue;
    }

    if (run.breakRef.kind === 'mtext-space') {
      mtextActionsInLineOrder.push({
        lineIndex: line.lineIndex,
        kind: 'space',
        runIndex: run.runIndex,
        sourceOffset: run.sourceEnd,
        visibleHyphen: false,
        wrapper: run.breakRef.wrapper,
        childIndex: run.breakRef.childIndex,
        wordIndex: run.breakRef.wordIndex,
      });
      continue;
    }

    if (run.breakRef.kind === 'mspace') {
      if (run.breakRef.lineLeading) {
        if (typeof run.breakRef.wrapper?.node?.attributes?.set === 'function') {
          run.breakRef.wrapper.node.attributes.set(
            'lineleading',
            run.breakRef.lineLeading
          );
        }
      }

      if (typeof run.breakRef.wrapper?.setBreakStyle === 'function') {
        run.breakRef.wrapper.setBreakStyle('before');
        safeInvalidate(run.breakRef.wrapper);
      }

      const appliedKind = breakDecision.kind === 'forced' ? 'forced' : 'space';
      appliedBreaks.push({
        lineIndex: line.lineIndex,
        kind: appliedKind,
        runIndex: run.runIndex,
        sourceOffset: run.sourceEnd,
        visibleHyphen: false,
      });
      continue;
    }

    appliedBreaks.push({
      lineIndex: line.lineIndex,
      kind: 'forced',
      runIndex: breakDecision.runIndex,
      sourceOffset: breakDecision.sourceOffset,
      visibleHyphen: false,
    });
  }

  normalizePlans(plans);

  const mutatedWrappers = new Set<any>();
  let canProceed = errors.length === 0;

  if (canProceed) {
    for (const [wrapper, plan] of plans.entries()) {
      const ok = mutateWrapperText(wrapper, plan, errors);
      if (!ok) {
        canProceed = false;
        break;
      }
      mutatedWrappers.add(wrapper);
    }
  }

  if (canProceed) {
    for (const action of mtextActionsInLineOrder) {
      const plan = plans.get(action.wrapper);
      const childSplits =
        plan?.childWordSplits.get(action.childIndex) ??
        new Map<number, SplitMutation[]>();

      let mutatedWordIndex: number | null = null;
      if (action.kind === 'space') {
        mutatedWordIndex = mappedIndexForSpace(childSplits, action.wordIndex);
      } else {
        mutatedWordIndex = mappedIndexForHyphen(
          childSplits,
          action.wordIndex,
          action.splitOffset as number
        );
      }

      if (mutatedWordIndex === null) {
        errors.push(
          `Failed to map mutated break index for line ${action.lineIndex}, run ${action.runIndex}.`
        );
        canProceed = false;
        break;
      }

      if (typeof action.wrapper?.setBreakAt !== 'function') {
        errors.push('Target mtext wrapper does not expose setBreakAt().');
        canProceed = false;
        break;
      }

      action.wrapper.setBreakAt([action.childIndex, mutatedWordIndex]);
      safeInvalidate(action.wrapper);

      appliedBreaks.push({
        lineIndex: action.lineIndex,
        kind: action.kind,
        runIndex: action.runIndex,
        sourceOffset: action.sourceOffset,
        visibleHyphen: action.visibleHyphen,
        splitOffset: action.splitOffset,
      });
    }
  }

  if (!canProceed) {
    const wrappersToRestore = new Set<any>([...mutatedWrappers]);
    for (const wrapper of plans.keys()) {
      wrappersToRestore.add(wrapper);
    }

    for (const wrapper of wrappersToRestore) {
      restoreMtextWrapper(wrapper, options.originalMtextTextByWrapper);
    }

    for (const wrapper of touchedMspaceWrappers) {
      if (wrapper && typeof wrapper.setBreakStyle === 'function') {
        wrapper.setBreakStyle('');
        safeInvalidate(wrapper);
      }
    }
  }

  safeInvalidate(paragraphWrapper);

  return {
    appliedBreaks: canProceed ? appliedBreaks : [],
    canProceed,
    errors,
  };
}
