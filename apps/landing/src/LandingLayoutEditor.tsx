import { useEffect } from "react";

type LayoutEntry = {
  x: number;
  y: number;
  scale: number;
  width?: number;
  html?: string;
};

type LayoutState = Record<string, LayoutEntry>;

const STORAGE_KEY = "tikz-editor.landing-layout-editor";
const PANEL_STORAGE_KEY = "tikz-editor.landing-layout-editor.panel";
const PREVIEW_STORAGE_KEY = "tikz-editor.landing-layout-editor.preview";
const ENABLE_QUERY_VALUES = new Set(["1", "true", "edit"]);

function isEditorEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get("layout") ?? params.get("layoutEditor");
  return ENABLE_QUERY_VALUES.has(queryValue ?? "");
}

function loadState(): LayoutState {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as LayoutState;
  } catch {
    return {};
  }
}

function saveState(state: LayoutState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state, null, 2));
}

function ensureEntry(state: LayoutState, id: string): LayoutEntry {
  state[id] ??= { x: 0, y: 0, scale: 1 };
  return state[id];
}

function applyEntry(target: HTMLElement | SVGElement, entry: LayoutEntry): void {
  if (target instanceof HTMLElement && target.dataset.layoutText !== undefined) {
    target.style.setProperty("--layout-edit-x", `${entry.x}px`);
    target.style.setProperty("--layout-edit-y", `${entry.y}px`);
    target.style.removeProperty("--layout-edit-scale");
    if (entry.width) {
      target.style.width = `${entry.width}px`;
      target.style.maxWidth = "none";
    }
    return;
  }

  target.style.setProperty("--layout-edit-x", `${entry.x}px`);
  target.style.setProperty("--layout-edit-y", `${entry.y}px`);
  target.style.setProperty("--layout-edit-scale", String(entry.scale));
}

function formatExport(state: LayoutState): string {
  return JSON.stringify(state, null, 2);
}

function loadPanelPosition(): { x: number; y: number } | null {
  try {
    return JSON.parse(window.localStorage.getItem(PANEL_STORAGE_KEY) ?? "null") as { x: number; y: number } | null;
  } catch {
    return null;
  }
}

function savePanelPosition(panel: HTMLElement): void {
  const rect = panel.getBoundingClientRect();
  window.localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
}

function setPreviewMode(enabled: boolean): void {
  document.documentElement.classList.toggle("landingLayoutPreviewing", enabled);
  window.localStorage.setItem(PREVIEW_STORAGE_KEY, enabled ? "1" : "0");
}

export function LandingLayoutEditor() {
  useEffect(() => {
    if (!isEditorEnabled()) {
      return;
    }

    const state = loadState();
    const targets = new Map<string, HTMLElement | SVGElement>();
    const boxes = new Map<string, HTMLElement>();
    const overlay = document.createElement("div");
    const panel = document.createElement("aside");
    const output = document.createElement("textarea");

    document.documentElement.classList.add("landingLayoutEditing");
    overlay.className = "layoutEditorOverlay";
    panel.className = "layoutEditorPanel";
    panel.innerHTML = [
      "<strong class=\"layoutEditorPanelHandle\">Layout editor</strong>",
      "<span>Drag boxes to move. Pull the corner to scale. Edit text directly.</span>"
    ].join("");
    const savedPanelPosition = loadPanelPosition();
    if (savedPanelPosition) {
      panel.style.left = `${savedPanelPosition.x}px`;
      panel.style.top = `${savedPanelPosition.y}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.textContent = "Reset";
    resetButton.addEventListener("click", () => {
      window.localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    });

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("layout");
      url.searchParams.delete("layoutEditor");
      window.location.href = url.toString();
    });

    const previewLabel = document.createElement("label");
    previewLabel.className = "layoutEditorPreviewToggle";
    const previewToggle = document.createElement("input");
    previewToggle.type = "checkbox";
    previewToggle.checked = window.localStorage.getItem(PREVIEW_STORAGE_KEY) === "1";
    previewToggle.addEventListener("change", () => {
      setPreviewMode(previewToggle.checked);
    });
    previewLabel.append(previewToggle, document.createTextNode(" Preview"));
    setPreviewMode(previewToggle.checked);

    output.className = "layoutEditorOutput";
    output.readOnly = true;
    output.value = formatExport(state);
    panel.append(previewLabel, resetButton, closeButton, output);
    document.body.append(overlay, panel);
    wirePanelDrag(panel);

    const refreshTargets = (): void => {
      document.querySelectorAll<HTMLElement | SVGElement>("[data-layout-item]").forEach((target) => {
        const id = target.dataset.layoutItem;
        if (!id || targets.has(id)) {
          return;
        }

        targets.set(id, target);
        const entry = ensureEntry(state, id);
        if (target instanceof HTMLElement && target.dataset.layoutText !== undefined && !entry.width) {
          entry.width = target.getBoundingClientRect().width;
        }
        applyEntry(target, entry);

        if (target instanceof HTMLElement && target.dataset.layoutText !== undefined) {
          target.contentEditable = "true";
          target.spellcheck = false;
          if (entry.html) {
            target.innerHTML = entry.html;
          }
          target.addEventListener("input", () => {
            ensureEntry(state, id).html = target.innerHTML;
            output.value = formatExport(state);
            saveState(state);
          });
        }

        const box = document.createElement("div");
        box.className = "layoutEditorBox";
        box.dataset.layoutEditorBox = id;
        box.innerHTML = `<span>${id}</span><i aria-hidden="true"></i>`;
        overlay.append(box);
        boxes.set(id, box);
        wireBoxDrag(box, target, id, state, output);
      });
      output.value = formatExport(state);
      saveState(state);
    };

    let frame = 0;
    const updateBoxes = (): void => {
      targets.forEach((target, id) => {
        const box = boxes.get(id);
        if (!box) {
          return;
        }
        const rect = target.getBoundingClientRect();
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
      });
      frame = requestAnimationFrame(updateBoxes);
    };

    refreshTargets();
    const observer = new MutationObserver(refreshTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    frame = requestAnimationFrame(updateBoxes);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      overlay.remove();
      panel.remove();
      document.documentElement.classList.remove("landingLayoutEditing");
      document.documentElement.classList.remove("landingLayoutPreviewing");
      targets.forEach((target) => {
        if (target instanceof HTMLElement && target.dataset.layoutText !== undefined) {
          target.contentEditable = "false";
        }
      });
    };
  }, []);

  return null;
}

function wirePanelDrag(panel: HTMLElement): void {
  const handle = panel.querySelector<HTMLElement>(".layoutEditorPanelHandle");
  if (!handle) {
    return;
  }

  handle.addEventListener("pointerdown", (event) => {
    const rect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;

    handle.setPointerCapture(event.pointerId);
    event.preventDefault();

    const onMove = (moveEvent: PointerEvent): void => {
      const maxLeft = window.innerWidth - rect.width;
      const maxTop = window.innerHeight - rect.height;
      const nextLeft = Math.max(0, Math.min(maxLeft, startLeft + moveEvent.clientX - startX));
      const nextTop = Math.max(0, Math.min(maxTop, startTop + moveEvent.clientY - startY));
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    };

    const onUp = (): void => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      savePanelPosition(panel);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

function wireBoxDrag(
  box: HTMLElement,
  target: HTMLElement | SVGElement,
  id: string,
  state: LayoutState,
  output: HTMLTextAreaElement
): void {
  const onPointerDown = (event: PointerEvent): void => {
    const handle = event.currentTarget instanceof HTMLElement && event.currentTarget.tagName === "I";
    const entry = ensureEntry(state, id);
    const startX = event.clientX;
    const startY = event.clientY;
    const startEntry = { ...entry };
    const startRect = target.getBoundingClientRect();

    box.setPointerCapture(event.pointerId);
    event.preventDefault();

    const onMove = (moveEvent: PointerEvent): void => {
      if (handle) {
        if (target instanceof HTMLElement && target.dataset.layoutText !== undefined) {
          const nextWidth = (startEntry.width ?? startRect.width) + moveEvent.clientX - startX;
          entry.width = Math.max(180, Math.min(900, nextWidth));
          entry.scale = 1;
        } else {
          const delta = Math.max(moveEvent.clientX - startX, moveEvent.clientY - startY);
          entry.scale = Math.max(0.25, Math.min(3, startEntry.scale + delta / Math.max(80, startRect.width)));
        }
      } else {
        entry.x = startEntry.x + moveEvent.clientX - startX;
        entry.y = startEntry.y + moveEvent.clientY - startY;
      }
      applyEntry(target, entry);
      output.value = formatExport(state);
      saveState(state);
    };

    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  box.addEventListener("pointerdown", onPointerDown);
  box.querySelectorAll<HTMLElement>("span, i").forEach((handle) => {
    handle.addEventListener("pointerdown", onPointerDown);
  });

  box.addEventListener("dblclick", () => {
    const resetEntry: LayoutEntry = { x: 0, y: 0, scale: 1 };
    if (target instanceof HTMLElement && target.dataset.layoutText !== undefined) {
      target.style.width = "";
      target.style.maxWidth = "";
      resetEntry.width = target.getBoundingClientRect().width;
    }
    state[id] = resetEntry;
    applyEntry(target, state[id]);
    output.value = formatExport(state);
    saveState(state);
  });
}
