import { Modal } from "./Modal";
import css from "./UnsavedChangesModal.module.css";

export type UnsavedChangesDecision = "save" | "discard" | "cancel";

export function UnsavedChangesModal({
  documentTitles,
  onChoose
}: {
  documentTitles: string[];
  onChoose: (decision: UnsavedChangesDecision) => void;
}) {
  const label =
    documentTitles.length === 1
      ? `The document "${documentTitles[0]}" has unsaved changes.`
      : `${documentTitles.length} documents have unsaved changes.`;

  return (
    <Modal onClose={() => onChoose("cancel")} closeOnBackdrop={false} labelledBy="unsaved-changes-title" className={css.panel}>
      <div className={css.dialog} data-testid="unsaved-changes-modal">
        <div className={css.titleBar}>
          <h2 id="unsaved-changes-title" className={css.title}>Unsaved Changes</h2>
        </div>
        <div className={css.body}>
          <p className={css.message} data-select="text">{label}</p>
          {documentTitles.length > 1 ? (
            <ul className={css.list} data-select="text">
              {documentTitles.map((title, index) => (
                <li key={`${title}-${index}`}>{title}</li>
              ))}
            </ul>
          ) : null}
          <div className={css.actions}>
            <button
              type="button"
              className={css.secondary}
              onClick={() => onChoose("cancel")}
              data-testid="unsaved-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              className={css.secondary}
              onClick={() => onChoose("discard")}
              data-testid="unsaved-discard"
            >
              Don&apos;t Save
            </button>
            <button
              type="button"
              className={css.primary}
              onClick={() => onChoose("save")}
              data-testid="unsaved-save"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
