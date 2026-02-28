import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

const MENU_GAP_PX = 2;
const MENU_VIEWPORT_PADDING_PX = 8;
const MENU_MAX_HEIGHT_PX = 220;
const MENU_MIN_HEIGHT_PX = 80;

type MenuPlacement = "down" | "up";

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
  const [menuPlacement, setMenuPlacement] = useState<MenuPlacement>("down");
  const [menuMaxHeight, setMenuMaxHeight] = useState<number>(MENU_MAX_HEIGHT_PX);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuListRef = useRef<HTMLDivElement | null>(null);

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

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    function updateMenuPosition(): void {
      const rootElement = rootRef.current;
      const menuListElement = menuListRef.current;
      if (!rootElement || !menuListElement) {
        return;
      }

      const rootRect = rootElement.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rootRect.bottom - MENU_VIEWPORT_PADDING_PX - MENU_GAP_PX;
      const spaceAbove = rootRect.top - MENU_VIEWPORT_PADDING_PX - MENU_GAP_PX;
      const naturalHeight = menuListElement.scrollHeight;

      const shouldOpenUpward = naturalHeight > spaceBelow && spaceAbove > 0;
      const nextPlacement: MenuPlacement = shouldOpenUpward ? "up" : "down";
      const availableSpace = nextPlacement === "up" ? spaceAbove : spaceBelow;
      const boundedMaxHeight = Math.min(
        MENU_MAX_HEIGHT_PX,
        Math.max(MENU_MIN_HEIGHT_PX, Math.floor(availableSpace))
      );

      setMenuPlacement((current) => (current === nextPlacement ? current : nextPlacement));
      setMenuMaxHeight((current) => (current === boundedMaxHeight ? current : boundedMaxHeight));
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

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
        <div
          className={[css.menu, menuPlacement === "up" ? css.menuUp : ""].filter(Boolean).join(" ")}
        >
          <div
            className={css.menuScroll}
            style={{ maxHeight: `${menuMaxHeight}px` }}
            role="listbox"
            aria-label={ariaLabel}
            ref={menuListRef}
          >
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
        </div>
      ) : null}
    </div>
  );
}
