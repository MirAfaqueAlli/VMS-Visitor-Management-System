// frontend/src/hooks/useSocketEvent.js
import { useEffect } from 'react';
import { useSocket } from '../context/SocketContext';

/**
 * useSocketEvent(event, handler, deps)
 * Subscribes to a socket event and cleans up on unmount or dependency change.
 *
 * @param {string}   event   - Socket event name (e.g. 'visit:request:new')
 * @param {function} handler - Callback (payload) => void
 * @param {Array}    deps    - Additional dependencies for the handler (default [])
 */
export default function useSocketEvent(event, handler, deps = []) {
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket || !event) return;

    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, event, ...deps]);
}
