// frontend/src/lib/chunkReload.js
// After a new version is deployed, a tab still running the old one asks for page
// files (e.g. /assets/Dashboard-D51g5sE.js) that the new build replaced. Instead of
// "Failed to fetch dynamically imported module", the app reloads once to pick up the
// new version. At most once a minute, so a real outage can't cause a reload loop.
import { lazy } from "react";

const KEY = "vms-version-reload-at";

/** True for the browser errors a missing / replaced build file causes. */
export const isChunkError = (err) =>
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (CSS )?chunk [\w-]+ failed|Unable to preload CSS/i
    .test(String(err?.message || err || ""));

/** Reloads the page for the new version. False when it already did so in the last minute. */
export function reloadForNewVersion() {
  let last = 0;
  try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* storage blocked */ }
  if (Date.now() - last < 60_000) return false;
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
  window.location.reload();
  return true;
}

/** React.lazy that reloads for the new version when the page's file is gone. */
export const lazyWithReload = (factory) => lazy(() => factory().catch((err) => {
  if (isChunkError(err) && reloadForNewVersion()) return new Promise(() => {});   // the page is reloading
  throw err;
}));

/** import() for libraries loaded on demand (xlsx, jspdf…) — same recovery. */
export const importWithReload = (factory) => factory().catch((err) => {
  if (isChunkError(err)) reloadForNewVersion();
  throw err;
});
