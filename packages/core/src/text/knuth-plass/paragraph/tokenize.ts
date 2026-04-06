import type {
  AnyWrapper,
  BreakRef,
  FlattenResult,
  MathRun,
  ParagraphRun,
  SpaceRun,
  TextRun,
} from './types.js';

const TRANSPARENT_KINDS = new Set([
  'math',
  'mrow',
  'inferredMrow',
  'mstyle',
  'mpadded',
  'semantics',
  'TeXAtom',
]);

const UNSUPPORTED_KINDS = new Set([
  'mtable',
  'mtr',
  'mtd',
  'mlabeledtr',
  'maligngroup',
  'malignmark',
  'mstack',
  'mscarries',
  'mscarry',
  'msline',
  'msgroup',
  'msrow',
  'mlongdiv',
]);

function isKind(wrapper: AnyWrapper, kind: string): boolean {
  return !!wrapper?.node?.isKind?.(kind);
}

function wrapperKind(wrapper: AnyWrapper): string {
  return String(wrapper?.node?.kind ?? 'unknown');
}

function getChildren(wrapper: AnyWrapper): AnyWrapper[] {
  return Array.isArray(wrapper?.childNodes) ? wrapper.childNodes : [];
}

function getMspaceLinebreak(wrapper: AnyWrapper): string {
  const raw = wrapper?.node?.attributes?.get?.('linebreak');
  return typeof raw === 'string' ? raw : '';
}

function isForcedMspaceLinebreak(linebreak: string): boolean {
  return linebreak === 'newline' || linebreak === 'indentingnewline';
}

const FORCE_BREAK_LINELEADING_PATTERN =
  /^\[\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu)\s*\]/i;

function extractForcedLineLeadingPrefix(
  token: string
): { lineLeading: string; consumed: number } | null {
  const match = token.match(FORCE_BREAK_LINELEADING_PATTERN);
  if (!match) {
    return null;
  }
  const full = match[0];
  const inner = full.slice(1, -1).trim();
  if (!inner.length) {
    return null;
  }
  return { lineLeading: inner, consumed: full.length };
}

function normalizeForcedLineLeadingRuns(runs: ParagraphRun[]): ParagraphRun[] {
  const lineLeadingByForcedRun = new Map<number, { lineLeading: string; consumed: number }>();

  for (let i = 0; i < runs.length - 1; i++) {
    const run = runs[i];
    if (run.kind !== 'space') continue;
    if (run.breakRef.kind !== 'mspace') continue;
    if (!run.breakRef.isForcedLineBreak) continue;

    const next = runs[i + 1];
    if (!next || next.kind !== 'text') continue;

    const parsed = extractForcedLineLeadingPrefix(next.text);
    if (!parsed) continue;
    lineLeadingByForcedRun.set(i, parsed);
  }

  if (!lineLeadingByForcedRun.size) {
    return runs;
  }

  const trimmedByTextRun = new Map<number, number>();
  for (const [forcedRunIndex, parsed] of lineLeadingByForcedRun.entries()) {
    trimmedByTextRun.set(forcedRunIndex + 1, parsed.consumed);
  }

  const normalized: ParagraphRun[] = [];
  let cursor = 0;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];

    if (run.kind === 'text') {
      const consumed = trimmedByTextRun.get(i) ?? 0;
      const text = consumed > 0 ? run.text.slice(consumed) : run.text;
      if (!text.length) {
        continue;
      }

      const sourceStart = cursor;
      const sourceEnd = sourceStart + text.length;
      normalized.push({
        ...run,
        runIndex: normalized.length,
        text,
        sourceStart,
        sourceEnd,
      });
      cursor = sourceEnd;
      continue;
    }

    if (run.kind === 'space' && run.breakRef.kind === 'mspace') {
      const parsed = lineLeadingByForcedRun.get(i);
      const sourceStart = cursor;
      const sourceEnd = sourceStart + 1;
      normalized.push({
        ...run,
        runIndex: normalized.length,
        sourceStart,
        sourceEnd,
        breakRef: parsed
          ? {
              ...run.breakRef,
              lineLeading: parsed.lineLeading,
            }
          : run.breakRef,
      });
      cursor = sourceEnd;
      continue;
    }

    const sourceStart = cursor;
    const sourceEnd = sourceStart + (run.kind === 'space' ? 1 : 1);
    normalized.push({
      ...run,
      runIndex: normalized.length,
      sourceStart,
      sourceEnd,
    });
    cursor = sourceEnd;
  }

  return normalized;
}

function emitRun<T extends ParagraphRun>(
  runs: ParagraphRun[],
  run: Omit<T, 'runIndex'>
): void {
  const fullRun = {
    ...run,
    runIndex: runs.length,
  } as T;
  runs.push(fullRun);
}

interface FlattenContext {
  runs: ParagraphRun[];
  errors: string[];
  cursor: { value: number };
  unsupportedKinds: Set<string>;
}

function warnUnsupported(
  context: FlattenContext,
  wrapper: AnyWrapper,
  message: string
): void {
  const kind = wrapperKind(wrapper);
  context.unsupportedKinds.add(kind);
  context.errors.push(`${message} (kind: ${kind})`);
}

function emitAtomicMathRun(context: FlattenContext, wrapper: AnyWrapper) {
  const sourceStart = context.cursor.value;
  const sourceEnd = sourceStart + 1;
  emitRun<MathRun>(context.runs, {
    kind: 'math',
    wrapper,
    sourceStart,
    sourceEnd,
  });
  context.cursor.value = sourceEnd;
}

function isUnsupportedKind(wrapper: AnyWrapper): boolean {
  return UNSUPPORTED_KINDS.has(wrapperKind(wrapper));
}

function emitTextPieces(wrapper: AnyWrapper, context: FlattenContext) {
  const children = getChildren(wrapper);
  for (let childIndex = 0; childIndex < children.length; childIndex++) {
    const child = children[childIndex];
    if (!child) {
      warnUnsupported(
        context,
        wrapper,
        'Encountered empty child wrapper while flattening mtext.'
      );
      continue;
    }

    if (isKind(child, 'text')) {
      const text = String(child.node.getText?.() ?? '');
      const tokens = text.match(/\s+|[^\s]+/g) ?? [];
      let wordIndex = 0;

      for (const token of tokens) {
        const sourceStart = context.cursor.value;
        const sourceEnd = sourceStart + token.length;

        if (/^\s+$/.test(token)) {
          const breakRef: BreakRef = {
            kind: 'mtext-space',
            wrapper,
            childIndex,
            wordIndex,
          };

          emitRun<SpaceRun>(context.runs, {
            kind: 'space',
            text: ' ',
            wrapper,
            breakRef,
            sourceStart,
            sourceEnd,
          });
          context.cursor.value = sourceEnd;
          continue;
        }

        emitRun<TextRun>(context.runs, {
          kind: 'text',
          text: token,
          wrapper,
          childIndex,
          wordIndex,
          sourceStart,
          sourceEnd,
        });
        wordIndex += 1;
        context.cursor.value = sourceEnd;
      }
      continue;
    }

    if (isUnsupportedKind(child)) {
      warnUnsupported(
        context,
        child,
        'Unsupported mtext child wrapper encountered during flattening; using atomic run.'
      );
      emitAtomicMathRun(context, child);
      continue;
    }

    emitAtomicMathRun(context, child);
  }
}

function flattenWrapper(wrapper: AnyWrapper, context: FlattenContext) {
  if (!wrapper) {
    warnUnsupported(context, wrapper, 'Encountered null wrapper while flattening paragraph.');
    return;
  }

  if (isUnsupportedKind(wrapper)) {
    warnUnsupported(
      context,
      wrapper,
      'Unsupported wrapper structure encountered; using atomic run.'
    );
    emitAtomicMathRun(context, wrapper);
    return;
  }

  if (isKind(wrapper, 'mtext')) {
    emitTextPieces(wrapper, context);
    return;
  }

  if (isKind(wrapper, 'mspace') && wrapper.canBreak) {
    const linebreak = getMspaceLinebreak(wrapper);
    const sourceStart = context.cursor.value;
    const sourceEnd = sourceStart + 1;
    emitRun<SpaceRun>(context.runs, {
      kind: 'space',
      text: ' ',
      wrapper,
      breakRef: {
        kind: 'mspace',
        wrapper,
        linebreak,
        isForcedLineBreak: isForcedMspaceLinebreak(linebreak),
      },
      sourceStart,
      sourceEnd,
    });
    context.cursor.value = sourceEnd;
    return;
  }

  const kind = wrapperKind(wrapper);
  if (TRANSPARENT_KINDS.has(kind)) {
    for (const child of getChildren(wrapper)) {
      flattenWrapper(child, context);
    }
    return;
  }

  emitAtomicMathRun(context, wrapper);
}

export function flattenParagraph(wrapper: AnyWrapper): FlattenResult {
  const context: FlattenContext = {
    runs: [],
    errors: [],
    cursor: { value: 0 },
    unsupportedKinds: new Set<string>(),
  };

  flattenWrapper(wrapper, context);

  return {
    runs: normalizeForcedLineLeadingRuns(context.runs),
    errors: context.errors,
    canProceed: true,
    unsupportedKinds: [...context.unsupportedKinds],
  };
}
