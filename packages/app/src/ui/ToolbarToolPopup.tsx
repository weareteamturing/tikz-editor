import { useEffect, useRef, type ReactNode } from "react";
import css from "./ToolbarToolPopup.module.css";

export function ToolbarToolPopup({
  open,
  onClose,
  popup,
  children,
  popupTestId
}: {
  open: boolean;
  onClose: () => void;
  popup: ReactNode;
  children: ReactNode;
  popupTestId?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (!rootRef.current?.contains(target)) {
        onClose();
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  return (
    <div className={css.root} ref={rootRef}>
      {children}
      {open ? (
        <div className={css.popup} role="dialog" aria-label="Tool options" data-testid={popupTestId}>
          {popup}
        </div>
      ) : null}
    </div>
  );
}

export function ToolbarPopupSection({
  title,
  children
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className={css.section}>
      {title ? <div className={css.sectionTitle}>{title}</div> : null}
      {children}
    </section>
  );
}

export type ToolbarPopupChoice = {
  id: string;
  label: string;
};

export function ToolbarPopupChoiceList({
  choices,
  selectedId,
  onSelect
}: {
  choices: readonly ToolbarPopupChoice[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={css.choiceList} role="listbox" aria-label="Subtools">
      {choices.map((choice) => {
        const selected = choice.id === selectedId;
        return (
          <button
            key={choice.id}
            type="button"
            role="option"
            aria-selected={selected}
            className={[css.choiceButton, selected ? css.choiceButtonSelected : ""].filter(Boolean).join(" ")}
            onClick={() => onSelect(choice.id)}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
