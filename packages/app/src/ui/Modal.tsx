import { useEffect, type ReactNode } from "react";
import css from "./Modal.module.css";

type ModalProps = {
  onClose: () => void;
  labelledBy?: string;
  className?: string;
  dataTestId?: string;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  children: ReactNode;
};

export function Modal({
  onClose,
  labelledBy,
  className,
  dataTestId,
  closeOnEscape = true,
  closeOnBackdrop = true,
  children
}: ModalProps) {
  useEffect(() => {
    if (!closeOnEscape) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeOnEscape, onClose]);

  const panelClassName = className ? `${css.panel} ${className}` : css.panel;

  return (
    <div
      className={css.backdrop}
      onMouseDown={() => {
        if (closeOnBackdrop) {
          onClose();
        }
      }}
    >
      <div
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-testid={dataTestId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
