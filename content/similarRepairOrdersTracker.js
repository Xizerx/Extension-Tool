// similarRepairOrdersTracker.js
// Track interaction with "Similar Repair Orders" dialog.
//
// Tracks (per dialog open):
// - total_similar_ros: number of rows shown
// - clicked_unique: number of unique ROs whose "VIEW" was clicked
// - clicked_total: total VIEW clicks (including repeats)
// - clicked_ro_ids: array of unique RO IDs clicked (in click order)
// - excluded_rows: how many rows were excluded by Shop Name filter
//
// Requirements:
// - Only track clicks when the dialog FIRST pops up (i.e., per open session).
// - Exclude clicks (and exclude rows in counts) when Shop Name is in EXCLUDED_SHOPS.
// - Uses event delegation + mutation observer to handle rerenders.
// - Console debug logs ONLY when snapshot changes.
// - No UI.

window.AIExt = window.AIExt || {};

(function () {
  const DIALOG_ROOT_SELECTOR = ".MuiDialog-root.MuiModal-root";
  const DIALOG_TITLE_TEXT = "Similar Repair Orders";

  // Your provided "VIEW" anchor example path ends at: table > tbody > tr ... > a
  // We'll use robust targeting: click on any <a> in the dialog whose text is "VIEW".
  const VIEW_LINK_TEXT = "VIEW";

  const EXCLUDED_SHOPS = new Set([
    "Ina Towing Network",
    "Agero Driver Assistance",
    "Hertz System",
    "Enterprise Car Rental",
    "Safelite Solutions",
  ]);

  const MEASURE_DELAY_MS = 150;

  // ----- State -----
  let dialogEl = null;
  let observer = null;
  let measureTimer = null;

  // Per-open session state
  let sessionId = 0;
  let dialogOpen = false;

  let totalSimilarROs = 0; // excludes excluded shops (see computeCounts)
  let excludedRows = 0;

  let clickedTotal = 0; // all clicks (non-excluded rows only)
  let clickedUniqueSet = new Set();
  let clickedRoIds = []; // unique, in order of first click

  // Debug: only log when snapshot changes
  let lastSig = "";
  let lastSnap = null;

  // ----- Helpers -----
  function normText(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function isViewLink(a) {
    if (!a) return false;
    return normText(a.textContent).toUpperCase() === VIEW_LINK_TEXT;
  }

  function findDialogCandidates() {
    return Array.from(document.querySelectorAll(DIALOG_ROOT_SELECTOR));
  }

  function dialogHasTitle(el) {
    if (!el) return false;
    // Prefer role="dialog" semantics if present, otherwise just check text.
    const text = normText(el.textContent);
    return text.includes(DIALOG_TITLE_TEXT);
  }

  function getActiveDialog() {
    const candidates = findDialogCandidates();
    for (const el of candidates) {
      if (dialogHasTitle(el)) return el;
    }
    return null;
  }

  function getTableRows(el) {
    if (!el) return [];
    // Typical MUI structure: inside dialog content, a table with tbody > tr
    return Array.from(el.querySelectorAll("table tbody tr"));
  }

  function getShopNameFromRow(row) {
    // Column order from UI screenshot:
    // 1 RO ID, 2 Invoice Number, 3 Element Unit ID, 4 Vehicle Arrival Date,
    // 5 Shop Name, 6 Shop Telephone, 7 Odometer Reading, 8 Cost, 9 Status, 10 View
    const td = row?.querySelector("td:nth-child(5)");
    return normText(td?.textContent);
  }

  function getRoIdFromRow(row) {
    const td = row?.querySelector("td:nth-child(1)");
    return normText(td?.textContent);
  }

  function isExcludedRow(row) {
    const shop = getShopNameFromRow(row);
    return EXCLUDED_SHOPS.has(shop);
  }

  function computeCounts() {
    const rows = getTableRows(dialogEl);
    let total = 0;
    let excluded = 0;

    for (const r of rows) {
      if (isExcludedRow(r)) excluded++;
      else total++;
    }

    totalSimilarROs = total;
    excludedRows = excluded;
  }

  function computeSnapshot() {
    return {
      dialog_open: dialogOpen,
      session_id: sessionId,

      total_similar_ros: totalSimilarROs, // excludes excluded shops
      excluded_rows: excludedRows,

      clicked_total: clickedTotal,
      clicked_unique: clickedUniqueSet.size,
      clicked_ro_ids: clickedRoIds.slice(),

      dialog_found: Boolean(dialogEl && dialogEl.isConnected),
    };
  }

  function signatureOf(s) {
    return [
      `open=${s.dialog_open}`,
      `sid=${s.session_id}`,
      `total=${s.total_similar_ros}`,
      `excluded=${s.excluded_rows}`,
      `ct=${s.clicked_total}`,
      `cu=${s.clicked_unique}`,
      `ids=${s.clicked_ro_ids.join(",")}`,
      `found=${s.dialog_found}`,
    ].join("|");
  }

  function diffSummary(prev, next) {
    if (!prev) {
      return `init open=${next.dialog_open} total=${next.total_similar_ros} clicked_unique=${next.clicked_unique}`;
    }
    const parts = [];
    if (prev.dialog_open !== next.dialog_open)
      parts.push(`dialog_open ${prev.dialog_open}→${next.dialog_open}`);
    if (prev.total_similar_ros !== next.total_similar_ros)
      parts.push(`total_similar_ros ${prev.total_similar_ros}→${next.total_similar_ros}`);
    if (prev.excluded_rows !== next.excluded_rows)
      parts.push(`excluded_rows ${prev.excluded_rows}→${next.excluded_rows}`);
    if (prev.clicked_total !== next.clicked_total)
      parts.push(`clicked_total ${prev.clicked_total}→${next.clicked_total}`);
    if (prev.clicked_unique !== next.clicked_unique)
      parts.push(`clicked_unique ${prev.clicked_unique}→${next.clicked_unique}`);
    if ((prev.clicked_ro_ids || []).join(",") !== (next.clicked_ro_ids || []).join(","))
      parts.push(`clicked_ro_ids updated`);
    return parts.length ? parts.join(", ") : "no-op";
  }

  function emitIfChanged(reason) {
    const snap = computeSnapshot();
    const sig = signatureOf(snap);
    if (sig === lastSig) return;

    const msg = diffSummary(lastSnap, snap);
    lastSig = sig;
    lastSnap = snap;

    console.log(`[SimilarROTracker] ${reason}: ${msg}`, snap);
    AIExt.similarRepairOrdersTracker?.onChange?.(snap);
  }

  function delayedMeasure(delayMs = MEASURE_DELAY_MS) {
    if (measureTimer) clearTimeout(measureTimer);
    measureTimer = setTimeout(() => {
      measureTimer = null;
      if (!dialogEl || !dialogEl.isConnected) return;
      computeCounts();
      emitIfChanged("measure");
    }, delayMs);
  }

  // ----- Click handling (event delegation) -----
  function onDialogClick(e) {
    if (!dialogOpen) return;

    const a = e.target?.closest?.("a");
    if (!isViewLink(a)) return;

    const row = a.closest("tr");
    if (!row) return;

    // Exclusion filter: do not track this click if excluded shop name
    if (isExcludedRow(row)) return;

    const roId = getRoIdFromRow(row) || "(unknown)";

    clickedTotal++;

    if (!clickedUniqueSet.has(roId)) {
      clickedUniqueSet.add(roId);
      clickedRoIds.push(roId);
    }

    emitIfChanged("view-click");
  }

  // ----- Attach / detach -----
  function resetSessionState() {
    clickedTotal = 0;
    clickedUniqueSet = new Set();
    clickedRoIds = [];

    totalSimilarROs = 0;
    excludedRows = 0;
  }

  function attachDialog(el) {
    dialogEl = el;
    dialogOpen = true;
    sessionId++;
    resetSessionState();

    // Delegate clicks anywhere in dialog.
    dialogEl.addEventListener("click", onDialogClick, true);

    // Initial measurement after layout settles.
    delayedMeasure(MEASURE_DELAY_MS);

    // Reset debug baseline so first attach logs.
    lastSig = "";
    lastSnap = null;
    emitIfChanged("attach");
  }

  function detachDialog(reason = "detach") {
    if (measureTimer) {
      clearTimeout(measureTimer);
      measureTimer = null;
    }

    if (dialogEl && dialogEl.isConnected) {
      dialogEl.removeEventListener("click", onDialogClick, true);
    }

    dialogEl = null;
    dialogOpen = false;

    emitIfChanged(reason);
  }

  // ----- Dialog lifecycle watcher -----
  function reconcileDialogState() {
    const active = getActiveDialog();

    // Dialog opened
    if (active && (!dialogEl || dialogEl !== active || !dialogEl.isConnected)) {
      attachDialog(active);
      return;
    }

    // Dialog still open; re-measure in case rows changed
    if (active && dialogEl && dialogEl === active) {
      delayedMeasure(MEASURE_DELAY_MS);
      return;
    }

    // Dialog closed
    if (!active && dialogOpen) {
      detachDialog("closed");
    }
  }

  function installObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      reconcileDialogState();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ----- Public API -----
  AIExt.similarRepairOrdersTracker = {
    onChange: null,

    init({ onChange } = {}) {
      console.log("[SimilarROTracker] Initializing…");
      this.onChange = typeof onChange === "function" ? onChange : null;

      installObserver();
      // Run once immediately
      reconcileDialogState();
      emitIfChanged("init");
    },

    refresh() {
      reconcileDialogState();
      if (dialogOpen) delayedMeasure(0);
      emitIfChanged("refresh");
      return this.getSnapshot();
    },

    getSnapshot() {
      return computeSnapshot();
    },
  };
})();
