// frontend/src/context/SocketContext.jsx
import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import useAuth from '../hooks/useAuth';

const SocketContext = createContext({ socket: null, connected: false });

// The socket server is the API server: VITE_SOCKET_URL, else the origin of VITE_API_URL
// (so a missing / misspelt VITE_SOCKET_URL can't point live updates at the wrong port)
const apiOrigin = (() => {
  try { return new URL(import.meta.env.VITE_API_URL).origin; } catch { return null; }
})();
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || apiOrigin || window.location.origin;

export function SocketProvider({ children }) {
  const { isAuthenticated, token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null); // keep a ref too for cleanup

  useEffect(() => {
    // Disconnect if user logs out or token disappears
    if (!isAuthenticated || !token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
        setConnected(false);
      }
      return;
    }

    // Create socket connection with JWT token in handshake
    const newSocket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socketRef.current = newSocket;
    setSocket(newSocket); // ← triggers re-render so children get the socket

    newSocket.on('connect', () => {
      
      setConnected(true);
    });

    newSocket.on('disconnect', (reason) => {
   
      setConnected(false);
    });

    newSocket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });

    return () => {
      newSocket.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [isAuthenticated, token]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
