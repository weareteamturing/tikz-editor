import type { ReactNode } from "react";

export type SourceTokenKind =
  | "keyword"
  | "typeName"
  | "string"
  | "number"
  | "comment"
  | "punctuation"
  | "meta"
  | "text";

export type SourceToken = {
  kind: SourceTokenKind;
  text: string;
};

export type SourceLine = readonly SourceToken[];

export type SourcePreviewProps = {
  lines: readonly SourceLine[];
};

export function sourceLine(...tokens: SourceToken[]): SourceLine {
  return tokens;
}

export const sourceText = (text: string): SourceToken => ({ kind: "text", text });
export const sourceKeyword = (text: string): SourceToken => ({ kind: "keyword", text });
export const sourceTypeName = (text: string): SourceToken => ({ kind: "typeName", text });
export const sourceString = (text: string): SourceToken => ({ kind: "string", text });
export const sourceNumber = (text: string): SourceToken => ({ kind: "number", text });
export const sourceComment = (text: string): SourceToken => ({ kind: "comment", text });
export const sourcePunctuation = (text: string): SourceToken => ({ kind: "punctuation", text });
export const sourceMeta = (text: string): SourceToken => ({ kind: "meta", text });

export function formatTikzNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const nearestInteger = Math.round(rounded);
  if (Math.abs(rounded - nearestInteger) < 1e-9) {
    return String(nearestInteger);
  }
  const text = rounded.toFixed(1);
  return Object.is(rounded, -0) ? "0" : text;
}

export function SourcePreview({ lines }: SourcePreviewProps): ReactNode {
  return (
    <pre className="sourcePreview" aria-label="TikZ source preview">
      <code className="sourcePreviewCode">
        {lines.map((line, lineIndex) => (
          <span className="sourceLine" key={lineIndex}>
            {line.map((token, tokenIndex) => (
              <span className={`sourceToken sourceToken--${token.kind}`} key={`${lineIndex}-${tokenIndex}`}>
                {token.text}
              </span>
            ))}
          </span>
        ))}
      </code>
    </pre>
  );
}
