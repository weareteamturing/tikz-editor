import { useMemo } from "react";
import { useEditorStore } from "../store/store";
import { useFigureThumbnails } from "./useFigureThumbnails";
import css from "./FigureNavigator.module.css";

export function FigureNavigator() {
  const snapshot = useEditorStore((s) => s.snapshot);
  const source = snapshot.source;
  const figures = snapshot.figures;
  const activeFigureId = useEditorStore((s) => s.activeFigureId);
  const dispatch = useEditorStore((s) => s.dispatch);

  const activeIndex = useMemo(
    () => (activeFigureId ? figures.findIndex((figure) => figure.id === activeFigureId) : -1),
    [activeFigureId, figures]
  );
  const priorityFigureIds = useMemo(() => {
    if (activeIndex < 0) {
      return figures.slice(0, 6).map((figure) => figure.id);
    }
    const ids: string[] = [];
    for (let index = Math.max(0, activeIndex - 2); index <= Math.min(figures.length - 1, activeIndex + 3); index += 1) {
      const figure = figures[index];
      if (figure) {
        ids.push(figure.id);
      }
    }
    return ids;
  }, [activeIndex, figures]);
  const thumbnails = useFigureThumbnails(source, figures, {
    priorityFigureIds,
    maxToRender: 10,
    refreshDelayMs: 600
  });

  if (figures.length < 2) {
    return null;
  }

  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex >= 0 && activeIndex < figures.length - 1;

  const selectAt = (index: number) => {
    const figure = figures[index];
    if (!figure) {
      return;
    }
    dispatch({ type: "SET_ACTIVE_FIGURE", figureId: figure.id });
  };

  return (
    <div className={css.panel} data-testid="figure-navigator">
      <button
        type="button"
        className={css.navButton}
        disabled={!canGoPrev}
        onClick={() => selectAt(activeIndex - 1)}
        aria-label="Previous figure"
      >
        {"<"}
      </button>
      <div className={css.strip}>
        {figures.map((figure, index) => {
          const thumbnail = thumbnails.get(figure.id);
          const isActive = figure.id === activeFigureId;
          return (
            <button
              type="button"
              key={figure.id}
              className={[css.thumb, isActive ? css.thumbActive : ""].filter(Boolean).join(" ")}
              onClick={() => dispatch({ type: "SET_ACTIVE_FIGURE", figureId: figure.id })}
              title={`Figure ${index + 1}`}
              aria-label={`Figure ${index + 1}`}
            >
              <div className={css.thumbPreview}>
                {thumbnail ? <img src={thumbnail} alt={`Figure ${index + 1} preview`} /> : "Rendering…"}
              </div>
              <div className={css.thumbLabel}>{`Figure ${index + 1} (L${figure.startLine})`}</div>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={css.navButton}
        disabled={!canGoNext}
        onClick={() => selectAt(activeIndex + 1)}
        aria-label="Next figure"
      >
        {">"}
      </button>
    </div>
  );
}
