import { describe, expect, it } from "vitest";
import { APP_MENU_DEFINITION, filterAppMenuDefinitionForTarget } from "../packages/app/src/app-menu/index.js";

describe("app menu platform visibility", () => {
  it("hides desktop-only menu items on web", () => {
    const webDefinition = filterAppMenuDefinitionForTarget(APP_MENU_DEFINITION, "web");
    const fileSection = webDefinition.find((section) => section.id === "file");
    expect(fileSection).toBeDefined();
    const hasRecentFiles = fileSection?.items.some((item) => item.kind === "recent-files");
    expect(hasRecentFiles).toBe(false);
  });

  it("keeps Open Recent on desktop", () => {
    const desktopDefinition = filterAppMenuDefinitionForTarget(APP_MENU_DEFINITION, "desktop");
    const fileSection = desktopDefinition.find((section) => section.id === "file");
    expect(fileSection).toBeDefined();
    const recentFilesItem = fileSection?.items.find((item) => item.kind === "recent-files");
    expect(recentFilesItem).toBeDefined();
    if (!recentFilesItem || recentFilesItem.kind !== "recent-files") {
      throw new Error("Expected desktop menu to include recent-files item.");
    }
    expect(recentFilesItem.label).toBe("Open Recent");
  });

  it("normalizes separators after platform filtering", () => {
    const definition = filterAppMenuDefinitionForTarget(
      [
        {
          id: "file",
          label: "File",
          items: [
            { kind: "separator", platforms: ["desktop"] },
            { kind: "separator" },
            { kind: "command", commandId: "file.new-document", label: "New" },
            { kind: "separator", platforms: ["desktop"] },
            { kind: "separator" }
          ]
        }
      ],
      "web"
    );
    const items = definition[0]?.items ?? [];
    expect(items.length).toBe(1);
    expect(items[0]?.kind).toBe("command");
  });
});
