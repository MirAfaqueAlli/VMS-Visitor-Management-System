// frontend/src/components/RouteError.jsx
// The router's error page (instead of "Unexpected Application Error"). A missing
// build file after a deployment reloads the app once for the new version; anything
// else gets a plain message with Reload / Dashboard.
import { useEffect, useState } from "react";
import { useRouteError } from "react-router-dom";
import { AlertTriangle, RefreshCw, Loader2 } from "./icons";
import { isChunkError, reloadForNewVersion } from "../lib/chunkReload";

export default function RouteError() {
  const error = useRouteError();
  const newVersion = isChunkError(error);
  // Reload once for the new version; if that already happened just now, show the page instead
  const [reloading] = useState(() => newVersion && reloadForNewVersion());

  useEffect(() => {
    if (!newVersion) console.error("[RouteError]", error);
  }, [error, newVersion]);

  if (reloading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-ink-2" role="status">
        <Loader2 size={22} className="animate-spin text-primary-strong" />
        <p className="text-[13px]">Updating to the latest version of VMS…</p>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6">
      <div className="max-w-[440px] text-center">
        <span className="empty-icon mx-auto"><AlertTriangle size={22} duo /></span>
        <h1 className="text-[17px] font-semibold text-ink">
          {newVersion ? "A new version of VMS is available" : "Something went wrong"}
        </h1>
        <p className="mt-1.5 text-[12.5px] text-ink-2">
          {newVersion
            ? "This page was opened before the update. Reload to continue — nothing you saved is lost."
            : "This page hit an unexpected problem. Reload to try again, or go back to the dashboard."}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> Reload
          </button>
          <button type="button" className="btn-outline" onClick={() => window.location.assign("/dashboard")}>
            Go to the dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
