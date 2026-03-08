import { useEditorStore } from "../store/store";
import css from "./TabStrip.module.css";

export function TabStrip() {
  const documents = useEditorStore((s) => s.documents);
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const dispatch = useEditorStore((s) => s.dispatch);

  return (
    <div className={css.strip} role="tablist" aria-label="Documents">
      {tabOrder.map((id) => {
        const doc = documents[id];
        if (!doc) {
          return null;
        }
        const active = id === activeDocumentId;
        return (
          <div key={id} className={[css.tab, active ? css.tabActive : ""].filter(Boolean).join(" ")} role="tab" aria-selected={active}>
            <button
              type="button"
              className={css.tabButton}
              onClick={() => dispatch({ type: "SWITCH_DOCUMENT", documentId: id })}
            >
              <span className={css.title}>{doc.title}</span>
              {doc.dirty ? <span className={css.dirty} title="Unsaved changes">•</span> : null}
            </button>
            <button
              type="button"
              className={css.close}
              aria-label={`Close ${doc.title}`}
              onClick={() => dispatch({ type: "CLOSE_DOCUMENT", documentId: id })}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className={css.add}
        onClick={() => dispatch({ type: "NEW_DOCUMENT" })}
        aria-label="New document"
      >
        +
      </button>
    </div>
  );
}
