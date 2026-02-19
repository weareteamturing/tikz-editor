import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  base: "https://tikz.dev/edit/",
  plugins: [react()],
  resolve: {
    alias: {
      "tikz-editor": path.resolve(__dirname, "../src"),
    },
  },
});
