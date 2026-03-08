const TRAILING_ESCAPE_DISCHARGE_SUFFIX = "phantom{}";
const MATH_MODE_NONE = "none";
const MATH_MODE_DOLLAR = "dollar";
const MATH_MODE_PAREN = "paren";

export function stabilizePrefixForMeasurement(prefix) {
  let stabilized = prefix;
  let stateSnapshot = scanTeXPrefixState(stabilized);

  if (stateSnapshot.trailingEscape) {
    stabilized += TRAILING_ESCAPE_DISCHARGE_SUFFIX;
    stateSnapshot = scanTeXPrefixState(stabilized);
  }

  if (stateSnapshot.braceDepth > 0) {
    stabilized += "}".repeat(stateSnapshot.braceDepth);
    stateSnapshot = scanTeXPrefixState(stabilized);
  }

  if (stateSnapshot.inMath && stateSnapshot.unclosedLeftCount > 0) {
    stabilized += "\\right.".repeat(stateSnapshot.unclosedLeftCount);
    stateSnapshot = scanTeXPrefixState(stabilized);
  }

  if (stateSnapshot.inMath && hasDanglingMathScriptOperator(stabilized)) {
    stabilized += "{}";
    stateSnapshot = scanTeXPrefixState(stabilized);
  }

  if (stateSnapshot.inMath) {
    if (stateSnapshot.trailingEscape) {
      stabilized += TRAILING_ESCAPE_DISCHARGE_SUFFIX;
    }
    stabilized += stateSnapshot.mathMode === MATH_MODE_PAREN ? "\\)" : "$";
  }

  return stabilized;
}

export function scanTeXPrefixState(text) {
  let braceDepth = 0;
  let mathMode = MATH_MODE_NONE;
  let unclosedLeftCount = 0;
  let trailingEscape = false;

  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);

    if (char === "\\") {
      const nextIndex = index + 1;
      if (nextIndex >= text.length) {
        trailingEscape = true;
        break;
      }

      const nextChar = text.charAt(nextIndex);
      if (nextChar === "(") {
        if (mathMode === MATH_MODE_NONE) {
          mathMode = MATH_MODE_PAREN;
        }
        index += 2;
        continue;
      }

      if (nextChar === ")") {
        if (mathMode === MATH_MODE_PAREN) {
          mathMode = MATH_MODE_NONE;
        }
        index += 2;
        continue;
      }

      if (/[A-Za-z]/.test(nextChar)) {
        let commandEnd = nextIndex + 1;
        while (commandEnd < text.length && /[A-Za-z]/.test(text.charAt(commandEnd))) {
          commandEnd += 1;
        }
        const command = text.slice(nextIndex, commandEnd);
        if (mathMode !== MATH_MODE_NONE && command === "left") {
          unclosedLeftCount += 1;
        } else if (mathMode !== MATH_MODE_NONE && command === "right") {
          unclosedLeftCount = Math.max(0, unclosedLeftCount - 1);
        }
        index = commandEnd;
        continue;
      }

      // Control symbol (e.g. \$, \{, \}, \_, \\): consume escaped char.
      index += 2;
      continue;
    }

    if (char === "$") {
      if (mathMode === MATH_MODE_NONE) {
        mathMode = MATH_MODE_DOLLAR;
      } else if (mathMode === MATH_MODE_DOLLAR) {
        mathMode = MATH_MODE_NONE;
      }
      index += 1;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
      index += 1;
      continue;
    }

    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      index += 1;
      continue;
    }

    index += 1;
  }

  return {
    inMath: mathMode !== MATH_MODE_NONE,
    mathMode,
    braceDepth,
    trailingEscape,
    unclosedLeftCount
  };
}

export function hasDanglingMathScriptOperator(text) {
  let index = text.length - 1;
  while (index >= 0 && /\s/.test(text.charAt(index))) {
    index -= 1;
  }
  if (index < 0) {
    return false;
  }

  const char = text.charAt(index);
  if (char !== "^" && char !== "_") {
    return false;
  }

  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text.charAt(cursor) === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 0;
}

export function seedPrefixWidthTable(sourceLength, totalWidthUnits) {
  const table = new Array(sourceLength + 1);
  table[0] = 0;
  table[sourceLength] = totalWidthUnits;
  return table;
}

export function finalizePrefixWidthTable(table, totalWidthUnits) {
  const lastIndex = table.length - 1;
  if (lastIndex < 0) {
    return [];
  }

  const boundedTotal = Number.isFinite(totalWidthUnits) && totalWidthUnits > 0 ? totalWidthUnits : 0;
  table[0] = 0;
  table[lastIndex] = boundedTotal;

  // Fill unknown measurements by local interpolation between nearest known prefixes.
  let index = 0;
  while (index < lastIndex) {
    if (Number.isFinite(table[index])) {
      index += 1;
      continue;
    }

    const gapStart = index - 1;
    let gapEnd = index;
    while (gapEnd <= lastIndex && !Number.isFinite(table[gapEnd])) {
      gapEnd += 1;
    }

    const leftIndex = Math.max(0, gapStart);
    const rightIndex = Math.min(lastIndex, gapEnd);
    const leftValue = Number.isFinite(table[leftIndex]) ? Number(table[leftIndex]) : 0;
    const rightValue = Number.isFinite(table[rightIndex]) ? Number(table[rightIndex]) : boundedTotal;
    const span = Math.max(1, rightIndex - leftIndex);

    for (let cursor = leftIndex + 1; cursor < rightIndex; cursor += 1) {
      const t = (cursor - leftIndex) / span;
      table[cursor] = leftValue + (rightValue - leftValue) * t;
    }

    index = rightIndex + 1;
  }

  let previous = 0;
  for (let cursor = 1; cursor < lastIndex; cursor += 1) {
    const raw = table[cursor];
    const normalized = Number.isFinite(raw) ? raw : boundedTotal * (cursor / Math.max(1, lastIndex));
    const clamped = clamp(normalized, previous, boundedTotal);
    table[cursor] = clamped;
    previous = clamped;
  }
  return table;
}

export function readPrefixUnitsFromTable(index, sourceLength, totalWidthUnits, table) {
  if (index <= 0 || sourceLength === 0) {
    return 0;
  }

  const normalizedIndex = normalizeIndex(index, sourceLength);
  if (Array.isArray(table) && table.length === sourceLength + 1) {
    const measured = table[normalizedIndex];
    if (Number.isFinite(measured)) {
      return measured;
    }
  }

  return totalWidthUnits * (normalizedIndex / sourceLength);
}

export function findNearestPrefixIndexFromTable(targetUnits, sourceLength, totalWidthUnits, table) {
  if (sourceLength === 0 || totalWidthUnits <= 0) {
    return 0;
  }

  const boundedTarget = clamp(targetUnits, 0, totalWidthUnits);
  if (!Array.isArray(table) || table.length !== sourceLength + 1) {
    return normalizeIndex(Math.round((boundedTarget / totalWidthUnits) * sourceLength), sourceLength);
  }

  let low = 0;
  let high = sourceLength;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const widthAtMid = Number(table[mid]) || 0;
    if (widthAtMid < boundedTarget) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const rightIndex = clamp(low, 0, sourceLength);
  const leftIndex = clamp(rightIndex - 1, 0, sourceLength);
  const leftDistance = Math.abs((Number(table[leftIndex]) || 0) - boundedTarget);
  const rightDistance = Math.abs((Number(table[rightIndex]) || totalWidthUnits) - boundedTarget);
  return leftDistance <= rightDistance ? leftIndex : rightIndex;
}

function normalizeIndex(value, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return clamp(Math.floor(value), 0, max);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
