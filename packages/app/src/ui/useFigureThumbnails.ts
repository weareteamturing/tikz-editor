import { useEffect, useMemo, useRef, useState } from "react";
import type { ParseTikzResult } from "tikz-editor/parser/index";
import { renderTikzToSvg } from "tikz-editor/render/index";

type FigureEntry = ParseTikzResult["figures"][number];

type UseFigureThumbnailsOptions = {
  priorityFigureIds?: readonly string[];
  maxToRender?: number;
  refreshDelayMs?: number;
};

const thumbnailCache = new Map<string, string>();
const thumbnailInFlight = new Map<string, Promise<string | null>>();

function makeFigureSignature(source: string, figure: FigureEntry): string {
  const from = Math.max(0, Math.min(source.length, figure.span.from));
  const to = Math.max(from, Math.min(source.length, figure.span.to));
  const slice = source.slice(from, to);
  const head = slice.slice(0, 48);
  const tail = slice.slice(-48);
  return `${slice.length}:${head}:${tail}`;
}

function makeCacheKey(figureId: string, figureSignature: string): string {
  return `${figureId}|${figureSignature}`;
}

export function useFigureThumbnails(
  source: string,
  figures: readonly FigureEntry[],
  options: UseFigureThumbnailsOptions = {}
): ReadonlyMap<string, string> {
  const { priorityFigureIds = [], maxToRender = 8, refreshDelayMs = 350 } = options;
  const [stableInput, setStableInput] = useState<{ source: string; figures: readonly FigureEntry[] }>({
    source,
    figures
  });
  const lastThumbnailByFigureIdRef = useRef(new Map<string, string>());
  const stableSource = stableInput.source;
  const stableFigures = stableInput.figures;

  useEffect(() => {
    const timer = window.setTimeout(() => setStableInput({ source, figures }), refreshDelayMs);
    return () => window.clearTimeout(timer);
  }, [figures, refreshDelayMs, source]);

  const figureSignatures = useMemo(() => {
    const map = new Map<string, string>();
    for (const figure of stableFigures) {
      map.set(figure.id, makeFigureSignature(stableSource, figure));
    }
    return map;
  }, [stableFigures, stableSource]);
  const figureKey = useMemo(
    () => stableFigures.map((figure) => `${figure.id}:${figureSignatures.get(figure.id) ?? ""}`).join("|"),
    [figureSignatures, stableFigures]
  );
  const priorityKey = useMemo(() => priorityFigureIds.join("|"), [priorityFigureIds]);
  const [tick, setTick] = useState(0);

  const thumbnails = useMemo(() => {
    const next = new Map<string, string>();
    for (const figure of figures) {
      const signature = figureSignatures.get(figure.id);
      if (signature) {
        const cached = thumbnailCache.get(makeCacheKey(figure.id, signature));
        if (cached) {
          lastThumbnailByFigureIdRef.current.set(figure.id, cached);
          next.set(figure.id, cached);
          continue;
        }
      }
      const last = lastThumbnailByFigureIdRef.current.get(figure.id);
      if (last) {
        next.set(figure.id, last);
      }
    }
    return next;
  }, [figureSignatures, figures, tick]);

  useEffect(() => {
    if (stableFigures.length === 0 || maxToRender <= 0) {
      return;
    }

    const figureById = new Map(stableFigures.map((figure) => [figure.id, figure]));
    const missingIds = stableFigures
      .map((figure) => figure.id)
      .filter((figureId) => {
        const signature = figureSignatures.get(figureId);
        return !signature || !thumbnailCache.has(makeCacheKey(figureId, signature));
      });
    if (missingIds.length === 0) {
      return;
    }

    const prioritized = priorityFigureIds.filter((figureId) => missingIds.includes(figureId));
    const orderedMissing = [...prioritized, ...missingIds.filter((figureId) => !prioritized.includes(figureId))]
      .slice(0, maxToRender);

    let cancelled = false;
    const timers: Array<{ kind: "idle" | "timeout"; id: number }> = [];

    const queue = async (): Promise<void> => {
      for (const figureId of orderedMissing) {
        if (cancelled) {
          return;
        }
        const figureSignature = figureSignatures.get(figureId);
        if (!figureSignature) {
          continue;
        }
        const key = makeCacheKey(figureId, figureSignature);
        if (thumbnailCache.has(key)) {
          continue;
        }
        let inFlight = thumbnailInFlight.get(key);
        if (!inFlight) {
          const figure = figureById.get(figureId);
          if (!figure) {
            continue;
          }
          inFlight = Promise.resolve().then(() => {
            const rendered = renderTikzToSvg(stableSource, {
              parse: {
                recover: true,
                activeFigureId: figure.id,
                includeContextDefinitions: true
              },
              svg: { padding: 8 }
            });
            return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered.svg.svg)}`;
          }).catch(() => null);
          thumbnailInFlight.set(key, inFlight);
        }
        const url = await inFlight;
        thumbnailInFlight.delete(key);
        if (cancelled) {
          return;
        }
        if (!url) {
          continue;
        }
        thumbnailCache.set(key, url);
        setTick((value) => value + 1);
        await new Promise<void>((resolve) => {
          const hasIdleCallback = typeof window.requestIdleCallback === "function";
          if (hasIdleCallback) {
            const id = window.requestIdleCallback(() => resolve(), { timeout: 80 });
            timers.push({ kind: "idle", id });
            return;
          }
          const id = window.setTimeout(() => resolve(), 0);
          timers.push({ kind: "timeout", id });
        });
      }
    };

    void queue();

    return () => {
      cancelled = true;
      for (const timer of timers) {
        if (timer.kind === "idle" && typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(timer.id);
          continue;
        }
        window.clearTimeout(timer.id);
      }
    };
  }, [figureKey, figureSignatures, maxToRender, priorityFigureIds, priorityKey, stableFigures, stableSource]);

  return thumbnails;
}
