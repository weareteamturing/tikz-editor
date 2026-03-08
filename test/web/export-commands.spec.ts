import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";
import {
  canExportSvg,
  copySvgMarkup,
  copySvgText,
  exportSvgDownload,
  validateSvgMarkup
} from "../../packages/app/src/ui/export-commands.js";

const SOURCE = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

describe("export commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports svg export availability from snapshot svg result presence", () => {
    const rendered = renderTikzToSvg(SOURCE);
    expect(canExportSvg(rendered.svg)).toBe(true);
    expect(canExportSvg(null)).toBe(false);
  });

  it("downloads svg using a temporary anchor and object URL", async () => {
    const rendered = renderTikzToSvg(SOURCE);
    const createObjectURL = vi.fn(() => "blob:tikz-export");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const anchor: {
      href: string;
      download: string;
      style: { display: string };
      click: () => void;
      remove: () => void;
    } = {
      href: "",
      download: "",
      style: { display: "" },
      click,
      remove
    };

    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("document", {
      body: { appendChild },
      createElement: vi.fn((tag: string) => {
        if (tag !== "a") {
          throw new Error(`Unexpected element request: ${tag}`);
        }
        return anchor;
      })
    });

    const didDownload = await exportSvgDownload(rendered.svg, { fileName: "figure" });
    expect(didDownload).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe("figure.svg");
    expect(anchor.href).toBe("blob:tikz-export");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:tikz-export");
  });

  it("copies svg markup to the clipboard", async () => {
    const rendered = renderTikzToSvg(SOURCE);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copySvgMarkup(rendered.svg)).resolves.toBe(true);
    const copied = writeText.mock.calls[0]?.[0];
    expect(typeof copied).toBe("string");
    expect(copied).toContain("\n");
    expect(copied).not.toBe(rendered.svg.svg);
  });

  it("copies arbitrary svg text to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copySvgText("<svg xmlns=\"http://www.w3.org/2000/svg\" />")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("<svg xmlns=\"http://www.w3.org/2000/svg\" />");
  });

  it("soft-fails and warns when clipboard API is unavailable", async () => {
    const rendered = renderTikzToSvg(SOURCE);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("navigator", {});

    await expect(copySvgMarkup(rendered.svg)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("validates edited svg markup", () => {
    vi.stubGlobal("DOMParser", class {
      parseFromString(text: string) {
        if (text === "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>") {
          return {
            getElementsByTagName: () => [],
            documentElement: { nodeName: "svg" }
          };
        }
        if (text === "<div></div>") {
          return {
            getElementsByTagName: () => [],
            documentElement: { nodeName: "div" }
          };
        }
        return {
          getElementsByTagName: () => [{ textContent: "Unexpected close tag" }],
          documentElement: { nodeName: "svg" }
        };
      }
    });

    expect(validateSvgMarkup("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")).toEqual({ valid: true });
    expect(validateSvgMarkup("<svg><g></svg>")).toEqual({ valid: false, message: "Unexpected close tag" });
    expect(validateSvgMarkup("<div></div>")).toEqual({
      valid: false,
      message: "The document must contain a single <svg> root element."
    });
  });
});
