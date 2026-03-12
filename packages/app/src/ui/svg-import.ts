import { svgToTikz } from "svg2tikz";
import { toTikzFromClipboard } from "keynote-clipboard";
import type { DocumentFileRef } from "../store/types.js";

type OpenedTextFile = {
  source: string;
  fileRef: DocumentFileRef | null;
};

type ResolveOpenedFileOptions = {
  requireSvg?: boolean;
};

export type ResolveOpenedFileResult =
  | { kind: "success"; source: string; title: string; fileRef: DocumentFileRef | null; importedFromSvg: boolean }
  | { kind: "failure"; message: string };

export type SvgScopeSnippetResult =
  | { kind: "success"; snippet: string; body: string; tikzSource: string }
  | { kind: "failure"; message: string };

export type KeynoteScopeSnippetResult = SvgScopeSnippetResult;

const SVG_XML_RE = /<svg[\s>]/i;

function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/u, "");
}

function suggestedTexNameFromName(name: string): string {
  const base = stripExtension(name).trim();
  return `${base.length > 0 ? base : "imported-svg"}.tex`;
}

function titleFromRef(fileRef: DocumentFileRef | null): string {
  return fileRef?.name ?? "Opened document";
}

export function detectSvgText(source: string, name?: string | null): boolean {
  const trimmedName = name?.trim().toLowerCase() ?? "";
  if (trimmedName.endsWith(".svg")) {
    return true;
  }
  const head = source.slice(0, 2048);
  return SVG_XML_RE.test(head);
}

export function extractTikzPictureBody(tikzSource: string): string {
  const beginToken = "\\begin{tikzpicture}";
  const endToken = "\\end{tikzpicture}";
  const beginIndex = tikzSource.indexOf(beginToken);
  const endIndex = tikzSource.lastIndexOf(endToken);
  if (beginIndex < 0 || endIndex < 0 || endIndex <= beginIndex) {
    return tikzSource.trim();
  }
  const beginLineEnd = tikzSource.indexOf("\n", beginIndex);
  if (beginLineEnd < 0 || beginLineEnd >= endIndex) {
    return "";
  }
  const rawBody = tikzSource.slice(beginLineEnd + 1, endIndex);
  return rawBody
    .replace(/^\n+/u, "")
    .replace(/\s+$/u, "");
}

function convertSvgToTikzSource(svgSource: string): string {
  return svgToTikz(svgSource, { standalone: false });
}

function toImportedFileRef(name: string): DocumentFileRef {
  return {
    kind: "virtual",
    name: suggestedTexNameFromName(name)
  };
}

function resolveOpenedSvgAsDocument(opened: OpenedTextFile): ResolveOpenedFileResult {
  const originalName = opened.fileRef?.name ?? "imported.svg";
  try {
    const converted = convertSvgToTikzSource(opened.source);
    const suggestedFileRef = toImportedFileRef(originalName);
    return {
      kind: "success",
      source: converted,
      title: suggestedFileRef.name,
      fileRef: suggestedFileRef,
      importedFromSvg: true
    };
  } catch (error) {
    return {
      kind: "failure",
      message: `SVG import failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export function resolveOpenedFileForDocument(
  opened: OpenedTextFile,
  options: ResolveOpenedFileOptions = {}
): ResolveOpenedFileResult {
  const isSvg = detectSvgText(opened.source, opened.fileRef?.name);
  if (isSvg) {
    return resolveOpenedSvgAsDocument(opened);
  }
  if (options.requireSvg) {
    return { kind: "failure", message: "Selected file is not an SVG document." };
  }
  return {
    kind: "success",
    source: opened.source,
    title: titleFromRef(opened.fileRef),
    fileRef: opened.fileRef,
    importedFromSvg: false
  };
}

export function buildScopeWrappedSnippet(body: string, options: { scale?: number } = {}): string {
  const normalizedBody = body
    .replace(/\r\n?/g, "\n")
    .replace(/^\n+/u, "")
    .replace(/\s+$/u, "");
  const scale = options.scale;
  const scaleOption = typeof scale === "number" && Number.isFinite(scale) ? `[scale=${scale}]` : "";
  return normalizedBody.length > 0
    ? `\\begin{scope}${scaleOption}\n${normalizedBody}\n\\end{scope}`
    : `\\begin{scope}${scaleOption}\n\\end{scope}`;
}

export function convertSvgToScopeSnippet(svgSource: string): SvgScopeSnippetResult {
  try {
    const converted = convertSvgToTikzSource(svgSource);
    const body = extractTikzPictureBody(converted);
    return {
      kind: "success",
      snippet: buildScopeWrappedSnippet(body),
      body,
      tikzSource: converted
    };
  } catch (error) {
    return {
      kind: "failure",
      message: `SVG import failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export function convertKeynoteClipboardToScopeSnippet(rawClipboardText: string): KeynoteScopeSnippetResult {
  try {
    const converted = toTikzFromClipboard(rawClipboardText);
    const tikzSource = converted.tikz;
    const body = extractTikzPictureBody(tikzSource);
    return {
      kind: "success",
      snippet: buildScopeWrappedSnippet(body),
      body,
      tikzSource
    };
  } catch (error) {
    return {
      kind: "failure",
      message: `Keynote import failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export function findSvgFileInDataTransfer(dataTransfer: DataTransfer | null): File | null {
  if (!dataTransfer) {
    return null;
  }

  for (const file of Array.from(dataTransfer.files ?? [])) {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    if (type === "image/svg+xml" || name.endsWith(".svg")) {
      return file;
    }
  }

  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== "file") {
      continue;
    }
    const type = item.type.toLowerCase();
    if (type !== "image/svg+xml" && type !== "text/xml" && type !== "application/xml") {
      continue;
    }
    const file = item.getAsFile();
    if (!file) {
      continue;
    }
    const name = file.name.toLowerCase();
    if (type === "image/svg+xml" || name.endsWith(".svg")) {
      return file;
    }
  }

  return null;
}

export function dataTransferHasFilePayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }
  if ((dataTransfer.files?.length ?? 0) > 0) {
    return true;
  }
  if ((dataTransfer.items?.length ?? 0) > 0) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === "file") {
        return true;
      }
    }
  }
  return Array.from(dataTransfer.types ?? []).includes("Files");
}
