import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import type { PlatformLatex } from "../platform/types";
import css from "./TikzJaxModal.module.css";

const TIKZJAX_FONTS_CSS = "https://cdn.jsdelivr.net/npm/@drgrice1/tikzjax@1.0.0-beta24/dist/fonts.css";
const TIKZJAX_JS = "https://cdn.jsdelivr.net/npm/@drgrice1/tikzjax@1.0.0-beta24/dist/tikzjax.js";


type LibState = "idle" | "loading" | "loaded" | "error";

let _libState: LibState = "idle";
let _libPromise: Promise<void> | null = null;

function ensureTikzJaxLoaded(): Promise<void> {
  if (_libState === "loaded") return Promise.resolve();
  if (_libPromise) return _libPromise;

  _libState = "loading";
  _libPromise = new Promise<void>((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = TIKZJAX_FONTS_CSS;
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = TIKZJAX_JS;
    script.onload = () => {
      _libState = "loaded";
      resolve();
    };
    script.onerror = () => {
      _libState = "idle";
      _libPromise = null;
      reject(new Error("Failed to load TikZJax from CDN"));
    };
    document.head.appendChild(script);
  });

  return _libPromise;
}

type Phase =
  | "checking-native"
  | "compiling-native"
  | "native-error"
  | "loading-lib"
  | "lib-error"
  | "rendering"
  | "done";

type TikzJaxModalProps = {
  source: string;
  onClose: () => void;
  latex?: PlatformLatex;
};

export function TikzJaxModal({ source, onClose, latex }: TikzJaxModalProps) {
  const [phase, setPhase] = useState<Phase>(latex ? "checking-native" : "loading-lib");
  const [nativeError, setNativeError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);

  // Try native LaTeX compilation if available
  useEffect(() => {
    if (phase !== "checking-native" || !latex) return;
    let cancelled = false;
    latex.checkAvailable().then((available) => {
      if (cancelled) return;
      if (!available) {
        setPhase("loading-lib");
        return;
      }
      setPhase("compiling-native");
      return latex.compileTikzToSvg(source).then((svg) => {
        if (cancelled) return;
        const output = outputRef.current;
        if (output) {
          output.innerHTML = svg;
          const svgEl = output.querySelector("svg");
          if (svgEl) {
            svgEl.removeAttribute("width");
            svgEl.removeAttribute("height");
          }
        }
        setPhase("done");
      });
    }).catch((err) => {
      if (cancelled) return;
      setNativeError(String(err));
      setPhase("native-error");
    });
    return () => { cancelled = true; };
  }, [phase, latex, source]);

  // TikZJax fallback path
  useEffect(() => {
    if (phase !== "loading-lib") return;
    ensureTikzJaxLoaded().then(
      () => setPhase("rendering"),
      () => setPhase("lib-error")
    );
  }, [phase]);

  // Trigger TikZJax rendering once the library is ready
  useEffect(() => {
    if (phase !== "rendering") return;
    const output = outputRef.current;
    if (!output) return;

    output.innerHTML = "";

    const tikzScript = document.createElement("script");
    tikzScript.type = "text/tikz";
    tikzScript.textContent = source;

    const container = document.createElement("div");
    container.appendChild(tikzScript);
    output.appendChild(container);

    const onFinished = (e: Event) => {
      if (output.contains(e.target as Node)) {
        const svg = output.querySelector("svg");
        if (svg) {
          svg.removeAttribute("width");
          svg.removeAttribute("height");
        }
        setPhase("done");
        document.removeEventListener("tikzjax-load-finished", onFinished);
      }
    };
    document.addEventListener("tikzjax-load-finished", onFinished);

    return () => {
      document.removeEventListener("tikzjax-load-finished", onFinished);
    };
  }, [phase, source]);

  const statusText =
    phase === "checking-native" ? "Checking LaTeX availability…" :
    phase === "compiling-native" ? "Compiling with LaTeX…" :
    phase === "loading-lib" ? "Loading TikZJax…" :
    phase === "lib-error" ? "Failed to load TikZJax from CDN." :
    phase === "rendering" ? "Compiling…" :
    null;

  return (
    <Modal onClose={onClose} className={css.dialog} labelledBy="tikzjax-title">
        <div className={css.header}>
          <h2 id="tikzjax-title" className={css.title}>Compiled Picture</h2>
          <div className={css.headerActions}>
            <button
              type="button"
              className={css.closeBtn}
              disabled={phase !== "done"}
              onClick={() => {
                const svg = outputRef.current?.querySelector("svg");
                if (!svg) return;
                const blob = new Blob([svg.outerHTML], { type: "image/svg+xml" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "tikz.svg";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download SVG
            </button>
            <button
              type="button"
              className={css.closeBtn}
              disabled={phase !== "done"}
              onClick={() => {
                const svg = outputRef.current?.querySelector("svg");
                if (!svg) return;
                const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff}svg{width:auto;height:auto;max-width:90vw;max-height:90vh}</style>
</head><body>${svg.outerHTML}</body></html>`;
                const blob = new Blob([html], { type: "text/html" });
                const url = URL.createObjectURL(blob);
                window.open(url, "_blank");
              }}
            >
              Open in New Tab
            </button>
            <button type="button" className={css.closeBtn} onClick={onClose}>Close</button>
          </div>
        </div>

        {statusText ? <div className={css.status}>{statusText}</div> : null}

        {phase === "native-error" ? (
          <div className={css.nativeError}>
            <div className={css.status}>LaTeX compilation failed:</div>
            <pre className={css.errorLog}>{nativeError}</pre>
            <button
              type="button"
              className={css.closeBtn}
              onClick={() => {
                setNativeError(null);
                setPhase("loading-lib");
              }}
            >
              Retry with TikZJax
            </button>
          </div>
        ) : null}

        <div className={css.output} ref={outputRef} />
    </Modal>
  );
}
