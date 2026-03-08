import { describe, expect, it } from "vitest";
import {
  buildStandaloneLatexDocument,
  createStandaloneLatexExportArtifact,
  DEFAULT_STANDALONE_LATEX_EXPORT_FILE_NAME,
  normalizeStandaloneLatexExportFileName,
  STANDALONE_LATEX_EXPORT_MIME_TYPE
} from "../src/export/index.js";

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

  it("wraps bare source in a standalone latex document", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const document = buildStandaloneLatexDocument(source, ["patterns", "arrows.meta", "patterns"]);

    expect(document).toContain("\\documentclass{standalone}");
    expect(document).toContain("\\usepackage{tikz}");
    expect(document).toContain("\\usetikzlibrary{arrows.meta,patterns}");
    expect(document).toContain("\\begin{document}");
    expect(document).toContain("\\end{document}");
  });

  it("preserves document preamble and injects only missing libraries", () => {
    const source = String.raw`\documentclass{standalone}
\usepackage{tikz}
\usetikzlibrary{patterns}
\begin{document}
\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}
\end{document}
`;
    const document = buildStandaloneLatexDocument(source, ["patterns", "arrows.meta", "graphs"]);

    const usetikzMatches = [...document.matchAll(/\\usetikzlibrary\{([^}]*)\}/g)].map((match) => match[1]);
    expect(usetikzMatches).toEqual(["patterns", "arrows.meta,graphs"]);
    expect(document).toContain("\\begin{document}");
  });

  it("creates a standalone latex artifact", () => {
    const artifact = createStandaloneLatexExportArtifact({
      source: String.raw`\begin{tikzpicture}\draw (0,0)--(1,0);\end{tikzpicture}`,
      requiredLibraries: ["arrows.meta"],
      fileName: "preview"
    });

    expect(artifact.fileName).toBe("preview.tex");
    expect(artifact.mimeType).toBe(STANDALONE_LATEX_EXPORT_MIME_TYPE);
    expect(artifact.text).toContain("\\usetikzlibrary{arrows.meta}");
  });
});
