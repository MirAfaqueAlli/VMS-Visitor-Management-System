// frontend/src/hooks/useCountdown.js
import { useState, useRef, useCallback, useEffect } from 'react';

const OTP_COOLDOWN = 20; // seconds before an OTP can be resent

/** Seconds-remaining countdown, e.g. for "Resend (20s)". start() restarts it. */
export default function useCountdown(initial = 0, defaultCooldown = OTP_COOLDOWN) {
  const [count, setCount] = useState(initial);
  const ref = useRef(null);

  const start = useCallback((from = defaultCooldown) => {
    clearInterval(ref.current);
    setCount(from);
    ref.current = setInterval(() => {
      setCount(c => {
        if (c <= 1) { clearInterval(ref.current); return 0; }
        return c - 1;
      });
    }, 1000);
  }, [defaultCooldown]);

  useEffect(() => () => clearInterval(ref.current), []);
  return { count, start };
}
