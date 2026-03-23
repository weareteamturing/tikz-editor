import { describe, expect, it } from "vitest";
import {
  createStandaloneLatexExportArtifact,
  DEFAULT_STANDALONE_LATEX_EXPORT_FILE_NAME,
  normalizeStandaloneLatexExportFileName,
  STANDALONE_LATEX_EXPORT_MIME_TYPE
} from "../packages/core/src/export/index.js";

describe("standalone latex export helpers", () => {
  it("defaults to the standard export file name", () => {
    expect(normalizeStandaloneLatexExportFileName()).toBe(DEFAULT_STANDALONE_LATEX_EXPORT_FILE_NAME);
    expect(normalizeStandaloneLatexExportFileName("   ")).toBe(DEFAULT_STANDALONE_LATEX_EXPORT_FILE_NAME);
  });

  it("appends the tex extension when omitted", () => {
    expect(normalizeStandaloneLatexExportFileName("diagram")).toBe("diagram.tex");
    expect(normalizeStandaloneLatexExportFileName("  diagram  ")).toBe("diagram.tex");
  });

  it("preserves an existing tex extension", () => {
    expect(normalizeStandaloneLatexExportFileName("diagram.tex")).toBe("diagram.tex");
    expect(normalizeStandaloneLatexExportFileName("diagram.TEX")).toBe("diagram.TEX");
  });

  it("exports a standalone document and infers required libraries", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->] (0,0) -- (1,0);
\end{tikzpicture}`;
    const artifact = createStandaloneLatexExportArtifact({
      source,
      activeFigureId: "figure:0"
    });

    expect(artifact.mimeType).toBe(STANDALONE_LATEX_EXPORT_MIME_TYPE);
    expect(artifact.text).toContain("\\documentclass{standalone}");
    expect(artifact.text).toContain("\\usepackage{tikz}");
    expect(artifact.text).toContain("\\usetikzlibrary{arrows.meta}");
    expect(artifact.text).toContain("\\begin{tikzpicture}");
    expect(artifact.text).toContain("\\end{document}");
  });

  it("includes reachable macro definitions in the standalone output", () => {
    const source = String.raw`\def\edgeend{(1,0)}
\begin{tikzpicture}
  \draw (0,0) -- \edgeend;
\end{tikzpicture}`;
    const artifact = createStandaloneLatexExportArtifact({
      source,
      activeFigureId: "figure:0"
    });

    expect(artifact.text).toContain(String.raw`\def\edgeend{(1,0)}`);
    expect(artifact.text).toContain(String.raw`\draw (0,0) -- \edgeend;`);
  });

  it("creates a standalone latex artifact", () => {
    const artifact = createStandaloneLatexExportArtifact({
      source: String.raw`\begin{tikzpicture}\draw (0,0)--(1,0);\end{tikzpicture}`,
      activeFigureId: "figure:0",
      fileName: "preview"
    });

    expect(artifact.fileName).toBe("preview.tex");
    expect(artifact.mimeType).toBe(STANDALONE_LATEX_EXPORT_MIME_TYPE);
    expect(artifact.complete).toBe(true);
    expect(artifact.diagnostics).toEqual([]);
  });
});

