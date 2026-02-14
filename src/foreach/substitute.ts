import type { ForeachIterationBinding } from "./types.js";

const CONTROL_SEQUENCE_REGEX = /\\[A-Za-z@]+/g;
const LETTER_HEAD_REGEX = /^[A-Za-z@]/;
const CONTROL_WORD_TAIL_REGEX = /\\[A-Za-z@]+$/;
const LETTER_CHAR_REGEX = /[A-Za-z@]/;

export function substituteForeachBindings(input: string, bindings: ForeachIterationBinding): string {
  if (input.length === 0 || Object.keys(bindings).length === 0) {
    return input;
  }

  let output = "";
  let cursor = 0;
  CONTROL_SEQUENCE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null = CONTROL_SEQUENCE_REGEX.exec(input);
  while (match) {
    const raw = match[0];
    const matchStart = match.index;
    const matchEnd = matchStart + raw.length;

    output += input.slice(cursor, matchStart);

    const value = bindings[raw];
    if (value == null) {
      output += raw;
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
