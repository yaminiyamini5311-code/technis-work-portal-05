import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./ApprovalSuccess.css";

/**
 * Centered "Approval Successful!" popup with a CSS confetti burst.
 *
 * Props:
 *   show        – render the popup (should be true only after a 2xx approval)
 *   submissionCode – optional subtitle, e.g. "SUB-2026-00065"
 *   onDismiss   – called when the popup closes (timer or close button)
 *
 * Auto-dismisses after 3.5 seconds. All timers are cleaned up on unmount.
 * Respects prefers-reduced-motion via CSS (confetti hidden, no scale animation).
 */
const CONFETTI_COUNT = 30;
const AUTO_DISMISS_MS = 3500;

export default function ApprovalSuccess({ show, submissionCode, onDismiss }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!show) return;
    timerRef.current = setTimeout(() => {
      onDismiss?.();
    }, AUTO_DISMISS_MS);
    return () => { clearTimeout(timerRef.current); };
  }, [show, onDismiss]);

  if (!show) return null;

  const confetti = Array.from({ length: CONFETTI_COUNT }, (_, i) => (
    <span key={i} />
  ));

  return createPortal(
    <>
      <div className="confetti-container" aria-hidden="true">{confetti}</div>
      <div className="approval-success-overlay" role="alert" aria-live="assertive">
        <div className="approval-success-card">
          <button
            type="button"
            className="asc-close"
            onClick={() => { clearTimeout(timerRef.current); onDismiss?.(); }}
            aria-label="Close"
          >
            ×
          </button>
          <div className="asc-check" aria-hidden="true">✓</div>
          <h2>Approval Successful!</h2>
          {submissionCode && <p className="asc-sub">{submissionCode}</p>}
        </div>
      </div>
    </>,
    document.body,
  );
}
