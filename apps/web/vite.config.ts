import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const profilingBuild = process.env.TIKZ_PROFILE_BUILD === "1";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/editor/web/" : "/",
  plugins: [react()],
  publicDir: path.resolve(__dirname, "../../packages/app/public"),
  worker: {
    format: "es"
  },
  optimizeDeps: {
    exclude: ["mathlive"]
  },
  resolve: {
    alias: {
      "tikz-editor": path.resolve(__dirname, "../../packages/core/src"),
    },
  },
  esbuild: profilingBuild
    ? { minifyIdentifiers: false, keepNames: true }
    : undefined,
  // Content-Security-Policy should be configured at the production web server level:
  //   Content-Security-Policy: script-src 'self'
  // This blocks any inline event handlers that could be embedded in TikZ-generated SVG.
  // It is not set here because Vite's dev server injects inline scripts for React Refresh.
}));
