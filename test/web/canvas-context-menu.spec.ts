/** @vitest-environment jsdom */

import React, { createRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APP_MENU_COMMAND_IDS } from "../../packages/app/src/app-menu/index.js";
import { CanvasContextMenu } from "../../packages/app/src/ui/CanvasContextMenu.js";
import type { CommandBindings } from "../../packages/app/src/ui/editor-command-runtime.js";

describe("CanvasContextMenu", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: 600 });
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.restoreAllMocks();
  });

  it("hides Flatten foreach in context menus when the command is disabled", () => {
    const bindings = makeBindings();
    bindings[APP_MENU_COMMAND_IDS.FLATTEN_FOREACH] = {
      enabled: false,
      run: () => undefined
    };

    renderMenu(bindings);

    expect(host.textContent).not.toContain("Flatten foreach");
    expect(host.querySelector(`[data-testid="canvas-context-cmd-${APP_MENU_COMMAND_IDS.FLATTEN_FOREACH}"]`)).toBeNull();
  });

  it("shows Flatten foreach in context menus when the command is enabled", () => {
    const bindings = makeBindings();
    bindings[APP_MENU_COMMAND_IDS.FLATTEN_FOREACH] = {
      enabled: true,
      run: () => undefined
    };

    renderMenu(bindings);

    expect(host.textContent).toContain("Flatten foreach");
    expect(host.querySelector(`[data-testid="canvas-context-cmd-${APP_MENU_COMMAND_IDS.FLATTEN_FOREACH}"]`)).not.toBeNull();
  });

  function renderMenu(bindings: CommandBindings): void {
    const containerRef = createRef<HTMLElement | null>();
    containerRef.current = host;
    act(() => {
      root.render(
        React.createElement(CanvasContextMenu, {
          open: true,
          anchor: { x: 20, y: 20 },
          target: "selection-single",
          bindings,
          onClose: () => undefined,
          onCommandRun: () => undefined,
          containerRef
        })
      );
    });
  }
});

function makeBindings(): CommandBindings {
  return Object.fromEntries(
    Object.values(APP_MENU_COMMAND_IDS).map((commandId) => [
      commandId,
      {
        enabled: true,
        run: () => undefined
      }
    ])
  ) as unknown as CommandBindings;
}
