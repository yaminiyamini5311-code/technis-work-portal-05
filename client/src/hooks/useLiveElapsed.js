import { useEffect, useRef, useState } from "react";

/**
 * Live elapsed-time display for a server-owned task session.
 *
 * The SERVER is the source of truth. This hook never counts ticks as time: it
 * stores the offset between the server clock and the client clock once (per
 * fetch) and derives the elapsed seconds from the stored `started_at` plus that
 * offset on every repaint. Consequences:
 *   - a wrong or changing client clock cannot change the displayed duration;
 *   - `setInterval` only repaints the number, it is not the timer;
 *   - navigating away, refreshing or logging out and back in restores the same
 *     value because `startedAt` comes from the API again.
 *
 * @param {string|null} startedAt  server UTC ISO instant
 * @param {string|null} serverNow  server UTC ISO instant captured with startedAt
 * @param {boolean} running        false once the session has been stopped
 * @returns {number} elapsed whole seconds
 */
export default function useLiveElapsed(startedAt, serverNow, running = true) {
  const offsetRef = useRef(0);
  const lastSyncRef = useRef(serverNow);

  // Capture the server/client clock offset exactly once per serverNow value.
  if (serverNow && serverNow !== lastSyncRef.current) {
    const server = new Date(serverNow).getTime();
    offsetRef.current = Number.isNaN(server) ? 0 : server - Date.now();
    lastSyncRef.current = serverNow;
  }

  const compute = () => {
    if (!startedAt) return 0;
    const start = new Date(startedAt).getTime();
    if (Number.isNaN(start)) return 0;
    return Math.max(0, Math.floor((Date.now() + offsetRef.current - start) / 1000));
  };

  const [elapsed, setElapsed] = useState(compute);

  useEffect(() => {
    setElapsed(compute());
    // A stopped session is a fixed value: no interval needed.
    if (!running || !startedAt) return undefined;
    const id = setInterval(() => setElapsed(compute()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, serverNow, running]);

  return elapsed;
}
