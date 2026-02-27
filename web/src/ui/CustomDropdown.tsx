import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import css from "./CustomDropdown.module.css";

export type CustomDropdownOption<TValue extends string> = {
  value: TValue;
  label: string;
};

type CustomDropdownProps<TValue extends string> = {
  ariaLabel: string;
  disabled?: boolean;
  options: readonly CustomDropdownOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  renderOption?: (option: CustomDropdownOption<TValue>, state: { selected: boolean }) => ReactNode;
  renderValue?: (option: CustomDropdownOption<TValue> | null) => ReactNode;
};

export function CustomDropdown<TValue extends string>({
  ariaLabel,
  disabled = false,
  options,
  value,
  onChange,
  renderOption,
  renderValue
}: CustomDropdownProps<TValue>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  );

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
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  return (
    <div className={css.root} ref={rootRef}>
      <button
        type="button"
        className={[css.trigger, open ? css.triggerOpen : ""].filter(Boolean).join(" ")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          setOpen((current) => !current);
        }}
      >
        <span className={css.triggerValue}>
          {renderValue ? renderValue(selectedOption) : (selectedOption?.label ?? "")}
        </span>
        <span className={css.triggerCaret} aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className={css.menu} role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={[css.option, selected ? css.optionSelected : ""].filter(Boolean).join(" ")}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {renderOption ? renderOption(option, { selected }) : option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
