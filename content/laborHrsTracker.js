// laborHrsTracker.js
// Depends on: utils.js (AIExt.utils) and approvalState.js (AIExt.approval)
//
// Feature:
// For LABOR line items that are UNAPPROVED (red, same approval logic as hoverTracker)
// AND have Hrs > 2.0,
// track whether the agent clicked the "Vehicle Data" (outlined books) icon/button
// *within that LABOR line item*.
//
// Notes:
// - Uses approval freeze logic (same pattern as hoverTracker): freezes at RO load,
//   does not refresh when agent actions change UI, and re-freezes on URL change.
// - Counts are deduped by Service Code (mirrors the PART tracker pattern).
// - No UI; console debug logs only when snapshot changes.

window.AIExt = window.AIExt || {};

(function () {
  const { qAll, lineItemRoot } = AIExt.utils;
  const { Approval, getApprovalState } = AIExt.approval;

  // ----- Config -----
  const HRS_THRESHOLD = 2.0;

  const ITEM_TYPE_LABEL = "Item Type";
  const SERVICE_CODE_LABEL = "Service Code";
  const HRS_LABEL = "Hrs";

  const VEHICLE_DATA_BTN = 'button[aria-label="Vehicle Data"]';

  // ----- Helpers -----
  function textClean(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function getField(container, label) {
    const node =
      container.querySelector(
        `h1[aria-label="${label}"],
         h2[aria-label="${label}"],
         h3[aria-label="${label}"],
         h4[aria-label="${label}"],
         h5[aria-label="${label}"],
         h6[aria-label="${label}"]`
      ) || container.querySelector(`[aria-label="${label}"]`);
    return textClean(node);
  }

  function containerForNode(node) {
    return (
      node.closest?.(
        '[role="row"],[role="group"],[role="region"],section,article,.MuiCard-root,.card,.panel,.row,.item,.list-item'
      ) || node.parentElement || document.body
    );
  }

  function serviceCodeKeyForContainer(container) {
    const sc = getField(container, SERVICE_CODE_LABEL);
    if (!sc) return null;
    return `SC:${sc}`;
  }

  function parseNumber(str) {
    if (!str) return NaN;
    const m = String(str).match(/-?\d+(?:\.\d+)?/);
    if (!m) return NaN;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : NaN;
  }

  function getHrsFromContainer(container) {
    // Strategy 1: aria-label="Hrs" node or sibling value
    const ariaNode = container.querySelector('[aria-label="Hrs"]');
    if (ariaNode) {
      const v1 = parseNumber(textClean(ariaNode));
      if (Number.isFinite(v1)) return v1;

      const sib = ariaNode.nextElementSibling;
      const v2 = sib ? parseNumber(textClean(sib)) : NaN;
      if (Number.isFinite(v2)) return v2;
    }

    // Strategy 2: scan for a node containing "Hrs", then parse nearby
    const all = Array.from(container.querySelectorAll("*"));
    for (const n of all) {
      const t = textClean(n);
      if (!t) continue;
      if (t === HRS_LABEL || t.includes(HRS_LABEL)) {
        const ns = n.nextElementSibling;
        const v1 = ns ? parseNumber(textClean(ns)) : NaN;
        if (Number.isFinite(v1)) return v1;

        const parent = n.parentElement;
        const v2 = parent ? parseNumber(textClean(parent)) : NaN;
        if (Number.isFinite(v2)) return v2;
      }
    }

    // Strategy 3: coarse fallback — parse number near "Hrs" in full text
    const txt = textClean(container);
    const idx = txt.indexOf(HRS_LABEL);
    if (idx >= 0) {
      const slice = txt.slice(idx, idx + 40);
      const v = parseNumber(slice);
      if (Number.isFinite(v)) return v;
    }

    return NaN;
  }

  function isLaborContainer(container) {
    const type = getField(container, ITEM_TYPE_LABEL);
    return type.toUpperCase() === "LABOR";
  }

  function findLaborContainers() {
    // Same approach as the PART tracker: find item-type nodes and map to containers
    const typeNodes = qAll(`h6[aria-label="${ITEM_TYPE_LABEL}"]`);
    const laborTypeNodes = typeNodes.filter((n) => textClean(n).toUpperCase() === "LABOR");
    const containers = laborTypeNodes.map(containerForNode);

    // De-dupe by element identity
    const set = new Set();
    const uniq = [];
    for (const c of containers) {
      if (!c || set.has(c)) continue;
      set.add(c);
      uniq.push(c);
    }
    return uniq;
  }

  // ----- State -----
  let qualifiedKeys = []; // deduped by Service Code
  const checkedKeys = new Set(); // Service Codes where VD was clicked in that line

  let lastURL = location.href;

  // Debug state (log only when snapshot changes)
  let lastSig = "";
  let lastSnap = null;

  function computeSnapshot() {
    if (!qualifiedKeys.length) collectQualifiedKeys();

    const needsCheckCount = qualifiedKeys.length;
    const checkedCount = qualifiedKeys.filter((k) => checkedKeys.has(k)).length;

    return { needsCheckCount, checkedCount };
  }

  function signatureOf(snap) {
    const q = [...qualifiedKeys].sort().join("|");
    const c = [...checkedKeys].sort().join("|");
    return `needs=${snap.needsCheckCount};checked=${snap.checkedCount};q=${q};c=${c}`;
  }

  function diffSummary(prev, next) {
    if (!prev) return `init needs=${next.needsCheckCount} checked=${next.checkedCount}`;
    const parts = [];
    if (prev.needsCheckCount !== next.needsCheckCount)
      parts.push(`needs ${prev.needsCheckCount}→${next.needsCheckCount}`);
    if (prev.checkedCount !== next.checkedCount)
      parts.push(`checked ${prev.checkedCount}→${next.checkedCount}`);
    return parts.length ? parts.join(", ") : "no-op";
  }

  function emitIfChanged(reason) {
    const snap = AIExt.laborHrsTracker.getSnapshot();
    const sig = signatureOf(snap);
    if (sig === lastSig) return;

    const msg = diffSummary(lastSnap, snap);
    lastSig = sig;
    lastSnap = snap;

    console.log(`[LaborHrsTracker] ${reason}: ${msg}`, snap);
    AIExt.laborHrsTracker?.onChange?.(snap);
  }

  // ----- Qualification -----
  function collectQualifiedKeys() {
    const containers = findLaborContainers();
    const keySet = new Set();

    for (const container of containers) {
      const root = lineItemRoot(container);
      const st = getApprovalState(root);
      if (st !== Approval.UNAPPROVED) continue;

      if (!isLaborContainer(container)) continue;

      const hrs = getHrsFromContainer(container);
      if (!Number.isFinite(hrs) || hrs <= HRS_THRESHOLD) continue;

      const key = serviceCodeKeyForContainer(container);
      if (key) keySet.add(key);
    }

    qualifiedKeys = Array.from(keySet);
    return qualifiedKeys;
  }

  // ----- Click tracking -----
  function installClickTracking() {
    document.addEventListener(
      "click",
      (e) => {
        const t = e.target instanceof Element ? e.target : null;
        if (!t) return;

        const vdBtn = t.closest(VEHICLE_DATA_BTN);
        if (!vdBtn) return;

        // Must be VD click inside a LABOR line item container
        const container = containerForNode(vdBtn);
        if (!isLaborContainer(container)) return;

        const key = serviceCodeKeyForContainer(container);
        if (!key) return;

        // Only count if it's actually a qualifying key (hrs>threshold + unapproved) for this RO
        if (!qualifiedKeys.length) collectQualifiedKeys();
        if (!qualifiedKeys.includes(key)) return;

        checkedKeys.add(key);
        emitIfChanged("vehicle-data-click");
      },
      { capture: true }
    );
  }

  // ----- Freeze handling -----
  function freezeCurrentRO() {
    const containers = findLaborContainers();
    const roots = new Set();

    for (const c of containers) {
      const r = lineItemRoot(c);
      if (r) roots.add(r);
    }

    AIExt.approval.freezeAll(Array.from(roots));
    collectQualifiedKeys();

    // Reset debug baseline so we always get an initial log on new RO
    lastSig = "";
    lastSnap = null;

    emitIfChanged("freeze");
  }

  function clearPreviousRO() {
    const { unfreezeAll, invalidateApprovalCache, FROZEN_ATTR } = AIExt.approval;

    unfreezeAll(document.querySelectorAll(`[${FROZEN_ATTR}]`));
    invalidateApprovalCache();

    qualifiedKeys = [];
    checkedKeys.clear();

    lastSig = "";
    lastSnap = null;
  }

  function bootRetryUntilFound() {
    let tries = 0;
    const maxTries = 20; // ~5s
    const timer = setInterval(() => {
      tries++;

      // Stop when the RO content is visible (even if 0 qualifying items) or max tries
      const laborContainers = findLaborContainers();
      const roVisible = laborContainers.length > 0;

      if (roVisible || tries >= maxTries) {
        clearInterval(timer);
        freezeCurrentRO();
      }
    }, 250);
  }

  function installURLChangeListener() {
    ["pushState", "replaceState"].forEach((fn) => {
      const orig = history[fn];
      history[fn] = function () {
        const ret = orig.apply(this, arguments);
        window.dispatchEvent(new Event("aixt:locationchange"));
        return ret;
      };
    });

    window.addEventListener("popstate", () => {
      window.dispatchEvent(new Event("aixt:locationchange"));
    });

    window.addEventListener("aixt:locationchange", () => {
      const href = location.href;
      if (href === lastURL) return;
      lastURL = href;

      console.log("[LaborHrsTracker] URL changed; refreshing for new RO…");
      clearPreviousRO();
      setTimeout(() => bootRetryUntilFound(), 50);
    });
  }

  // ----- Public API -----
  AIExt.laborHrsTracker = {
    onChange: null,

    init({ onChange } = {}) {
      console.log("[LaborHrsTracker] Initializing…");
      this.onChange = typeof onChange === "function" ? onChange : null;

      installClickTracking();
      installURLChangeListener();

      bootRetryUntilFound();
    },

    refresh() {
      collectQualifiedKeys();
      emitIfChanged("refresh");
      return this.getSnapshot();
    },

    getSnapshot() {
      return computeSnapshot();
    },
  };
})();
