import { forwardRef } from "react";
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
  managedImperatively?: boolean;
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

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderSourcePreview(target: HTMLElement, lines: readonly SourceLine[]): void {
  const html = lines
    .map((line) => {
      const tokens = line
        .map((token) => `<span class="sourceToken sourceToken--${token.kind}">${escapeHtml(token.text)}</span>`)
        .join("");
      return `<span class="sourceLine">${tokens}</span>`;
    })
    .join("");

  const previous = LAST_RENDERED_SOURCE_HTML.get(target);
  if (previous === html) {
    return;
  }

  LAST_RENDERED_SOURCE_HTML.set(target, html);
  target.innerHTML = html;
}

const LAST_RENDERED_SOURCE_HTML = new WeakMap<HTMLElement, string>();

export const SourcePreview = forwardRef<HTMLElement, SourcePreviewProps>(function SourcePreview(
  { lines, managedImperatively = false },
  ref
): ReactNode {
  return (
    <pre className="sourcePreview" aria-label="TikZ source preview">
      <code className="sourcePreviewCode" ref={ref}>
        {managedImperatively ? null : lines.map((line, lineIndex) => (
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
});
