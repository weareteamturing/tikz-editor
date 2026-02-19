import { useEditorStore } from "../store/store";
import css from "./InspectorPanel.module.css";

export function InspectorPanel() {
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const snapshot = useEditorStore((s) => s.snapshot);

  const selectedElements = snapshot.scene?.elements.filter((el) =>
    selectedIds.has(el.sourceId)
  ) ?? [];

  return (
    <div className={css.panel}>
      <div className={css.header}>Inspector</div>
      <div className={css.content}>
        {selectedElements.length === 0 ? (
          <p className={css.hint}>Select an element on the canvas to inspect its properties.</p>
        ) : (
          selectedElements.map((el) => (
            <div key={el.id} className={css.elementInfo}>
              <div className={css.elementKind}>{el.kind}</div>
              <div className={css.elementId}>{el.sourceId}</div>
              <p className={css.phaseNote}>Full property inspector coming in Phase 2.</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
