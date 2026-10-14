import { useEffect, useRef } from "react";

/**
 * useModalBehavior — shared dialog behavior for every modal in the app.
 *
 * Provides, when `active` is true:
 *  - Escape closes the dialog
 *  - a pointer-down outside the dialog panel closes it
 *  - focus moves into the dialog on open and is restored to the previously
 *    focused element on close
 *  - Tab focus cycles inside the dialog (focus trap)
 *  - body scroll is locked while open and the previous value restored
 *
 * Usage:
 *   const dialogRef = useModalBehavior(active, onClose);
 *   <div className="review-modal" ref={dialogRef}> ... panel ... </div>
 *
 * The ref must sit on the element that represents the whole dialog
 * (usually the overlay). The focusable content can be anywhere inside it.
 */
export default function useModalBehavior(active, onClose) {
  const ref = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    // Remember the trigger so focus can return to it on close.
    restoreRef.current = document.activeElement;

    const node = ref.current;
    const focusables = () =>
      Array.from(
        node?.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Move focus into the dialog.
    const first = focusables()[0];
    if (first) first.focus();
    else node?.focus?.();

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;
      // Focus trap: cycle within the dialog.
      const items = focusables();
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    const onPointerDown = (e) => {
      // Outside click closes. Ignore clicks inside the dialog subtree.
      if (node && !node.contains(e.target)) onClose?.();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.body.style.overflow = prevOverflow;
      // Restore focus to whatever opened the dialog.
      const restore = restoreRef.current;
      if (restore && typeof restore.focus === "function") restore.focus();
    };
  }, [active, onClose]);

  return ref;
}
