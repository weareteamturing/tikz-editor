import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR ?? ".vite-temp",
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node"
  },
  resolve: {
    alias: {
      // Mirror the Vite alias so tests can import from "tikz-editor/..."
      "tikz-editor": path.resolve(rootDir, "./packages/core/src")
    }
  }
});
