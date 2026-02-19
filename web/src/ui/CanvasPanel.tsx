import { useMemo } from "react";
import { useEditorStore } from "../store/store";
import css from "./CanvasPanel.module.css";

export function CanvasPanel() {
  const snapshot = useEditorStore((s) => s.snapshot);
  const svgResult = snapshot.svg;
  // Use the array references directly — parseResult/semanticResult are replaced atomically
  // by SNAPSHOT_READY, so these references are stable between snapshots.
  const parseDiags = snapshot.parseResult?.diagnostics;
  const semanticDiags = snapshot.semanticResult?.diagnostics;

  const diagnostics = useMemo(() => {
    const result: Array<{ severity: "error" | "warning"; message: string; code?: string; source: "parse" | "semantic" }> = [];
    if (parseDiags) for (const d of parseDiags) result.push({ ...d, source: "parse" });
    if (semanticDiags) for (const d of semanticDiags) result.push({ ...d, source: "semantic" });
    return result;
  }, [parseDiags, semanticDiags]);

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warnCount = diagnostics.filter((d) => d.severity === "warning").length;

  return (
    <div className={css.panel}>
      <div className={css.header}>
        <span>Canvas</span>
        {svgResult && (
          <span className={css.headerMeta}>
            {svgResult.viewBox.width.toFixed(0)}×{svgResult.viewBox.height.toFixed(0)} pt
            {errorCount > 0 && <> · <span style={{ color: "#bf2c29" }}>{errorCount} err</span></>}
            {warnCount > 0 && <> · <span style={{ color: "#a06010" }}>{warnCount} warn</span></>}
          </span>
        )}
      </div>

      {diagnostics.length > 0 && (
        <div className={css.diagnostics}>
          {diagnostics.slice(0, 5).map((d, i) => (
            <div key={i} className={`${css.diagnostic} ${css[d.severity]}`}>
              <code>{d.code ?? d.severity}</code>
              <span>{d.message}</span>
            </div>
          ))}
          {diagnostics.length > 5 && (
            <div className={css.diagnostic}>
              <span />
              <span>…{diagnostics.length - 5} more</span>
            </div>
          )}
        </div>
      )}

      <div className={css.canvas}>
        {!svgResult ? (
          <div className={css.noSvg}>
            {snapshot.source ? "Computing…" : "No source"}
          </div>
        ) : (
          // The SVG from emitSvg has only a viewBox, no width/height attributes.
          // Set the wrapper dimensions explicitly so the SVG renders at its natural pt size.
          // Phase 1 will replace this with a proper canvas transform for pan/zoom.
          <div
            className={css.svgWrap}
            style={{
              width: svgResult.viewBox.width,
              height: svgResult.viewBox.height
            }}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: svgResult.svg }}
          />
        )}
      </div>
    </div>
  );
}
