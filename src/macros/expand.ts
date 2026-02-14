const CONTROL_SEQUENCE_REGEX = /\\[A-Za-z@]+/g;
const LETTER_HEAD_REGEX = /^[A-Za-z@]/;
const CONTROL_WORD_TAIL_REGEX = /\\[A-Za-z@]+$/;
const LETTER_CHAR_REGEX = /[A-Za-z@]/;

export type MacroExpansionOptions = {
  maxDepth?: number;
};

export function expandMacroBindings(
  input: string,
  bindings: ReadonlyMap<string, string>,
  opts: MacroExpansionOptions = {}
): string {
  if (input.length === 0 || bindings.size === 0) {
    return input;
  }

  const maxDepth = Math.max(1, opts.maxDepth ?? 24);
  let current = input;
  const seen = new Set<string>([current]);

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next = substituteSinglePass(current, bindings);
    if (next === current) {
      return next;
    }
    if (seen.has(next)) {
      return next;
    }

    seen.add(next);
    current = next;
  }

  return current;
}

export function isControlSequenceToken(raw: string): boolean {
  return /^\\[A-Za-z@]+$/.test(raw.trim());
}

function substituteSinglePass(input: string, bindings: ReadonlyMap<string, string>): string {
  let output = "";
  let cursor = 0;
  CONTROL_SEQUENCE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null = CONTROL_SEQUENCE_REGEX.exec(input);
  while (match) {
    const macroName = match[0];
    const matchStart = match.index;
    const matchEnd = matchStart + macroName.length;
    output += input.slice(cursor, matchStart);

    const value = bindings.get(macroName);
    if (value == null) {
      output += macroName;
    } else {
      if (requiresLeadingBoundary(output, value)) {
        output += "{}";
      }
      output += value;
      const nextChar = input[matchEnd] ?? "";
      if (requiresTrailingBoundary(value, nextChar)) {
        output += "{}";
      }
    }

    cursor = matchEnd;
    match = CONTROL_SEQUENCE_REGEX.exec(input);
  }

  output += input.slice(cursor);
  return output;
}

function requiresLeadingBoundary(outputSoFar: string, replacement: string): boolean {
  return LETTER_HEAD_REGEX.test(replacement) && CONTROL_WORD_TAIL_REGEX.test(outputSoFar);
}

function requiresTrailingBoundary(replacement: string, nextChar: string): boolean {
  return nextChar.length > 0 && LETTER_CHAR_REGEX.test(nextChar) && CONTROL_WORD_TAIL_REGEX.test(replacement);
}
