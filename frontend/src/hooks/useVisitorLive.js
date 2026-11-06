// frontend/src/hooks/useVisitorLive.js
// Visitor portal live updates: a socket signed in with the visitor session. The server
// sends 'visitor:visit:changed' when one of their visits changes (submitted, approved,
// declined, cancelled, checked in / out — socketManager.emitToVisitorPhone).
// onChange(data) gets { title, body, tag, visit_request_id }, or null after a reconnect
// (something may have been missed — reload).
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../lib/socketUrl';
import { getVisitorSession } from '../lib/visitorPortal';

export default function useVisitorLive(onChange) {
  const handler = useRef(onChange);
  useEffect(() => { handler.current = onChange; });

  useEffect(() => {
    const session = getVisitorSession();
    if (!session) return undefined;
    const socket = io(SOCKET_URL, {
      auth: { visitorSession: session },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 2000,
    });
    let dropped = false;
    socket.on('visitor:visit:changed', (data) => handler.current?.(data || {}));
    socket.on('disconnect', () => { dropped = true; });
    socket.on('connect', () => {
      if (dropped) handler.current?.(null);
      dropped = false;
    });
    socket.on('connect_error', (err) => console.warn('[Portal live] connection error:', err.message));
    return () => socket.disconnect();
  }, []);
}
