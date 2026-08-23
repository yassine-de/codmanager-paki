import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const CHUNK_RELOAD_KEY = "codmanager_chunk_reload_at";
const CHUNK_RELOAD_COOLDOWN_MS = 30_000;

function isChunkLoadError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(message);
}

function reloadOnceForNewDeployment() {
  const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
  if (Date.now() - lastReload < CHUNK_RELOAD_COOLDOWN_MS) return;

  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  window.location.reload();
}

window.addEventListener("error", (event) => {
  if (isChunkLoadError(event.error || event.message)) {
    reloadOnceForNewDeployment();
  }
});

window.addEventListener("unhandledrejection", (event) => {
  if (isChunkLoadError(event.reason)) {
    reloadOnceForNewDeployment();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
