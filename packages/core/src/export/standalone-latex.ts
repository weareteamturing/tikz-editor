export const STANDALONE_LATEX_EXPORT_MIME_TYPE = "application/x-tex;charset=utf-8";
export const DEFAULT_STANDALONE_LATEX_EXPORT_FILE_NAME = "tikz-export.tex";

export type StandaloneLatexExportArtifact = {
  fileName: string;
  mimeType: "application/x-tex;charset=utf-8";
  text: string;
};

export type CreateStandaloneLatexExportArtifactOptions = {
  source: string;
  requiredLibraries?: readonly string[];
  fileName?: string;
};

export type StandaloneLatexDocumentOptions = {
  documentClassOptions?: readonly string[];
};

function normalizeLibraryNames(libraries: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const library of libraries) {
    const normalized = library.trim();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }
  return [...unique].sort((left, right) => left.localeCompare(right));
}

function extractLibrariesFromContent(content: string): string[] {
  return content
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function extractExistingTikzLibraries(source: string): Set<string> {
  const libraries = new Set<string>();
  const pattern = /\\usetikzlibrary\s*\{([^}]*)\}/g;
  for (const match of source.matchAll(pattern)) {
    const content = match[1] ?? "";
    for (const library of extractLibrariesFromContent(content)) {
      libraries.add(library);
    }
  }
  return libraries;
}

function findInjectionIndex(source: string): number {
  const useTikzLibraryRegex = /\\usetikzlibrary\s*\{[^}]*\}/g;
  const allMatches = [...source.matchAll(useTikzLibraryRegex)];
  if (allMatches.length > 0) {
    const last = allMatches[allMatches.length - 1];
    return (last.index ?? 0) + last[0].length;
  }

  const usePackageTikzMatch = /\\usepackage(?:\[[^\]]*\])?\s*\{[^}]*\btikz\b[^}]*\}/.exec(source);
  if (usePackageTikzMatch) {
    return (usePackageTikzMatch.index ?? 0) + usePackageTikzMatch[0].length;
  }

  const beginDocumentMatch = /\\begin\s*\{\s*document\s*\}/.exec(source);
  if (beginDocumentMatch) {
    return beginDocumentMatch.index ?? 0;
  }

  return source.length;
}

function hasDocumentWrapper(source: string): boolean {
  return /\\begin\s*\{\s*document\s*\}/.test(source) || /\\documentclass(?:\[[^\]]*\])?\s*\{[^}]+\}/.test(source);
}

export function normalizeStandaloneLatexExportFileName(fileName?: string): string {
  const candidate = fileName?.trim();
  if (!candidate) {
    return DEFAULT_STANDALONE_LATEX_EXPORT_FILE_NAME;
  }
  if (/\.tex$/i.test(candidate)) {
    return candidate;
  }
  return `${candidate}.tex`;
}

function normalizeDocumentClassOptions(options: readonly string[] = []): string[] {
  const unique = new Set<string>();
  for (const option of options) {
    const normalized = option.trim();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

export function buildStandaloneLatexDocument(
  source: string,
  requiredLibraries: readonly string[] = [],
  options: StandaloneLatexDocumentOptions = {}
): string {
  const normalizedLibraries = normalizeLibraryNames(requiredLibraries);
  if (hasDocumentWrapper(source)) {
    if (normalizedLibraries.length === 0) {
      return source;
    }

    const existing = extractExistingTikzLibraries(source);
    const missing = normalizedLibraries.filter((library) => !existing.has(library));
    if (missing.length === 0) {
      return source;
    }

    const injectionIndex = findInjectionIndex(source);
    const prefix = source.slice(0, injectionIndex);
    const suffix = source.slice(injectionIndex);
    const beforeNewline = prefix.endsWith("\n") ? "" : "\n";
    const afterNewline = suffix.startsWith("\n") || suffix.length === 0 ? "" : "\n";
    const injection = `${beforeNewline}\\usetikzlibrary{${missing.join(",")}}${afterNewline}`;
    return `${prefix}${injection}${suffix}`;
  }

  const classOptions = normalizeDocumentClassOptions(options.documentClassOptions);
  const classOptionsText = classOptions.length > 0 ? `[${classOptions.join(",")}]` : "";
  const lines = [
    `\\documentclass${classOptionsText}{standalone}`,
    "\\usepackage{tikz}"
  ];
  if (normalizedLibraries.length > 0) {
    lines.push(`\\usetikzlibrary{${normalizedLibraries.join(",")}}`);
  }
  lines.push("\\begin{document}");
  lines.push(source.trim());
  lines.push("\\end{document}");
  return `${lines.join("\n")}\n`;
}

export function createStandaloneLatexExportArtifact(
  options: CreateStandaloneLatexExportArtifactOptions
): StandaloneLatexExportArtifact {
  const requiredLibraries = options.requiredLibraries ?? [];
  return {
    fileName: normalizeStandaloneLatexExportFileName(options.fileName),
    mimeType: STANDALONE_LATEX_EXPORT_MIME_TYPE,
    text: buildStandaloneLatexDocument(options.source, requiredLibraries)
  };
}
