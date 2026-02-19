import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node"
  },
  resolve: {
    alias: {
      // Mirror the Vite alias so tests can import from "tikz-editor/..."
      "tikz-editor": path.resolve(__dirname, "./src")
    }
  }
});
