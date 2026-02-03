import React from "react";
import ReactDOM from "react-dom/client";
import WorkspaceShell from "./WorkspaceShell";
import "./styles.css";

// Prevent accidental reload of the renderer window (Ctrl+R / F5) which can desync UI state from BrowserViews.
// Use the active workspace tab reload instead.
window.addEventListener(
  "keydown",
  (event) => {
    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    const ctrlOrMeta = event.ctrlKey || event.metaKey;
    if ((ctrlOrMeta && key === "r") || key === "f5") {
      event.preventDefault();
      void window.desktop?.workspace?.reloadActive?.().catch(() => void 0);
    }
  },
  { capture: true }
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkspaceShell />
  </React.StrictMode>
);
