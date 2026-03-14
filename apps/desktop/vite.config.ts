import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "tikz-editor": path.resolve(__dirname, "../../packages/core/src")
    }
  },
  clearScreen: false,
  server: {
    host: host || false,
    port: 1420,
    strictPort: true
  },
  envPrefix: ["VITE_", "TAURI_"],
  worker: {
    format: "es"
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG
  }
});
