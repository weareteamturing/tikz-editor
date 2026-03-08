import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import css from "./CustomDropdown.module.css";

export type CustomDropdownOption<TValue extends string> = {
  value: TValue;
  label: string;
};

export type CustomDropdownSeparator = {
  kind: "separator";
  id: string;
};

export type CustomDropdownItem<TValue extends string> =
  | CustomDropdownOption<TValue>
  | CustomDropdownSeparator;

type CustomDropdownProps<TValue extends string> = {
  ariaLabel: string;
  disabled?: boolean;
  options: readonly CustomDropdownItem<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  onOpen?: () => void;
  onOptionHover?: (value: TValue) => void;
  onOptionHoverEnd?: () => void;
  renderOption?: (option: CustomDropdownOption<TValue>, state: { selected: boolean }) => ReactNode;
  renderValue?: (option: CustomDropdownOption<TValue> | null) => ReactNode;
  menuHeader?: ReactNode;
  rootClassName?: string;
  triggerClassName?: string;
  menuClassName?: string;
  optionClassName?: string;
  optionSelectedClassName?: string;
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
  onOpen,
  onOptionHover,
  onOptionHoverEnd,
  renderOption,
  renderValue,
  menuHeader,
  rootClassName,
  triggerClassName,
  menuClassName,
  optionClassName,
  optionSelectedClassName
}: CustomDropdownProps<TValue>) {
  const [open, setOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<MenuPlacement>("down");
  const [menuMaxHeight, setMenuMaxHeight] = useState<number>(MENU_MAX_HEIGHT_PX);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuListRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = useMemo(
    () => options.find((option): option is CustomDropdownOption<TValue> => isCustomDropdownOption(option) && option.value === value) ?? null,
    [options, value]
  );

  const closeMenu = useCallback(() => {
    setOpen((current) => {
      if (!current) {
        return current;
      }
      onOptionHoverEnd?.();
      return false;
    });
  }, [onOptionHoverEnd]);

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
        closeMenu();
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [closeMenu, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeMenu, open]);

  useEffect(() => {
    if (disabled) {
      closeMenu();
    }
  }, [closeMenu, disabled]);

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
    <div className={[css.root, rootClassName].filter(Boolean).join(" ")} ref={rootRef}>
      <button
        type="button"
        className={[css.trigger, open ? css.triggerOpen : "", triggerClassName].filter(Boolean).join(" ")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          if (open) {
            closeMenu();
            return;
          }
          onOpen?.();
          setOpen(true);
        }}
      >
        <span className={css.triggerValue}>
          {renderValue ? renderValue(selectedOption) : (selectedOption?.label ?? "")}
        </span>
        <span className={css.triggerCaret} aria-hidden="true">
          <svg className={css.triggerCaretIcon} viewBox="0 0 12 8" focusable="false">
            <path d="M1.5 1.5L6 6.5L10.5 1.5" />
          </svg>
        </span>
      </button>

      {open ? (
        <div
          className={[css.menu, menuPlacement === "up" ? css.menuUp : "", menuClassName].filter(Boolean).join(" ")}
        >
          <div
            className={css.menuScroll}
            style={{ maxHeight: `${menuMaxHeight}px` }}
            role="listbox"
            aria-label={ariaLabel}
            ref={menuListRef}
            onPointerLeave={() => onOptionHoverEnd?.()}
          >
            {menuHeader ? <div className={css.menuHeader}>{menuHeader}</div> : null}
            {options.map((item) => {
              if (!isCustomDropdownOption(item)) {
                return <div key={item.id} role="separator" className={css.separator} />;
              }

              const selected = item.value === value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={[
                    css.option,
                    selected ? css.optionSelected : "",
                    optionClassName,
                    selected ? optionSelectedClassName : ""
                  ].filter(Boolean).join(" ")}
                  onPointerEnter={() => onOptionHover?.(item.value)}
                  onClick={() => {
                    onChange(item.value);
                    closeMenu();
                  }}
                >
                  {renderOption ? renderOption(item, { selected }) : item.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isCustomDropdownOption<TValue extends string>(
  item: CustomDropdownItem<TValue>
): item is CustomDropdownOption<TValue> {
  return !("kind" in item) || item.kind !== "separator";
}
