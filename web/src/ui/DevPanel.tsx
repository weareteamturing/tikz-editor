import { useState } from "react";
import { useEditorStore } from "../store/store";
import { TreeView } from "../TreeView";
import css from "./DevPanel.module.css";

type Tab = "cst" | "ir" | "snapshot";

export function DevPanel() {
  const showDevPanel = useEditorStore((s) => s.showDevPanel);
  const dispatch = useEditorStore((s) => s.dispatch);
  const snapshot = useEditorStore((s) => s.snapshot);
  const source = useEditorStore((s) => s.source);

  const [tab, setTab] = useState<Tab>("cst");

  if (!showDevPanel) return null;

  return (
    <div className={css.overlay} onClick={(e) => e.target === e.currentTarget && dispatch({ type: "TOGGLE_DEV_PANEL" })}>
      <div className={css.panel}>
        <div className={css.header}>
          <span>Dev Panel</span>
          <button className={css.closeBtn} onClick={() => dispatch({ type: "TOGGLE_DEV_PANEL" })}>✕</button>
        </div>

        <div className={css.tabs}>
          {(["cst", "ir", "snapshot"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`${css.tab} ${tab === t ? css.tabActive : ""}`}
              onClick={() => setTab(t)}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div className={css.body}>
          {tab === "cst" && (
            <div className={css.treeWrap}>
              <TreeView
                tree={snapshot.parseResult?.tree ?? null}
                source={source}
                onHover={() => {}}
              />
            </div>
          )}
          {tab === "ir" && (
            <pre className={css.json}>
              {JSON.stringify(
                { figure: snapshot.parseResult?.figure, scene: snapshot.semanticResult?.scene },
                null,
                2
              )}
            </pre>
          )}
          {tab === "snapshot" && (
            <pre className={css.json}>
              {JSON.stringify(
                {
                  revision: snapshot.revision,
                  source: snapshot.source.slice(0, 200) + (snapshot.source.length > 200 ? "…" : ""),
                  editHandles: snapshot.editHandles.length,
                  sceneElements: snapshot.scene?.elements.length ?? 0,
                  hasSvg: snapshot.svg != null,
                  svgLength: snapshot.svg?.svg.length ?? 0
                },
                null,
                2
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
