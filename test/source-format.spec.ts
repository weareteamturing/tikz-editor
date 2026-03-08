import { describe, expect, it } from "vitest";
import { formatTikzSource } from "../packages/core/src/edit/source-format.js";

describe("formatTikzSource", () => {
  it("reindents nested scope blocks with 2-space indentation", () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}
\draw (0,0) -- (1,1);
\end{scope}
\end{tikzpicture}`;

    const formatted = formatTikzSource(source);
    expect(formatted).toBe(String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,1);
  \end{scope}
\end{tikzpicture}`);
  });

  it("keeps multiline option blocks and closing bracket indentation coherent", () => {
    const source = String.raw`\begin{tikzpicture}
\draw[
thick, % comment
blue
]
(0,0) -- (1,1);
\end{tikzpicture}`;

    const formatted = formatTikzSource(source);
    expect(formatted).toBe(String.raw`\begin{tikzpicture}
  \draw[
    thick, % comment
    blue
  ]
    (0,0) -- (1,1);
\end{tikzpicture}`);
  });

  it("indents multiline path continuations until semicolon", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0)
-- (1,1)
-- (2,2);
\end{tikzpicture}`;

    const formatted = formatTikzSource(source);
    expect(formatted).toBe(String.raw`\begin{tikzpicture}
  \draw (0,0)
    -- (1,1)
    -- (2,2);
\end{tikzpicture}`);
  });

  it("ignores escaped percent markers while preserving trailing comments", () => {
    const source = String.raw`\begin{tikzpicture}
% a comment
\node at (0,0) {100\%}; % trailing
\end{tikzpicture}`;

    const formatted = formatTikzSource(source);
    expect(formatted).toBe(String.raw`\begin{tikzpicture}
  % a comment
  \node at (0,0) {100\%}; % trailing
\end{tikzpicture}`);
  });

  it("collapses blank-line runs and trims leading/trailing blank lines", () => {
    const source = `\n\n\\begin{tikzpicture}\n\n\\draw (0,0) -- (1,1);\n\n\n\\draw (0,1) -- (1,2);\n\n\\end{tikzpicture}\n\n`;
    const formatted = formatTikzSource(source);
    expect(formatted).toBe(`\\begin{tikzpicture}\n\n  \\draw (0,0) -- (1,1);\n\n  \\draw (0,1) -- (1,2);\n\n\\end{tikzpicture}\n`);
  });

  it("preserves CRLF newline style and trailing newline", () => {
    const source = "\\begin{tikzpicture}\r\n\\draw (0,0)\r\n-- (1,1);\r\n\\end{tikzpicture}\r\n";
    const formatted = formatTikzSource(source);
    expect(formatted).toBe("\\begin{tikzpicture}\r\n  \\draw (0,0)\r\n    -- (1,1);\r\n\\end{tikzpicture}\r\n");
    expect(formatted.includes("\r\n")).toBe(true);
    expect(formatted.endsWith("\r\n")).toBe(true);
  });

  it("reflows long option lists into one entry per line when they exceed max line length", () => {
    const source = String.raw`\begin{tikzpicture}
\draw[draw=red, line width=2pt, rounded corners=4pt, fill=blue!10] (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const formatted = formatTikzSource(source, { maxLineLength: 60 });
    expect(formatted).toBe(String.raw`\begin{tikzpicture}
  \draw[
    draw=red,
    line width=2pt,
    rounded corners=4pt,
    fill=blue!10
  ] (0,0) rectangle (2,1);
\end{tikzpicture}`);
  });

  it("keeps short option lists inline when they are under the max line length", () => {
    const source = String.raw`\begin{tikzpicture}
\draw[draw=red, fill=blue] (0,0) -- (1,1);
\end{tikzpicture}`;

    const formatted = formatTikzSource(source, { maxLineLength: 100 });
    expect(formatted).toBe(String.raw`\begin{tikzpicture}
  \draw[draw=red, fill=blue] (0,0) -- (1,1);
\end{tikzpicture}`);
  });

  it("normalizes top-level comma spacing in inline option lists", () => {
    const source = String.raw`\begin{tikzpicture}
\node[draw=red, shape=circle, fill=purple!10,node font=\ttfamily] (C) at (0, 1.5) {C};
\end{tikzpicture}`;

    const formatted = formatTikzSource(source, { maxLineLength: 200 });
    expect(formatted).toBe(String.raw`\begin{tikzpicture}
  \node[draw=red, shape=circle, fill=purple!10, node font=\ttfamily] (C) at (0, 1.5) {C};
\end{tikzpicture}`);
  });

  it("normalizes spaces around top-level equals in inline option lists", () => {
    const source = String.raw`\begin{tikzpicture}
\node[draw = red, shape = circle, fill=purple!10, node font = \ttfamily] (C) at (0, 1.5) {C};
\end{tikzpicture}`;

    const formatted = formatTikzSource(source, { maxLineLength: 200 });
    expect(formatted).toBe(String.raw`\begin{tikzpicture}
  \node[draw=red, shape=circle, fill=purple!10, node font=\ttfamily] (C) at (0, 1.5) {C};
\end{tikzpicture}`);
  });

  it("honors disabled long-option reflow", () => {
    const source = String.raw`\begin{tikzpicture}
\draw[draw=red, line width=2pt, rounded corners=4pt, fill=blue!10] (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const formatted = formatTikzSource(source, {
      reflowLongOptionLists: false,
      maxLineLength: 60
    });
    expect(formatted).toBe(String.raw`\begin{tikzpicture}
  \draw[draw=red, line width=2pt, rounded corners=4pt, fill=blue!10] (0,0) rectangle (2,1);
\end{tikzpicture}`);
  });

  it("does not reflow option lists containing comments", () => {
    const source = String.raw`\begin{tikzpicture}
\draw[draw=red, % keep this
line width=2pt, fill=blue] (0,0) -- (1,1);
\end{tikzpicture}`;

    const formatted = formatTikzSource(source, { maxLineLength: 30 });
    expect(formatted).toBe(String.raw`\begin{tikzpicture}
  \draw[draw=red, % keep this
    line width=2pt, fill=blue] (0,0) -- (1,1);
\end{tikzpicture}`);
  });

  it("reflows long option lists while preserving CRLF newline style", () => {
    const source =
      "\\begin{tikzpicture}\r\n\\draw[draw=red, line width=2pt, rounded corners=4pt, fill=blue!10] (0,0) rectangle (2,1);\r\n\\end{tikzpicture}\r\n";
    const formatted = formatTikzSource(source, { maxLineLength: 60 });
    expect(formatted).toBe(
      "\\begin{tikzpicture}\r\n  \\draw[\r\n    draw=red,\r\n    line width=2pt,\r\n    rounded corners=4pt,\r\n    fill=blue!10\r\n  ] (0,0) rectangle (2,1);\r\n\\end{tikzpicture}\r\n"
    );
    expect(formatted.includes("\r\n")).toBe(true);
  });

  it("is idempotent when reflowing long option lists", () => {
    const source = String.raw`\begin{tikzpicture}
\draw[draw=red, line width=2pt, rounded corners=4pt, fill=blue!10] (0,0) rectangle (2,1);
\end{tikzpicture}`;
    const once = formatTikzSource(source, { maxLineLength: 60 });
    const twice = formatTikzSource(once, { maxLineLength: 60 });
    expect(twice).toBe(once);
  });

  it("is idempotent", () => {
    const source = String.raw`\begin{tikzpicture}
\draw[
thick,
blue
]
(0,0) -- (1,1);
\end{tikzpicture}`;
    const once = formatTikzSource(source);
    const twice = formatTikzSource(once);
    expect(twice).toBe(once);
  });
});
