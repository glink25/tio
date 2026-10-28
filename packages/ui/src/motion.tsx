import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** Shared timings for CSS and the editor's Floating UI adapters. */
export const motion = { floating: { open: 140, close: 100 }, panel: { open: 200, close: 160 } };
const OverlayOpenContext = createContext(true);
export const useOverlayOpen = () => useContext(OverlayOpenContext);

export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** Keep the last open render while Radix plays its exit animation.
 * Place outside the conditional, including outside a dialog's business component,
 * so closing IDs and drafts cannot blank its final frame. Unmounting the owner
 * (for example on a workspace switch) still releases everything immediately.
 */
export function OverlayPresence({ children }: { children: ReactNode }) {
  const parentOpen = useOverlayOpen();
  const open = parentOpen && !!children;
  const [last, setLast] = useState(open ? children : null);
  const reduced = useReducedMotion();
  if (open && last !== children) setLast(children);
  useEffect(() => {
    if (open) return;
    if (reduced) {
      setLast(null);
      return;
    }
    const timeout = setTimeout(() => setLast(null), motion.panel.close);
    return () => clearTimeout(timeout);
  }, [open, reduced]);
  return (
    <OverlayOpenContext.Provider value={open}>{open ? children : last}</OverlayOpenContext.Provider>
  );
}
