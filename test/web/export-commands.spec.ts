import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTikzToSvg } from "../../src/render/index.js";
import { canExportSvg, copySvgMarkup, exportSvgDownload } from "../../web/src/ui/export-commands.js";

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

  it("soft-fails and warns when clipboard API is unavailable", async () => {
    const rendered = renderTikzToSvg(SOURCE);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("navigator", {});

    await expect(copySvgMarkup(rendered.svg)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
