import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR ?? ".vite-temp",
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.types.ts",
        "**/types.ts",
        "**/vite-env.d.ts",
        "**/generated/**",
        "**/generated-*.ts",
        "packages/core/src/syntax/grammar/**"
      ]
    }
  },
  resolve: {
    alias: {
      // Mirror the Vite alias so tests can import from "tikz-editor/..."
      "tikz-editor": path.resolve(rootDir, "./packages/core/src")
    }
  }
});
