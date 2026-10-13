import { useEffect } from "react";

/**
 * useCeoReveal — drives the CEO Portal's entrance motion.
 *
 * Design constraints (deliberate):
 *  - One IntersectionObserver + one MutationObserver for the whole portal, so
 *    there is no per-component init and no duplicated work.
 *  - An element is revealed at most once: we `unobserve` the moment it gets
 *    `.ceo-in`, so data refreshes and re-renders never re-trigger entrances.
 *  - Nothing is hidden until this hook confirms it is running. The hidden
 *    state is keyed off `.ceo-motion-ready` on the root, so if JS is slow or
 *    absent the portal renders fully visible instead of blank.
 *  - Under `prefers-reduced-motion` the hook only marks elements visible and
 *    does not install observers at all.
 *
 * @param {React.RefObject} rootRef  Ref to the `.role-layout.ceo-dark` node.
 */

// Variant groups: selector first match wins, so order matters (specific
// containers before generic cards). The CEO portal uses the defaults;
// the manager portal passes its own config (same class machinery, scoped
// by `.manager-motion` in ManagerMotion.css instead of `.ceo-dark`).
const DEFAULT_GROUPS = [
  { variant: "row",    sel: ".pending-registration-item, .submission-row, .list-row, .audit-table tbody tr, .table-wrap tbody tr" },
  { variant: "tile",   sel: ".admin-stat, .performance-card" },
  { variant: "head",   sel: ".simple-head, .audit-header, .panel-head, .section-kicker, .page-label, .profile-identity-card" },
  { variant: "panel",  sel: ".panel, .summary-card, .mission-card, .task-card, .detail-card, .profile-details-card, .audit-filters, .audit-tabs" },
];

// Containers whose children cascade in with a stagger, mirroring the way the
// reference's ranking list and stat row build one item after another.
const DEFAULT_STAGGER_PARENTS = [
  ".admin-stat-grid",
  ".pending-registrations-list",
  ".submission-list",
  ".audit-table tbody",
  ".table-wrap tbody",
  ".mission-admin-grid",
  ".performance-admin-grid",
  ".quick-actions",
];

/* Manager-portal variant: same reveal machinery, matched to the manager's
   light-theme markup (manager stats, monitor rows, task tables). */
export const MANAGER_REVEAL_CONFIG = {
  groups: [
    { variant: "row",   sel: ".submission-manager, .manager-stats + .panel tbody tr, .table-wrap tbody tr, .activity-admin" },
    { variant: "tile",  sel: ".admin-stat, .manager-stats > div, .performance-card" },
    { variant: "head",  sel: ".simple-head, .panel-head, .section-kicker" },
    { variant: "panel", sel: ".panel, .summary-card, .mission-card, .task-card, .detail-card" },
  ],
  staggerParents: [
    ".admin-stat-grid",
    ".manager-stats",
    ".submission-list",
    ".table-wrap tbody",
    ".quick-actions",
  ],
};

const MAX_STAGGER = 10;

function classify(groups, el) {
  for (const g of groups) {
    if (el.matches(g.sel)) return g.variant;
  }
  return "panel";
}

export default function useCeoReveal(rootRef, config) {
  useEffect(() => {
    const root = rootRef?.current;
    if (!root) return undefined;

    const groups = config?.groups || DEFAULT_GROUPS;
    const staggerParents = config?.staggerParents || DEFAULT_STAGGER_PARENTS;

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      // No observers, no hidden state. Everything simply renders.
      return undefined;
    }

    // Only now do we opt into hidden-until-revealed. Safe by construction.
    root.classList.add("ceo-motion-ready");

    const seen = new WeakSet();

    // Safety net: reveal anything already inside the viewport right now,
    // synchronously. IntersectionObserver does not reliably deliver for a
    // hidden/throttled tab, and a missed callback would otherwise leave
    // content stuck at opacity 0 — unacceptable for a data portal. This keeps
    // IO responsible only for *scroll* reveals below the fold.
    const revealIfVisible = (el) => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (r.top < vh && r.bottom > 0) {
        el.classList.add("ceo-in");
        return true;
      }
      return false;
    };

    let io = null;

    const collect = () => {
      // Stagger indices are assigned once per parent, before observation.
      for (const parentSel of staggerParents) {
        root.querySelectorAll(parentSel).forEach((parent) => {
          Array.from(parent.children).forEach((child, i) => {
            child.style.setProperty("--ceo-i", String(Math.min(i, MAX_STAGGER)));
          });
        });
      }

      const targets = new Set();
      for (const g of groups) {
        root.querySelectorAll(g.sel).forEach((el) => targets.add(el));
      }

      targets.forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        el.classList.add(`ceo-r-${classify(groups, el)}`);
        // Already on screen -> reveal now (stagger still applies via CSS delay).
        if (revealIfVisible(el)) return;
        io?.observe(el);
      });
    };

    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("ceo-in");
          io.unobserve(entry.target); // reveal exactly once
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.05 }
    );

    collect();

    // React swaps nodes when data arrives or the route changes; pick up only
    // the ones we have not already handled.
    //
    // Deliberately NOT gated behind requestAnimationFrame: rAF does not fire
    // in hidden/throttled tabs, so any content that mounted while the tab was
    // in the background would never be classified and would never animate.
    // MutationObserver already batches its callbacks into a microtask, and
    // `collect()` is cheap (a WeakSet guards re-work), so calling it directly
    // is both safe and correct in every tab state.
    //
    // Note: only `childList` is observed — the class/style writes done by
    // `collect()` are attribute mutations, so this cannot re-enter itself.
    const mo = new MutationObserver(collect);
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      io.disconnect();
      root.classList.remove("ceo-motion-ready");
    };
  }, [rootRef, config]);
}
