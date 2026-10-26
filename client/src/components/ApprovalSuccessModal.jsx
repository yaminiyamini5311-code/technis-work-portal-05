import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./ApprovalSuccessModal.css";

/**
 * Approval success modal with celebration effect.
 * Shows the approval date and time from the server's reviewed_at timestamp.
 * Auto-dismisses after 4 seconds, can be manually closed, and respects prefers-reduced-motion.
 */
export default function ApprovalSuccessModal({ open, reviewedAt, onClose }) {
  const [host, setHost] = useState(null);
  const [isVisible, setIsVisible] = useState(false);

  // Create portal host
  useEffect(() => {
    if (!open) return undefined;
    const node = document.createElement("div");
    node.setAttribute("data-approval-success-modal", "");
    document.body.appendChild(node);
    setHost(node);
    // Trigger entrance animation
    requestAnimationFrame(() => setIsVisible(true));
    return () => {
      node.remove();
      setHost(null);
      setIsVisible(false);
    };
  }, [open]);

  // Auto-dismiss after 4 seconds
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => {
      handleClose();
    }, 4000);
    return () => clearTimeout(timer);
  }, [open, onClose]);

  function handleClose() {
    setIsVisible(false);
    // Wait for exit animation before calling onClose
    setTimeout(() => {
      onClose?.();
    }, 300);
  }

  if (!open || !host) return null;

  // Format the date/time from server's reviewed_at
  let formattedDateTime = "Just now";
  if (reviewedAt) {
    try {
      const date = new Date(reviewedAt);
      if (!isNaN(date.getTime())) {
        formattedDateTime = new Intl.DateTimeFormat(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }).format(date);
      }
    } catch {}
  }

  return createPortal(
    <div className={`approval-success-backdrop ${isVisible ? "visible" : ""}`}>
      <div className={`approval-success-modal ${isVisible ? "visible" : ""}`} role="dialog" aria-modal="true" aria-labelledby="approval-success-title">
        <div className="approval-success-content">
          <div className="approval-success-icon" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="3" />
              <path d="M14 24L20 30L34 16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 id="approval-success-title" className="approval-success-title">Approval Successful!</h2>
          <p className="approval-success-datetime">{formattedDateTime}</p>
          <button type="button" className="approval-success-close" onClick={handleClose} aria-label="Close">
            Close
          </button>
        </div>
        <div className="approval-success-confetti" aria-hidden="true"></div>
      </div>
    </div>,
    host
  );
}
