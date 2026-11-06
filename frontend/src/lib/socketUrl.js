// frontend/src/lib/socketUrl.js
// The socket server is the API server: VITE_SOCKET_URL, else the origin of VITE_API_URL
// (so a missing / misspelt VITE_SOCKET_URL can't point live updates at the wrong port).
// Used by the staff app (context/SocketContext) and the visitor portal (hooks/useVisitorLive).
const apiOrigin = (() => {
  try { return new URL(import.meta.env.VITE_API_URL).origin; } catch { return null; }
})();

export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || apiOrigin || window.location.origin;
