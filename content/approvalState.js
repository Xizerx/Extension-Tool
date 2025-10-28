// approvalState.js
// Single source of truth for approval state on a line-item root.
// States are frozen per-RO load, and only unfrozen when the URL changes (handled by hoverTracker).

window.AIExt = window.AIExt || {};

(function () {
  const RED_CLASS = "css-c0ldmm";     // unapproved (class marker)
  const GREEN_CLASS = "css-19gb4yf";  // approved  (class marker)

  const FROZEN_ATTR = "data-approval-state-frozen";
  const LIVE_ATTR = "data-approval-state";

  const Approval = Object.freeze({
    APPROVED: "approved",
    UNAPPROVED: "unapproved",
    REMOVED: "removed",   // <-- NEW state; detected via text only
    UNKNOWN: "unknown",
  });

  // Must be `let` so we can replace it (WeakMap has no .clear()).
  let stateCache = new WeakMap();

  /** Pure DOM detector (no cache, no freezing). */
  function detectApprovalFromDOM(root) {
    if (!root) return Approval.UNKNOWN;

    // Fast path via known class markers (approved/unapproved only)
    if (root.querySelector(`.${RED_CLASS}`)) return Approval.UNAPPROVED;
    if (root.querySelector(`.${GREEN_CLASS}`)) return Approval.APPROVED;

    // Fallback via text under "Authorization Status"
    const statusNode = Array.from(root.querySelectorAll("*"))
      .find(el => /authorization\s*status/i.test(el.textContent || ""));
    if (statusNode) {
      const txt = (statusNode.textContent || "").toLowerCase();

      if (txt.includes("approved")) return Approval.APPROVED;
      if (/removed/.test(txt)) return Approval.REMOVED; // text-only per requirement
      if (/(rejected|not required|declined|unapproved)/i.test(txt)) {
        return Approval.UNAPPROVED;
      }
    }

    return Approval.UNKNOWN;
  }

  /** Public read: prefers frozen, then cache, then detects live and caches. */
  function getApprovalState(root) {
    if (!root) return Approval.UNKNOWN;

    // 1) Respect frozen state (set at RO load)
    const frozen = root.getAttribute(FROZEN_ATTR);
    if (frozen) return frozen;

    // 2) Cache hit
    const cached = stateCache.get(root);
    if (cached) return cached;

    // 3) Detect + cache + mirror to an attribute for debugging
    const state = detectApprovalFromDOM(root);
    stateCache.set(root, state);
    root.setAttribute(LIVE_ATTR, state);
    return state;
  }

  /** Freeze current state for a single root (idempotent). */
  function freezeApprovalState(root) {
    if (!root || root.hasAttribute(FROZEN_ATTR)) return;
    const state = detectApprovalFromDOM(root);
    root.setAttribute(FROZEN_ATTR, state);
    // keep live mirror for devtools visibility
    root.setAttribute(LIVE_ATTR, state);
    stateCache.set(root, state);
  }

  /** Bulk freeze by NodeList/Array OR container+selector. */
  function freezeAll(arg1, selector) {
    if (!arg1) return;

    // Case 1: array-like of roots
    if (typeof arg1.forEach === "function" && !selector) {
      arg1.forEach(freezeApprovalState);
      return;
    }
    // Case 2: container + selector
    const container = arg1;
    const roots = container.querySelectorAll(selector);
    roots.forEach(freezeApprovalState);
  }

  /** Remove frozen state for a single root. */
  function unfreezeApprovalState(root) {
    if (!root) return;
    root.removeAttribute(FROZEN_ATTR);
    // do not touch LIVE_ATTR; next getApprovalState() will refresh/cache
  }

  /** Bulk unfreeze helper. */
  function unfreezeAll(arg1, selector) {
    if (!arg1) return;

    if (typeof arg1.forEach === "function" && !selector) {
      arg1.forEach(unfreezeApprovalState);
      return;
    }

    const container = arg1;
    const roots = container.querySelectorAll(selector);
    roots.forEach(unfreezeApprovalState);
  }

  /** Invalidate non-frozen cache (use when DOM changes). */
  function invalidateApprovalCache() {
    stateCache = new WeakMap();
  }

  AIExt.approval = {
    Approval,
    getApprovalState,
    freezeApprovalState,
    freezeAll,
    unfreezeApprovalState,
    unfreezeAll,
    invalidateApprovalCache,
    // Expose constants so hoverTracker can refer to them if needed:
    FROZEN_ATTR,
    LIVE_ATTR,
  };
})();
