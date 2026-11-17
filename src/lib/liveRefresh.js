// Keeping a screen honest when the socket cannot be trusted to arrive.
//
// A socket message is the fastest way to learn that a booking request changed,
// and it is not the only way this portal learns it. A phone that was asleep, a
// proxy that dropped the connection, a browser that suspended the tab — all of
// them mean the message was sent to nobody, and a card that keeps counting down
// a request somebody already answered is worse than a card that is five seconds
// behind. So every screen that shows a live request also:
//
//   · polls while it is open — fast (5 s) while a request is genuinely waiting
//     on an answer, slowly (20–30 s) once there is nothing to watch;
//   · re-reads the moment the tab comes back into view, gets focus, or the
//     network returns.
//
// Neither replaces the socket: both are the floor under it.
import { useEffect } from 'react';

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/**
 * Run `callback` when the tab is shown again, focused, or comes back online.
 * Returns the cleanup function, so it can be returned straight from a
 * `useEffect`.
 */
export function refreshWhenVisible(callback) {
  if (typeof window === 'undefined') return () => {};
  const run = () => {
    // `focus` also fires for a window that is behind another one on a desktop;
    // a hidden tab has nothing to repaint, so it waits for `visibilitychange`.
    if (!isVisible()) return;
    callback();
  };
  document.addEventListener('visibilitychange', run);
  window.addEventListener('focus', run);
  window.addEventListener('online', run);
  return () => {
    document.removeEventListener('visibilitychange', run);
    window.removeEventListener('focus', run);
    window.removeEventListener('online', run);
  };
}

/**
 * Poll a loader on an adaptive interval: `active` while something on the screen
 * is still waiting on the server, `idle` otherwise.
 *
 * The loader receives `{ quiet: true }` — the refresh must not flash a skeleton
 * over a list the person is reading.
 */
export function useAdaptiveRefresh(load, isActive, { active = 5000, idle = 20000 } = {}) {
  useEffect(() => {
    if (typeof load !== 'function') return undefined;
    const timer = window.setInterval(() => load({ quiet: true }), isActive ? active : idle);
    return () => window.clearInterval(timer);
  }, [active, idle, isActive, load]);
}
