import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./FixedOverlay.css";

/**
 * A full-screen overlay rendered into `document.body` through a React portal.
 *
 * Why a portal: an ancestor with `transform`, `perspective`, `filter`,
 * `backdrop-filter`, `contain` or `will-change` becomes the containing block
 * for its `position: fixed` descendants. This app animates `.role-content`
 * and `.student-content` with a 3D page-entry transition, so every modal
 * written as `<div class="review-modal">position:fixed; inset:0</div>` inside
 * the page content was being sized and positioned against the scrolling page
 * instead of the viewport — the overlay ended up several thousand pixels tall,
 * vertically centred inside the page, and cut off below the fold.
 *
 * Rendering into `document.body` puts the overlay outside every one of those
 * containing blocks, so `inset: 0` means the viewport again. This is the
 * structural fix; stacking more CSS on top of the broken markup would only
 * have hidden it.
 *
 * It also owns the two behaviours every modal in the app was missing:
 *   • body scroll lock while open, with the scroll position restored on close
 *   • Escape to close, and focus moved into the dialog and returned on close
 */
export default function FixedOverlay({
  open,
  onClose,
  children,
  label,
  className = "",
  zIndex = 1000,
  closeOnBackdrop = true,
  /** Rendered by FixedOverlay itself; receives the backdrop click. */
  panelClassName = "",
}) {
  const hostRef = useRef(null);
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);
  const [host, setHost] = useState(null);

  // A detached <div> created once per open. Using a node rather than
  // document.body directly keeps this component's DOM out of the app tree,
  // so nothing inside can be selected by a parent's ref or query.
  useEffect(() => {
    if (!open) return undefined;
    const node = document.createElement("div");
    node.setAttribute("data-fixed-overlay", "");
    document.body.appendChild(node);
    hostRef.current = node;
    setHost(node);

    // Scroll lock: compensate for the scrollbar so the page does not jump.
    const scrollY = window.scrollY;
    restoreRef.current = { overflow: document.body.style.overflow, paddingRight: document.body.style.paddingRight, scrollY };
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gutter > 0) document.body.style.paddingRight = `${gutter}px`;

    return () => {
      document.body.style.overflow = restoreRef.current?.overflow ?? "";
      document.body.style.paddingRight = restoreRef.current?.paddingRight ?? "";
      // Restore the exact scroll position the user was at.
      const y = restoreRef.current?.scrollY;
      if (typeof y === "number") window.scrollTo(0, y);
      node.remove();
      hostRef.current = null;
      setHost(null);
    };
  }, [open]);

  // Escape to close, and focus the dialog once it exists.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener("keydown", onKey);
    const focusTarget = dialogRef.current;
    if (focusTarget) {
      const previous = document.activeElement;
      // Prioritize [data-autofocus] first, then fall back to focusable elements
      const autofocus = focusTarget.querySelector("[data-autofocus]");
      const first = autofocus || focusTarget.querySelector("button, [href], input, select, textarea");
      (first || focusTarget).focus?.({ preventScroll: true });
      return () => {
        document.removeEventListener("keydown", onKey);
        if (previous instanceof HTMLElement) previous.focus?.({ preventScroll: true });
      };
    }
    return () => document.removeEventListener("keydown", onKey);
  }, [open, host]); // Removed onClose from dependencies since it's captured in closure

  if (!open || !host) return null;

  return createPortal(
    <div
      className={`fixed-overlay ${className}`.trim()}
      style={{ zIndex }}
      onClick={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={dialogRef}
      >
        {children}
      </div>
    </div>,
    host,
  );
}