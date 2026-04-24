import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { getDockLayoutHandle } from "./DockLayout";
import { useWorkspaceListStore } from "../store/workspace-list-store";
import { isReservedWorkspaceName } from "./workspace-apply";
import css from "./SaveWorkspaceModal.module.css";

type SaveWorkspaceModalProps = {
  onClose: () => void;
};

export function SaveWorkspaceModal({ onClose }: SaveWorkspaceModalProps) {
  const [name, setName] = useState("");
  const [pendingOverwriteId, setPendingOverwriteId] = useState<string | null>(null);
  const userWorkspaces = useWorkspaceListStore((s) => s.userWorkspaces);
  const createWorkspace = useWorkspaceListStore((s) => s.createWorkspace);
  const overwriteWorkspace = useWorkspaceListStore((s) => s.overwriteWorkspace);

  const trimmed = name.trim();
  const reserved = trimmed.length > 0 && isReservedWorkspaceName(trimmed);
  const existingMatch = useMemo(
    () => userWorkspaces.find((ws) => ws.name.toLowerCase() === trimmed.toLowerCase()) ?? null,
    [userWorkspaces, trimmed]
  );

  const canSubmit = trimmed.length > 0 && !reserved;

  function onSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;

    const handle = getDockLayoutHandle();
    if (!handle) {
      onClose();
      return;
    }
    const json = handle.getCurrentJson();

    if (existingMatch) {
      setPendingOverwriteId(existingMatch.id);
      return;
    }

    createWorkspace(trimmed, json);
    onClose();
  }

  function confirmOverwrite(): void {
    if (!pendingOverwriteId) return;
    const handle = getDockLayoutHandle();
    if (!handle) {
      onClose();
      return;
    }
    overwriteWorkspace(pendingOverwriteId, handle.getCurrentJson());
    onClose();
  }

  if (pendingOverwriteId) {
    return (
      <Modal
        onClose={onClose}
        labelledBy="save-workspace-modal-title"
        dataTestId="save-workspace-overwrite-modal"
        className={css.modal}
      >
        <div className={css.header}>
          <h2 id="save-workspace-modal-title" className={css.title}>Overwrite workspace?</h2>
        </div>
        <div className={css.body}>
          <p className={css.message}>
            A workspace named “{trimmed}” already exists. Overwrite it with the current layout?
          </p>
        </div>
        <div className={css.footer}>
          <button type="button" className={css.secondaryButton} onClick={() => setPendingOverwriteId(null)}>
            Back
          </button>
          <button
            type="button"
            className={css.primaryButton}
            onClick={confirmOverwrite}
            data-testid="save-workspace-overwrite-confirm"
          >
            Overwrite
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      onClose={onClose}
      labelledBy="save-workspace-modal-title"
      dataTestId="save-workspace-modal"
      className={css.modal}
    >
      <form onSubmit={onSubmit}>
        <div className={css.header}>
          <h2 id="save-workspace-modal-title" className={css.title}>Save Workspace As…</h2>
          <button
            type="button"
            className={css.iconButton}
            onClick={onClose}
            aria-label="Close save workspace dialog"
          >
            ×
          </button>
        </div>

        <div className={css.body}>
          <label className={css.field}>
            <span>Name</span>
            <input
              data-testid="save-workspace-name-input"
              autoFocus
              type="text"
              value={name}
              placeholder="My workspace"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {reserved ? (
            <p className={css.warning}>This name is reserved for a built-in workspace.</p>
          ) : existingMatch ? (
            <p className={css.hint}>Saving will prompt to overwrite “{existingMatch.name}”.</p>
          ) : null}
        </div>

        <div className={css.footer}>
          <button type="button" className={css.secondaryButton} onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className={css.primaryButton}
            disabled={!canSubmit}
            data-testid="save-workspace-confirm"
          >
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
