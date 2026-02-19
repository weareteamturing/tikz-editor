import { useEditorStore } from "../store/store";
import css from "./StatusBar.module.css";

export function StatusBar() {
  const toolMode = useEditorStore((s) => s.toolMode);
  const snapshot = useEditorStore((s) => s.snapshot);
  const pendingRequestId = useEditorStore((s) => s.pendingRequestId);
  const selectedIds = useEditorStore((s) => s.selectedElementIds);

  const parseResult = snapshot.parseResult;
  const semanticResult = snapshot.semanticResult;

  const parseDiags = parseResult?.diagnostics ?? [];
  const semanticDiags = semanticResult?.diagnostics ?? [];
  const allDiags = [...parseDiags, ...semanticDiags];
  const errorCount = allDiags.filter((d) => d.severity === "error").length;
  const warnCount = allDiags.filter((d) => d.severity === "warning").length;

  const elementCount = snapshot.scene?.elements.length ?? 0;
  const selectedCount = selectedIds.size;

  return (
    <div className={css.bar}>
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
