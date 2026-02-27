import { describe, expect, it } from "vitest";
import { APP_MENU_COMMAND_IDS, APP_MENU_DEFINITION } from "../src/app-menu/index.js";

describe("app menu definition", () => {
  it("defines an open-example command id", () => {
    expect(APP_MENU_COMMAND_IDS.OPEN_EXAMPLE).toBe("file.open-example");
  });

  it("exposes Open Example in the File menu", () => {
    const fileSection = APP_MENU_DEFINITION.find((section) => section.id === "file");
    expect(fileSection).toBeDefined();
    const items = fileSection?.items ?? [];
    const commandItem = items.find(
      (item) => item.kind === "command" && item.commandId === APP_MENU_COMMAND_IDS.OPEN_EXAMPLE
    );
    expect(commandItem).toBeDefined();
    if (!commandItem || commandItem.kind !== "command") {
      throw new Error("Expected file.open-example command item in File menu.");
    }
    expect(commandItem.label).toBe("Open Example...");
  });
});
