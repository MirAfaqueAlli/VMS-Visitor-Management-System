import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { reloadForNewVersion } from "./lib/chunkReload";

// A file of the previous build couldn't be preloaded (a new version was deployed):
// reload once for the new version instead of failing the page
window.addEventListener("vite:preloadError", (event) => {
  if (reloadForNewVersion()) event.preventDefault();
});

createRoot(document.getElementById("root")).render(
 <StrictMode>
 <App />
 </StrictMode>,
);
