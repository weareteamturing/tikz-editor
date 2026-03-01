import { describe, expect, it } from "vitest";
import { formatTikzSource } from "../src/edit/source-format.js";

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
