// partCostTracker.js
// Depends on: utils.js (AIExt.utils) and approvalState.js (AIExt.approval)
//
// Tracks high-cost PART checks (NO UI)
//
// A Service Code is considered "checked" if the agent EITHER:
//   (A) clicks the Vehicle Data button within that PART line item, OR
//   (B) clicks the Part Number hyperlink within that PART line item
//
// Deduped by Service Code
// Uses approval freeze logic (same as hoverTracker)
//
// Debug:
// - Logs ONLY when live snapshot changes (not on every click/permutation)
// - Provides a concise diff-style message similar in spirit to hoverTracker’s console output

window.AIExt = window.AIExt || {};

(function () {
  const { qAll, lineItemRoot } = AIExt.utils;
  const { Approval, getApprovalState } = AIExt.approval;

  // ----- Config -----
  const UNIT_COST_THRESHOLD = 100.0;

  const ITEM_TYPE_LABEL = "Item Type";
  const SERVICE_CODE_LABEL = "Service Code";
  const UNIT_COST_TEXT = "Unit Cost";

  const VEHICLE_DATA_BTN = 'button[aria-label="Vehicle Data"]';

  // ----- Helpers -----
  function textClean(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function getField(container, label) {
    return textClean(
      container.querySelector(
        `h1[aria-label="${label}"],
         h2[aria-label="${label}"],
         h3[aria-label="${label}"],
         h4[aria-label="${label}"],
         h5[aria-label="${label}"],
         h6[aria-label="${label}"],
         [aria-label="${label}"]`
      )
    );
  }

  function containerForNode(node) {
    return (
      node.closest?.(
        '[role="row"],[role="group"],[role="region"],section,article,.MuiCard-root,.row,.item'
      ) || document.body
    );
  }

  function serviceCodeKey(container) {
    const sc = getField(container, SERVICE_CODE_LABEL);
    return sc ? `SC:${sc}` : null;
  }

  function parseCurrency(str) {
    const m = String(str).match(/([\d]{1,3}(?:,[\d]{3})*|\d+)(?:\.(\d{1,2}))?/);
    if (!m) return NaN;
    return Number(m[1].replace(/,/g, "") + "." + (m[2] || "00"));
  }

  function getUnitCost(container) {
    // Prefer aria-label if present; fallback to text scan
    const ariaNode = container.querySelector('[aria-label="Unit Cost"]');
    if (ariaNode) {
      const v1 = parseCurrency(textClean(ariaNode));
      if (Number.isFinite(v1)) return v1;
      const sib = ariaNode.nextElementSibling;
      const v2 = sib ? parseCurrency(textClean(sib)) : NaN;
      if (Number.isFinite(v2)) return v2;
    }

    const txt = textClean(container);
    const idx = txt.indexOf(UNIT_COST_TEXT);
    if (idx < 0) return NaN;
    return parseCurrency(txt.slice(idx, idx + 80));
  }

  function isPart(container) {
    return getField(container, ITEM_TYPE_LABEL).toUpperCase() === "PART";
  }

  function findPartContainers() {
    // Selector points to Item Type h6 with aria-label="Item Type"
    return qAll(`h6[aria-label="${ITEM_TYPE_LABEL}"]`)
      .filter((n) => textClean(n).toUpperCase() === "PART")
      .map(containerForNode);
  }

  // ----- State -----
  let qualifiedKeys = []; // stable list after freezeCurrentRO
  const checkedKeys = new Set(); // keys checked by user action
  let lastURL = location.href;

  // Debug state (only log when snapshot changes)
  let lastSnapshotSig = "";
  let lastSnapshot = null;

  function snapshotSignature(s) {
    // Stable signature to avoid noisy logging
    // Include checkedKeys + qualifiedKeys so changes are captured accurately.
    const q = [...qualifiedKeys].sort().join("|");
    const c = [...checkedKeys].sort().join("|");
    return `needs=${s.needsCheckCount};checked=${s.checkedCount};q=${q};c=${c}`;
  }

  function diffSummary(prev, next) {
    if (!prev) {
      return `init needs=${next.needsCheckCount} checked=${next.checkedCount}`;
    }
    const parts = [];
    if (prev.needsCheckCount !== next.needsCheckCount) {
      parts.push(`needs ${prev.needsCheckCount}→${next.needsCheckCount}`);
    }
    if (prev.checkedCount !== next.checkedCount) {
      parts.push(`checked ${prev.checkedCount}→${next.checkedCount}`);
    }
    if (!parts.length) return "no-op";
    return parts.join(", ");
  }

  function debugEmit(reason) {
    const snap = AIExt.partCostTracker.getSnapshot();
    const sig = snapshotSignature(snap);

    if (sig === lastSnapshotSig) return; // NOTHING CHANGED — do not spam console

    const msg = diffSummary(lastSnapshot, snap);
    lastSnapshotSig = sig;
    lastSnapshot = snap;

    // Similar to hover tracker style: single structured log line + object
    console.log(`[PartCostTracker] ${reason}: ${msg}`, snap);
    AIExt.partCostTracker?.onChange?.(snap);
  }

  // ----- Qualification -----
  function collectQualifiedKeys() {
    const keys = new Set();

    for (const container of findPartContainers()) {
      const root = lineItemRoot(container);
      if (getApprovalState(root) !== Approval.UNAPPROVED) continue;
      if (!isPart(container)) continue;

      const cost = getUnitCost(container);
      if (!Number.isFinite(cost) || cost <= UNIT_COST_THRESHOLD) continue;

      const key = serviceCodeKey(container);
      if (key) keys.add(key);
    }

    qualifiedKeys = Array.from(keys);
    return qualifiedKeys;
  }

  function computeCounts() {
    // If not frozen yet, attempt to populate once so snapshot is meaningful.
    if (!qualifiedKeys.length) collectQualifiedKeys();

    return {
      needsCheckCount: qualifiedKeys.length,
      checkedCount: qualifiedKeys.filter((k) => checkedKeys.has(k)).length,
    };
  }

  // ----- Click tracking (per line item) -----
  function markCheckedFromEventTarget(target) {
    // Vehicle Data click (scoped to container)
    const vdBtn = target.closest(VEHICLE_DATA_BTN);
    if (vdBtn) {
      const container = containerForNode(vdBtn);
      if (isPart(container)) {
        const key = serviceCodeKey(container);
        if (key) checkedKeys.add(key);
      }
      return; // if vehicle data button was clicked, don’t also treat as link click
    }

    // Part Number hyperlink click
    const link = target.closest("a[href]");
    if (link) {
      const container = containerForNode(link);
      if (isPart(container)) {
        const key = serviceCodeKey(container);
        if (key) checkedKeys.add(key);
      }
    }
  }

  function installClickTracking() {
    document.addEventListener(
      "click",
      (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;

        // Capture pre-click snapshot signature to avoid emitting if nothing changes
        const beforeSig = lastSnapshotSig || snapshotSignature(AIExt.partCostTracker.getSnapshot());

        markCheckedFromEventTarget(target);

        // Emit only if changed
        debugEmit("click");

        // If nothing changed, debugEmit will be a no-op due to signature check,
        // but we still want to avoid a redundant signature recompute cascade.
        // (No further action required.)
        const afterSig = lastSnapshotSig;
        if (afterSig === beforeSig) return;
      },
      { capture: true }
    );
  }

  // ----- Freeze handling -----
  function freezeCurrentRO() {
    const roots = new Set();
    for (const c of findPartContainers()) {
      const r = lineItemRoot(c);
      if (r) roots.add(r);
    }

    AIExt.approval.freezeAll([...roots]);
    collectQualifiedKeys();

    // On new RO freeze, reset debug sig so we always log the first meaningful snapshot
    lastSnapshotSig = "";
    lastSnapshot = null;

    debugEmit("freeze");
  }

  function clearPreviousRO() {
    const { unfreezeAll, invalidateApprovalCache, FROZEN_ATTR } = AIExt.approval;

    unfreezeAll(document.querySelectorAll(`[${FROZEN_ATTR}]`));
    invalidateApprovalCache();

    qualifiedKeys = [];
    checkedKeys.clear();

    lastSnapshotSig = "";
    lastSnapshot = null;
  }

  function boot() {
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const roVisible = findPartContainers().length > 0;

      if (roVisible || tries > 20) {
        clearInterval(t);
        freezeCurrentRO();
      }
    }, 250);
  }

  function installURLWatcher() {
    ["pushState", "replaceState"].forEach((fn) => {
      const orig = history[fn];
      history[fn] = function () {
        const r = orig.apply(this, arguments);
        window.dispatchEvent(new Event("aixt:locationchange"));
        return r;
      };
    });

    window.addEventListener("popstate", () =>
      window.dispatchEvent(new Event("aixt:locationchange"))
    );

    window.addEventListener("aixt:locationchange", () => {
      if (location.href === lastURL) return;
      lastURL = location.href;

      console.log("[PartCostTracker] URL changed; refreshing for new RO…");
      clearPreviousRO();
      setTimeout(boot, 50);
    });
  }

  // ----- Public API -----
  AIExt.partCostTracker = {
    onChange: null,

    init({ onChange } = {}) {
      console.log("[PartCostTracker] Initializing…");
      this.onChange = typeof onChange === "function" ? onChange : null;

      installClickTracking();
      installURLWatcher();
      boot();
    },

    getSnapshot() {
      return computeCounts();
    },

    refresh() {
      collectQualifiedKeys();
      debugEmit("refresh");
      return this.getSnapshot();
    },
  };
})();
