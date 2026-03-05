import { useEffect, useRef, useState } from "react";
import {
  APP_MENU_DEFINITION,
  type AppMenuItem
} from "tikz-editor/app-menu";
import { useEditorStore } from "../store/store";
import { OPEN_EXAMPLE_CATALOG, type TikzOpenExample } from "./examples/open-example-catalog";
import { OpenExampleModal } from "./OpenExampleModal";
import { useEditorCommandRuntime, type CommandBindings } from "./editor-command-runtime";
import css from "./AppMenuBar.module.css";

const IS_MAC_PLATFORM =
  typeof navigator !== "undefined" &&
  /(mac|iphone|ipad)/i.test(navigator.platform);

function formatAccelerator(accelerator: string | undefined): string {
  if (!accelerator) {
    return "";
  }

  return accelerator
    .split("+")
    .map((part) => {
      if (part === "CmdOrCtrl") {
        return IS_MAC_PLATFORM ? "Cmd" : "Ctrl";
      }
      return part;
    })
    .join(IS_MAC_PLATFORM ? " " : "+");
}

function MenuPopup({
  items,
  path,
  nested,
  bindings,
  onCommandRun
}: {
  items: readonly AppMenuItem[];
  path: string;
  nested: boolean;
  bindings: CommandBindings;
  onCommandRun: () => void;
}) {
  const hasCheckItems = items.some(
    (item) => item.kind === "command" && bindings[item.commandId].checked != null
  );

  return (
    <div className={[css.popup, nested ? css.popupNested : ""].filter(Boolean).join(" ")} role="menu">
      {items.map((item, index) => {
        const itemKey = `${path}-${index}`;
        if (item.kind === "separator") {
          return <div key={`${itemKey}-separator`} className={css.separator} role="separator" />;
        }

        if (item.kind === "submenu") {
          return (
            <div key={`${itemKey}-submenu`} className={css.submenu}>
              <div
                className={[css.item, css.submenuTrigger, hasCheckItems ? "" : css.itemNoCheck]
                  .filter(Boolean)
                  .join(" ")}
                role="menuitem"
                aria-haspopup="menu"
              >
                {hasCheckItems ? <span className={css.check} /> : null}
                <span className={css.label}>{item.label}</span>
                <span className={css.submenuArrow}>›</span>
              </div>
              <MenuPopup
                items={item.items}
                path={`${itemKey}-submenu`}
                nested
                bindings={bindings}
                onCommandRun={onCommandRun}
              />
            </div>
          );
        }

        const binding = bindings[item.commandId];
        const role = binding.checked == null ? "menuitem" : "menuitemcheckbox";
        return (
          <button
            key={`${itemKey}-${item.commandId}`}
            type="button"
            role={role}
            aria-checked={binding.checked}
            disabled={!binding.enabled}
            className={[css.item, hasCheckItems ? "" : css.itemNoCheck].filter(Boolean).join(" ")}
            onClick={() => {
              if (!binding.enabled) {
                return;
              }
              binding.run("menu");
              onCommandRun();
            }}
          >
            {hasCheckItems ? <span className={css.check}>{binding.checked ? "✓" : ""}</span> : null}
            <span className={css.label}>{item.label}</span>
            <span className={css.shortcut}>{formatAccelerator(item.accelerator)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function AppMenuBar() {
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const dispatch = useEditorStore((s) => s.dispatch);

  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [showOpenExampleModal, setShowOpenExampleModal] = useState(false);
  const [pendingAutoFit, setPendingAutoFit] = useState(false);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const { bindings } = useEditorCommandRuntime({
    onOpenExample: () => setShowOpenExampleModal(true)
  });

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (!menuRootRef.current?.contains(target)) {
        setOpenSectionId(null);
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!openSectionId) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenSectionId(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSectionId]);

  useEffect(() => {
    if (!pendingAutoFit) {
      return;
    }
    if (snapshot.source !== source) {
      return;
    }
    dispatch({ type: "REQUEST_FIT_TO_CONTENT" });
    setPendingAutoFit(false);
  }, [dispatch, pendingAutoFit, snapshot.source, source]);

  const loadExampleIntoEditor = (example: TikzOpenExample) => {
    dispatch({ type: "CODE_EDITED", source: example.source });
    dispatch({ type: "CLEAR_SELECTION" });
    dispatch({ type: "SET_TOOL_MODE", mode: "select" });
    setShowOpenExampleModal(false);
    setPendingAutoFit(true);
  };

  return (
    <>
      <div
        className={css.menuBar}
        role="menubar"
        ref={menuRootRef}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setOpenSectionId(null);
          }
        }}
      >
        {APP_MENU_DEFINITION.map((section) => {
          const isOpen = openSectionId === section.id;
          return (
            <div
              key={section.id}
              className={css.section}
              onMouseEnter={() => {
                if (openSectionId && openSectionId !== section.id) {
                  setOpenSectionId(section.id);
                }
              }}
            >
              <button
                type="button"
                className={[css.trigger, isOpen ? css.triggerActive : ""].filter(Boolean).join(" ")}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onClick={() => {
                  setOpenSectionId((current) => current === section.id ? null : section.id);
                }}
              >
                {section.label}
              </button>

              {isOpen ? (
                <MenuPopup
                  items={section.items}
                  path={section.id}
                  nested={false}
                  bindings={bindings}
                  onCommandRun={() => setOpenSectionId(null)}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {showOpenExampleModal ? (
        <OpenExampleModal
          examples={OPEN_EXAMPLE_CATALOG}
          onClose={() => setShowOpenExampleModal(false)}
          onSelectExample={loadExampleIntoEditor}
        />
      ) : null}
    </>
  );
}
