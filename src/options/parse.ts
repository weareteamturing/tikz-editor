import type { OptionEntry, OptionListAst } from "./types.js";

export function parseOptionListRaw(raw: string, absoluteFrom = 0): OptionListAst {
  const normalized = raw.trim();
  const openIndex = normalized.indexOf("[");
  const closeIndex = findOptionCloseIndex(normalized);

  const innerFrom = openIndex >= 0 ? openIndex + 1 : 0;
  const innerTo = closeIndex >= 0 ? closeIndex : normalized.length;
  const inner = normalized.slice(innerFrom, innerTo);
  const maskedInner = maskLineComments(inner);

  const entries = splitTopLevel(maskedInner, ",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => classifyOptionToken(token, maskedInner, absoluteFrom + innerFrom));

  return {
    span: {
      from: absoluteFrom,
      to: absoluteFrom + normalized.length
    },
    raw: normalized,
    entries
  };
}

function maskLineComments(input: string): string {
  let masked = "";
  let inComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inComment) {
      if (char === "\n" || char === "\r") {
        inComment = false;
        masked += char;
      } else {
        masked += " ";
      }
      continue;
    }

    if (char === "%" && input[i - 1] !== "\\") {
      inComment = true;
      masked += " ";
      continue;
    }

    masked += char;
  }

  return masked;
}

function classifyOptionToken(token: string, fullRaw: string, absoluteFrom: number): OptionEntry {
  const tokenIndex = fullRaw.indexOf(token);
  const span = {
    from: absoluteFrom + Math.max(0, tokenIndex),
    to: absoluteFrom + Math.max(0, tokenIndex) + token.length
  };

  const separator = findTopLevelSeparator(token, "=");
  if (separator >= 0) {
    const key = token.slice(0, separator).trim().toLowerCase();
    const valueRaw = token.slice(separator + 1).trim();
    if (key.length === 0) {
      return { kind: "unknown", span, raw: token };
    }

    return {
      kind: "kv",
      key,
      valueRaw,
      span,
      raw: token
    };
  }

  if (/^(<-|->|<->|\|-\||[A-Za-z][A-Za-z0-9 -]*)$/.test(token) || looksLikeArrowSpecification(token)) {
    return {
      kind: "flag",
      key: token.trim().toLowerCase(),
      span,
      raw: token
    };
  }

  return {
    kind: "unknown",
    span,
    raw: token
  };
}

function looksLikeArrowSpecification(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed.length === 0 || !trimmed.includes("-")) {
    return false;
  }

  if (findTopLevelSeparator(trimmed, "-") < 0) {
    return false;
  }

  const hasArrowSyntax = /[<>\|\{\}\[\]]/.test(trimmed);
  const hasKnownArrowName = /\b(stealth|latex|triangle|bar|hooks|to|implies|rightarrow)\b/i.test(trimmed);
  if (!hasArrowSyntax && !hasKnownArrowName) {
    return false;
  }

  return /^[A-Za-z0-9<>\-\|\{\}\[\].' ]+$/.test(trimmed);
}

function findOptionCloseIndex(raw: string): number {
  if (!raw.includes("[")) {
    return raw.length;
  }

  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === "[") {
      depth += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return raw.length;
}

function findTopLevelSeparator(input: string, separator: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === separator && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return i;
    }
  }

  return -1;
}

export function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let cursor = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === separator && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      parts.push(input.slice(cursor, i));
      cursor = i + 1;
    }
  }

  parts.push(input.slice(cursor));
  return parts;
}
