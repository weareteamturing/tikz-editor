import type { ForeachIterationBinding } from "./types.js";

const CONTROL_SEQUENCE_REGEX = /\\[A-Za-z@]+/g;

export function substituteForeachBindings(input: string, bindings: ForeachIterationBinding): string {
  if (input.length === 0 || Object.keys(bindings).length === 0) {
    return input;
  }

  return input.replace(CONTROL_SEQUENCE_REGEX, (match) => {
    const value = bindings[match];
    if (value == null) {
      return match;
    }
    return value;
  });
}
