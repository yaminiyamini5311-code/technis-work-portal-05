/**
 * CeoStars — subtle, professional starfield for the CEO Workspace.
 *
 * Pure CSS: two oversized layers of tiny radial-gradient dots over the
 * existing dark gradients. Twinkle (opacity) + slow drift (transform) run
 * on the compositor; no canvas, no JS per frame, no new dependencies.
 * Mounted once in RoleLayout for the CEO workspace only, so it never
 * duplicates or restarts on navigation. Static under
 * prefers-reduced-motion.
 */
export default function CeoStars() {
  return (
    <div className="ceo-stars" aria-hidden="true">
      <i className="ceo-stars-layer ceo-stars-far" />
      <i className="ceo-stars-layer ceo-stars-near" />
    </div>
  );
}
