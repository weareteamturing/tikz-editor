import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, setActiveEditorPlatform } from "@tikz-editor/app";
import { createBrowserPlatformAdapter } from "./platform/browser-platform";

setActiveEditorPlatform(createBrowserPlatformAdapter());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
