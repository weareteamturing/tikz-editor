import { useEditorStore } from "../store/store";
import css from "./TabStrip.module.css";

export function TabStrip({
  onRequestCloseDocument
}: {
  onRequestCloseDocument?: (documentId: string) => void;
} = {}) {
  const documents = useEditorStore((s) => s.documents);
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const dispatch = useEditorStore((s) => s.dispatch);

  return (
    <div className={css.strip} role="tablist" aria-label="Documents" data-testid="tab-strip">
      {tabOrder.map((id) => {
        const doc = documents[id];
        if (!doc) {
          return null;
        }
        const active = id === activeDocumentId;
        return (
          <div
            key={id}
            className={[css.tab, active ? css.tabActive : ""].filter(Boolean).join(" ")}
            role="tab"
            aria-selected={active}
            data-testid={`tab-${id}`}
          >
            <button
              type="button"
              className={css.tabButton}
              onClick={() => dispatch({ type: "SWITCH_DOCUMENT", documentId: id })}
              data-testid={`tab-switch-${id}`}
            >
              <span className={css.title}>{doc.title}</span>
              {doc.dirty ? <span className={css.dirty} title="Unsaved changes">•</span> : null}
            </button>
            <button
              type="button"
              className={css.close}
              aria-label={`Close ${doc.title}`}
              onClick={() => {
                if (onRequestCloseDocument) {
                  onRequestCloseDocument(id);
                  return;
                }
                dispatch({ type: "CLOSE_DOCUMENT", documentId: id });
              }}
              data-testid={`tab-close-${id}`}
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
        data-testid="tab-new"
      >
        +
      </button>
    </div>
  );
}
