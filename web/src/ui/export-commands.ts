import { createSvgExportArtifact } from "tikz-editor/export/index";
import { serializeSvgModelAsync, type EmitSvgResult } from "tikz-editor/svg/index";

export function canExportSvg(svgResult: EmitSvgResult | null): svgResult is EmitSvgResult {
  return svgResult != null;
}

export async function exportSvgDownload(
  svgResult: EmitSvgResult,
  options: { fileName?: string } = {}
): Promise<boolean> {
  if (typeof document === "undefined" || typeof Blob === "undefined") {
    console.warn("[tikz-editor] SVG export download is unavailable in this runtime.");
    return false;
  }
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
    console.warn("[tikz-editor] SVG export download requires URL.createObjectURL support.");
    return false;
  }
  if (!document.body) {
    console.warn("[tikz-editor] SVG export download requires document.body.");
    return false;
  }

  const text = await serializePrettySvgForExport(svgResult);
  const artifact = createSvgExportArtifact({
    svg: text,
    fileName: options.fileName
  });
  const blob = new Blob([artifact.text], { type: artifact.mimeType });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = artifact.fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function copySvgMarkup(svgResult: EmitSvgResult): Promise<boolean> {
  if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
    console.warn("[tikz-editor] Clipboard API is unavailable; could not copy SVG.");
    return false;
  }

  const text = await serializePrettySvgForExport(svgResult);
  const artifact = createSvgExportArtifact({ svg: text });
  try {
    await navigator.clipboard.writeText(artifact.text);
    return true;
  } catch (error) {
    console.warn("[tikz-editor] Failed to copy SVG to clipboard.", error);
    return false;
  }
}

async function serializePrettySvgForExport(svgResult: EmitSvgResult): Promise<string> {
  try {
    return await serializeSvgModelAsync(svgResult.model, {
      includeXmlns: true,
      pretty: true
    });
  } catch (error) {
    console.warn("[tikz-editor] Failed to pretty-format SVG; using compact SVG output.", error);
    return svgResult.svg;
  }
}
