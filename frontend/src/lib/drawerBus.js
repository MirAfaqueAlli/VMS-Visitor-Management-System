// frontend/src/lib/drawerBus.js
// Counts open side drawers so the sidebar can fold to its rail while any drawer
// is open and come back when the last one closes (DESIGN_RULES §5 auto-fold).
let openCount = 0;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(openCount > 0));

export const drawerOpened = () => { openCount += 1; emit(); };
export const drawerClosed = () => { openCount = Math.max(0, openCount - 1); emit(); };
export const anyDrawerOpen = () => openCount > 0;

/** @param {(open: boolean) => void} fn  @returns {() => void} unsubscribe */
export const onDrawerChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
