export type AnyWrapper = any;

export type BreakRef =
  | {
      kind: 'mtext-space';
      wrapper: AnyWrapper;
      childIndex: number;
      wordIndex: number;
    }
  | {
      kind: 'mspace';
      wrapper: AnyWrapper;
      linebreak?: string;
      isForcedLineBreak?: boolean;
      lineLeading?: string;
      lineLeadingTrim?: {
        wrapper: AnyWrapper;
        childIndex: number;
        wordIndex: number;
        consumed: number;
      };
    };

interface BaseRun {
  runIndex: number;
  sourceStart: number;
  sourceEnd: number;
}

export interface TextRun extends BaseRun {
  kind: 'text';
  text: string;
  wrapper: AnyWrapper;
  childIndex: number;
  wordIndex: number;
}

export interface SpaceRun extends BaseRun {
  kind: 'space';
  text: ' ';
  breakRef: BreakRef;
  wrapper: AnyWrapper;
}

export interface MathRun extends BaseRun {
  kind: 'math';
  wrapper: AnyWrapper;
}

export type ParagraphRun = TextRun | SpaceRun | MathRun;

export interface FlattenResult {
  runs: ParagraphRun[];
  errors: string[];
  canProceed: boolean;
  unsupportedKinds: string[];
}

export interface GreedyLine {
  lineIndex: number;
  startRun: number;
  startTextOffset: number;
  endRun: number;
  endTextOffset: number | null;
  width: number;
  targetWidth?: number;
  lineNaturalWidth?: number;
  glueSetRatio?: number;
  badness?: number;
  spaceCount?: number;
  spaceDeltaPerGap?: number;
  xOffset?: number;
  break: BreakDecision | null;
}

export interface BreakDecision {
  kind: 'space' | 'hyphen' | 'forced';
  runIndex: number;
  sourceOffset: number;
  visibleHyphen: boolean;
  lineLeading?: string;
  hyphenSource?: 'automatic' | 'explicit';
  splitOffset?: number;
  flagged?: boolean;
}

export interface GreedyResult {
  lines: GreedyLine[];
  errors: string[];
}
