export type ParagraphAlignment =
  | 'ragged-right'
  | 'ragged-left'
  | 'center'
  | 'justified';

export const DEFAULT_PARAGRAPH_ALIGNMENT: ParagraphAlignment = 'ragged-right';

export interface AlignmentGlue {
  width: number;
  stretch: number;
  shrink: number;
}

export interface AlignmentProfile {
  alignment: ParagraphAlignment;
  interwordStretch: number;
  interwordShrink: number;
  leftskip: AlignmentGlue;
  rightskip: AlignmentGlue;
  parfillskip: AlignmentGlue;
  preventOverflow: boolean;
}

export function normalizeParagraphAlignment(
  value: unknown
): ParagraphAlignment {
  if (
    value === 'ragged-right' ||
    value === 'ragged-left' ||
    value === 'center' ||
    value === 'justified'
  ) {
    return value;
  }
  return DEFAULT_PARAGRAPH_ALIGNMENT;
}

export function buildAlignmentProfile(
  alignment: ParagraphAlignment,
  spaceWidth: number
): AlignmentProfile {
  const s = Math.max(spaceWidth, 0);

  if (alignment === 'ragged-left') {
    return {
      alignment,
      interwordStretch: 0,
      interwordShrink: 0,
      leftskip: { width: 0, stretch: 6 * s, shrink: 0 },
      rightskip: { width: 0, stretch: 0, shrink: 0 },
      parfillskip: { width: 0, stretch: 0, shrink: 0 },
      preventOverflow: true,
    };
  }

  if (alignment === 'justified') {
    return {
      alignment,
      interwordStretch: 0.5 * s,
      interwordShrink: s / 3,
      leftskip: { width: 0, stretch: 0, shrink: 0 },
      rightskip: { width: 0, stretch: 0, shrink: 0 },
      parfillskip: { width: 0, stretch: Number.POSITIVE_INFINITY, shrink: 0 },
      preventOverflow: false,
    };
  }

  if (alignment === 'center') {
    return {
      alignment,
      interwordStretch: 0,
      interwordShrink: 0,
      leftskip: { width: 0, stretch: 6 * s, shrink: 0 },
      rightskip: { width: 0, stretch: 6 * s, shrink: 0 },
      parfillskip: { width: 0, stretch: 0, shrink: 0 },
      preventOverflow: true,
    };
  }

  return {
    alignment: 'ragged-right',
    interwordStretch: 0,
    interwordShrink: 0,
    leftskip: { width: 0, stretch: 0, shrink: 0 },
    rightskip: { width: 0, stretch: 6 * s, shrink: 0 },
    parfillskip: { width: 0, stretch: Number.POSITIVE_INFINITY, shrink: 0 },
    preventOverflow: true,
  };
}
