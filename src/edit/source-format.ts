export type FormatTikzSourceOptions = {
  indentUnit?: string;
  collapseBlankLines?: boolean;
};

const DEFAULT_INDENT_UNIT = "  ";

const PATH_COMMAND_START_PATTERN = /^\\(?:path|draw|filldraw|fill|shadedraw|shade|clip|pattern|useasboundingbox|graph|node|coordinate|matrix)\b/;
const BEGIN_ENV_PATTERN = /\\begin\{(?:tikzpicture|scope)\}/g;
const END_ENV_PATTERN = /\\end\{(?:tikzpicture|scope)\}/g;

export function formatTikzSource(source: string, options: FormatTikzSourceOptions = {}): string {
  const indentUnit = options.indentUnit ?? DEFAULT_INDENT_UNIT;
  const collapseBlankLines = options.collapseBlankLines ?? true;

  const newline = preferredNewline(source);
  const hasTrailingNewline = source.endsWith("\n") || source.endsWith("\r");
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  let envDepth = 0;
  let optionDepth = 0;
  let braceDepth = 0;
  let inPathContinuation = false;
  const formatted: string[] = [];

  for (const line of lines) {
    const trimmedRight = trimTrailingWhitespace(line);
    const commentStart = findCommentStart(trimmedRight);
    const code = commentStart >= 0 ? trimmedRight.slice(0, commentStart) : trimmedRight;
    const trimmedCode = code.trim();
    const trimmedLine = trimmedRight.trimStart();
    const isBlankLine = trimmedLine.length === 0;

    let pathContinuationDepth = 0;
    if (inPathContinuation && optionDepth === 0 && braceDepth === 0) {
      pathContinuationDepth = 1;
    }

    const leadingCloseInfo = resolveLeadingCloserInfo(trimmedCode);
    const dedentForClosers =
      (leadingCloseInfo.hasLeadingEnvClose ? 1 : 0) +
      (leadingCloseInfo.hasLeadingOptionClose ? 1 : 0) +
      (leadingCloseInfo.hasLeadingBraceClose ? 1 : 0);

    const indentDepth = Math.max(
      0,
      envDepth + optionDepth + braceDepth + pathContinuationDepth - dedentForClosers
    );

    if (isBlankLine) {
      formatted.push("");
    } else {
      formatted.push(`${indentUnit.repeat(indentDepth)}${trimmedLine}`);
    }

    const beginCount = countMatches(code, BEGIN_ENV_PATTERN);
    const endCount = countMatches(code, END_ENV_PATTERN);
    envDepth = Math.max(0, envDepth + beginCount - endCount);

    if (leadingCloseInfo.hasLeadingOptionClose) {
      optionDepth = Math.max(0, optionDepth - 1);
    }
    if (leadingCloseInfo.hasLeadingBraceClose) {
      braceDepth = Math.max(0, braceDepth - 1);
    }
    if (trimmedCode.endsWith("[")) {
      optionDepth += 1;
    }
    if (trimmedCode.endsWith("{")) {
      braceDepth += 1;
    }

    if (PATH_COMMAND_START_PATTERN.test(trimmedCode)) {
      inPathContinuation = true;
    }
    if (inPathContinuation && trimmedCode.includes(";")) {
      inPathContinuation = false;
    }
  }

  const finalized = collapseBlankLines ? collapseBlankLineRuns(formatted) : formatted;
  let output = finalized.join(newline);
  if (hasTrailingNewline) {
    output += newline;
  }
  return output;
}

function preferredNewline(source: string): "\n" | "\r\n" {
  if (source.includes("\r\n")) {
    return "\r\n";
  }
  return "\n";
}

function trimTrailingWhitespace(input: string): string {
  return input.replace(/[ \t]+$/u, "");
}

function findCommentStart(line: string): number {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "%") {
      continue;
    }
    if (!isEscapedAt(line, index)) {
      return index;
    }
  }
  return -1;
}

function isEscapedAt(input: string, index: number): boolean {
  let backslashes = 0;
  let cursor = index - 1;
  while (cursor >= 0 && input[cursor] === "\\") {
    backslashes += 1;
    cursor -= 1;
  }
  return backslashes % 2 === 1;
}

function resolveLeadingCloserInfo(trimmedCode: string): {
  hasLeadingOptionClose: boolean;
  hasLeadingBraceClose: boolean;
  hasLeadingEnvClose: boolean;
} {
  const leadingClosers = trimmedCode.match(/^[\]\}]*/)?.[0] ?? "";
  const afterLeadingClosers = trimmedCode.slice(leadingClosers.length).trimStart();
  return {
    hasLeadingOptionClose: leadingClosers.includes("]"),
    hasLeadingBraceClose: leadingClosers.includes("}"),
    hasLeadingEnvClose: /^\\end\{(?:tikzpicture|scope)\}/.test(afterLeadingClosers)
  };
}

function countMatches(input: string, pattern: RegExp): number {
  const matcher = new RegExp(pattern.source, pattern.flags);
  let count = 0;
  let match = matcher.exec(input);
  while (match) {
    count += 1;
    match = matcher.exec(input);
  }
  return count;
}

function collapseBlankLineRuns(lines: readonly string[]): string[] {
  const collapsed: string[] = [];
  let sawContent = false;
  let pendingBlank = false;

  for (const line of lines) {
    if (line.trim().length === 0) {
      if (!sawContent) {
        continue;
      }
      pendingBlank = true;
      continue;
    }

    if (pendingBlank && collapsed.length > 0) {
      collapsed.push("");
    }
    collapsed.push(line);
    sawContent = true;
    pendingBlank = false;
  }

  return collapsed;
}
