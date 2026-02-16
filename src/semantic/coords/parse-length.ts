import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";

const UNIT_FACTORS: Record<string, number> = {
  pt: 1,
  cm: 28.4527559055,
  mm: 2.84527559055,
  in: 72.27,
  ex: 4.3,
  em: 10
};

export type ParsedQuantity = {
  kind: "scalar" | "length";
  value: number;
};

type Token =
  | {
      kind: "number";
      value: number;
      unit?: string;
    }
  | {
      kind: "ident";
      value: string;
    }
  | {
      kind: "op";
      value: "+" | "-" | "*" | "/" | "(" | ")";
    };

export function parseLength(input: string, defaultUnit: "cm" | "pt"): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const quantity = parseQuantityExpression(trimmed);
  if (!quantity) {
    return null;
  }

  if (quantity.kind === "length") {
    return quantity.value;
  }

  const unit = defaultUnit.toLowerCase();
  const factor = UNIT_FACTORS[unit];
  if (factor == null) {
    return null;
  }
  return quantity.value * factor;
}

export function parseQuantityExpression(input: string): ParsedQuantity | null {
  const tokenStream = tokenizeQuantityExpression(input);
  if (!tokenStream) {
    return null;
  }
  const tokens = tokenStream;

  let index = 0;

  const parseExpression = (): ParsedQuantity | null => parseAddSub();

  const parseAddSub = (): ParsedQuantity | null => {
    let left = parseMulDiv();
    if (!left) {
      return null;
    }

    while (true) {
      const operator = peekOperator("+", "-");
      if (!operator) {
        break;
      }
      index += 1;
      const right = parseMulDiv();
      if (!right) {
        return null;
      }
      left = addOrSubtractQuantities(left, right, operator);
      if (!left) {
        return null;
      }
    }

    return left;
  };

  const parseMulDiv = (): ParsedQuantity | null => {
    let left = parseUnary();
    if (!left) {
      return null;
    }

    while (true) {
      const operator = peekOperator("*", "/");
      if (!operator) {
        break;
      }
      index += 1;
      const right = parseUnary();
      if (!right) {
        return null;
      }
      left = operator === "*" ? multiplyQuantities(left, right) : divideQuantities(left, right);
      if (!left) {
        return null;
      }
    }

    return left;
  };

  const parseUnary = (): ParsedQuantity | null => {
    const operator = peekOperator("+", "-");
    if (!operator) {
      return parsePrimary();
    }

    index += 1;
    const value = parseUnary();
    if (!value) {
      return null;
    }

    if (operator === "+") {
      return value;
    }

    return {
      kind: value.kind,
      value: -value.value
    };
  };

  const parsePrimary = (): ParsedQuantity | null => {
    const token = tokens[index];
    if (!token) {
      return null;
    }

    if (token.kind === "number") {
      index += 1;
      if (!token.unit) {
        return { kind: "scalar", value: token.value };
      }
      const factor = UNIT_FACTORS[token.unit.toLowerCase()];
      if (factor == null) {
        return null;
      }
      return { kind: "length", value: token.value * factor };
    }

    if (token.kind === "ident") {
      const normalized = token.value.toLowerCase();
      index += 1;

      if (peekOperator("(")) {
        index += 1;
        const arg = parseExpression();
        if (!arg || !peekOperator(")")) {
          return null;
        }
        index += 1;
        if (arg.kind !== "scalar") {
          return null;
        }
        return evaluateScalarFunction(normalized, arg.value);
      }

      if (normalized === "pi") {
        return { kind: "scalar", value: Math.PI };
      }
      if (normalized === "e") {
        return { kind: "scalar", value: Math.E };
      }
      return null;
    }

    if (token.kind === "op" && token.value === "(") {
      index += 1;
      const nested = parseExpression();
      if (!nested || !peekOperator(")")) {
        return null;
      }
      index += 1;
      return nested;
    }

    return null;
  };

  const parsed = parseExpression();
  if (!parsed) {
    return null;
  }
  if (index !== tokens.length) {
    return null;
  }
  if (!Number.isFinite(parsed.value)) {
    return null;
  }

  return parsed;

  function peekOperator<T extends "+" | "-" | "*" | "/" | "(" | ")">(...operators: T[]): T | null {
    const token = tokens[index];
    if (!token || token.kind !== "op") {
      return null;
    }
    for (const operator of operators) {
      if (token.value === operator) {
        return operator;
      }
    }
    return null;
  }
}

function tokenizeQuantityExpression(input: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/" || char === "(" || char === ")") {
      tokens.push({ kind: "op", value: char });
      index += 1;
      continue;
    }

    if (isDigit(char) || char === ".") {
      const numberStart = index;
      let hasDigits = false;

      if (char === ".") {
        index += 1;
        while (index < input.length && isDigit(input[index])) {
          hasDigits = true;
          index += 1;
        }
        if (!hasDigits) {
          return null;
        }
      } else {
        while (index < input.length && isDigit(input[index])) {
          hasDigits = true;
          index += 1;
        }
        if (index < input.length && input[index] === ".") {
          index += 1;
          while (index < input.length && isDigit(input[index])) {
            hasDigits = true;
            index += 1;
          }
        }
      }

      if (!hasDigits) {
        return null;
      }

      const numberRaw = input.slice(numberStart, index);
      const value = Number(numberRaw);
      if (!Number.isFinite(value)) {
        return null;
      }

      let unitCursor = index;
      while (unitCursor < input.length && /\s/.test(input[unitCursor])) {
        unitCursor += 1;
      }

      const unitStart = unitCursor;
      while (unitCursor < input.length && /[A-Za-z]/.test(input[unitCursor])) {
        unitCursor += 1;
      }

      const unitRaw = input.slice(unitStart, unitCursor);
      if (unitRaw.length > 0) {
        index = unitCursor;
      }
      tokens.push({
        kind: "number",
        value,
        unit: unitRaw.length > 0 ? unitRaw : undefined
      });
      continue;
    }

    if (/[A-Za-z]/.test(char)) {
      const identStart = index;
      while (index < input.length && /[A-Za-z]/.test(input[index])) {
        index += 1;
      }
      tokens.push({
        kind: "ident",
        value: input.slice(identStart, index)
      });
      continue;
    }

    return null;
  }

  return tokens;
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function addOrSubtractQuantities(
  left: ParsedQuantity,
  right: ParsedQuantity,
  operator: "+" | "-"
): ParsedQuantity | null {
  if (left.kind !== right.kind) {
    return null;
  }
  return {
    kind: left.kind,
    value: operator === "+" ? left.value + right.value : left.value - right.value
  };
}

function multiplyQuantities(left: ParsedQuantity, right: ParsedQuantity): ParsedQuantity | null {
  if (left.kind === "scalar" && right.kind === "scalar") {
    return { kind: "scalar", value: left.value * right.value };
  }
  if (left.kind === "length" && right.kind === "scalar") {
    return { kind: "length", value: left.value * right.value };
  }
  if (left.kind === "scalar" && right.kind === "length") {
    return { kind: "length", value: left.value * right.value };
  }
  return null;
}

function divideQuantities(left: ParsedQuantity, right: ParsedQuantity): ParsedQuantity | null {
  if (Math.abs(right.value) <= 1e-12) {
    return null;
  }
  if (left.kind === "scalar" && right.kind === "scalar") {
    return { kind: "scalar", value: left.value / right.value };
  }
  if (left.kind === "length" && right.kind === "scalar") {
    return { kind: "length", value: left.value / right.value };
  }
  if (left.kind === "length" && right.kind === "length") {
    return { kind: "scalar", value: left.value / right.value };
  }
  return null;
}

function evaluateScalarFunction(name: string, value: number): ParsedQuantity | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (name === "sin") {
    return { kind: "scalar", value: Math.sin((value * Math.PI) / 180) };
  }
  if (name === "cos") {
    return { kind: "scalar", value: Math.cos((value * Math.PI) / 180) };
  }
  if (name === "tan") {
    return { kind: "scalar", value: Math.tan((value * Math.PI) / 180) };
  }
  if (name === "sqrt") {
    if (value < 0) {
      return null;
    }
    return { kind: "scalar", value: Math.sqrt(value) };
  }
  if (name === "abs") {
    return { kind: "scalar", value: Math.abs(value) };
  }
  return null;
}

export function parseCoordinateLike(raw: string): { x: string; y: string } | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    return null;
  }

  const inner = trimmed.slice(1, -1).trim();
  const parts = splitAllAtTopLevel(inner, ",").map((part) => part.trim());
  if (parts.length < 2) {
    return null;
  }
  return { x: parts[0], y: parts[1] };
}
