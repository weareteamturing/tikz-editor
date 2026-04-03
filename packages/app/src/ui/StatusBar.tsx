import { useEditorStore } from "../store/store";
import { useFrameTimingStats } from "./useFrameTimingStats";
import css from "./StatusBar.module.css";

export function StatusBar() {
  const toolMode = useEditorStore((s) => s.toolMode);
  const snapshot = useEditorStore((s) => s.snapshot);
  const pendingRequestId = useEditorStore((s) => s.pendingRequestId);
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);

  const showPerf = import.meta.env.DEV;
  const perfStats = useFrameTimingStats(activeCanvasDragKind, showPerf);

  const parseResult = snapshot.parseResult;
  const semanticResult = snapshot.semanticResult;
  const incrementalInfo = snapshot.incremental;

  const parseDiags = parseResult?.diagnostics ?? [];
  const semanticDiags = semanticResult?.diagnostics ?? [];
  const allDiags = [...parseDiags, ...semanticDiags];
  const errorCount = allDiags.filter((d) => d.severity === "error").length;
  const warnCount = allDiags.filter((d) => d.severity === "warning").length;

  const elementCount = snapshot.scene?.elements.length ?? 0;
  const selectedCount = selectedIds.size;

  const perfClassName =
    perfStats.maxFrameMs != null && perfStats.maxFrameMs >= 40
      ? css.error
      : perfStats.p95FrameMs != null && perfStats.p95FrameMs >= 20
        ? css.warning
        : css.ok;
  const perfSummary = perfStats.frameCount === 0
    ? "warming…"
    : `${formatPerf(perfStats.fps, 0)} fps · p95 ${formatPerf(perfStats.p95FrameMs)} ms · max ${formatPerf(perfStats.maxFrameMs)} ms`;
  const dragSummary = perfStats.dragFrameCount > 0
    ? ` · drag max ${formatPerf(perfStats.dragMaxFrameMs)} ms${activeCanvasDragKind ? ` (${activeCanvasDragKind})` : ""}`
    : "";
  const showIncrementalFallback =
    showPerf &&
    incrementalInfo != null &&
    (
      (incrementalInfo.parseStrategy === "full" &&
        incrementalInfo.parseFallbackReason !== undefined &&
        incrementalInfo.parseFallbackReason !== "no-previous-cache") ||
      (incrementalInfo.strategy === "full" &&
        incrementalInfo.fallbackReason !== "no-previous-cache")
    );
  const incrementalFallbackClass =
    incrementalInfo?.parseFallbackReason === "runtime-error" ||
    incrementalInfo?.fallbackReason === "runtime-error" ||
    incrementalInfo?.fallbackReason === "restore-failed"
      ? css.error
      : css.warning;
  const incrementalFallbackReason = [
    incrementalInfo?.parseStrategy === "full" && incrementalInfo.parseFallbackReason
      ? `parser ${incrementalInfo.parseFallbackReason}`
      : null,
    incrementalInfo?.strategy === "full" && incrementalInfo.fallbackReason
      ? `semantic ${incrementalInfo.fallbackReason}`
      : null
  ].filter(Boolean).join(" + ") || "unknown";

  return (
    <div className={css.bar} data-select="chrome">
      <div className={css.cell}>
        <span className={css.label}>Mode:</span>
        <span className={css.toolMode}>{toolMode}</span>
      </div>

      {selectedCount > 0 && (
        <div className={css.cell}>
          <span className={css.label}>Sel:</span>
          <span>{selectedCount}</span>
        </div>
      )}

      <div className={css.cell}>
        <span className={css.label}>Elements:</span>
        <span>{elementCount}</span>
      </div>

      {showPerf && (
        <div className={css.cell}>
          <span className={css.label}>Perf:</span>
          <span className={perfClassName}>
            {perfSummary}
            {dragSummary}
          </span>
        </div>
      )}

      {showIncrementalFallback && (
        <div className={css.cell}>
          <span className={css.label}>Inc:</span>
          <span className={incrementalFallbackClass}>
            fallback ({incrementalFallbackReason})
          </span>
        </div>
      )}

      <div className={css.spacer} />

      {pendingRequestId && (
        <div className={css.cell}>
          <span>Computing…</span>
        </div>
      )}

      {errorCount > 0 && (
        <div className={css.cell}>
          <span className={css.error}>✕ {errorCount} error{errorCount !== 1 ? "s" : ""}</span>
        </div>
      )}

      {warnCount > 0 && (
        <div className={css.cell}>
          <span className={css.warning}>⚠ {warnCount} warning{warnCount !== 1 ? "s" : ""}</span>
        </div>
      )}

      {errorCount === 0 && warnCount === 0 && parseResult && (
        <div className={css.cell}>
          <span className={css.ok}>✓ OK</span>
        </div>
      )}
    </div>
  );
}

function formatPerf(value: number | null, digits = 1): string {
  return value == null ? "—" : value.toFixed(digits);
}
