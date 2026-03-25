// main.js
(function () {
  const { mountSpaHooks, throttle } = AIExt.utils;
  const { invalidateApprovalCache } = AIExt.approval;
  const { hoverTracker } = AIExt;

  // --- helpers ---
  function hasChromeStorage() {
    try {
      return !!(typeof chrome !== "undefined" && chrome?.storage?.local && typeof chrome.storage.local.set === "function");
    } catch {
      return false;
    }
  }

  // Prefer RO id from querystring, else full URL
  function keyForRO() {
    try {
      const u = new URL(location.href);
      const q = u.searchParams;
      const roId = q.get("jsId") || q.get("jsid") || q.get("id");
      return roId ? `RO:${roId}` : `URL:${location.href}`;
    } catch {
      return `URL:${location.href}`;
    }
  }

  function keyForURL() {
    return `URL:${location.href}`;
  }

  // RO / invoice extraction (kept for analytics/persist)
  function extractRoAndInvoice() {
    let repairOrderId = "", invoiceNumber = "";
    const nodes = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,span,div"));
    const roNode = nodes.find(el => /repair\s*order\s*id/i.test(el.textContent || ""));
    if (roNode) {
      const m = (roNode.textContent || "").match(/repair\s*order\s*id[^0-9]*([0-9\-]+)/i);
      if (m) repairOrderId = m[1].trim();
    }
    const invNode = nodes.find(el => /invoice\s*number/i.test(el.textContent || ""));
    if (invNode) {
      const m = (invNode.textContent || "").match(/invoice\s*number[^0-9]*([0-9\-]+)/i);
      if (m) invoiceNumber = m[1].trim();
    }
    return { repairOrderId, invoiceNumber };
  }

  // Persist to chrome.storage or localStorage (no network reporting)
  function persist(stats) {
    const payload = {
      key: keyForRO(),          // keep RO-scoped analytics key
      ...stats,                 // e.g., hover stats (+ notes if merging)
      ...extractRoAndInvoice(),
      url: location.href,
      updatedAt: new Date().toISOString()
    };

    try {
      if (hasChromeStorage()) {
        chrome.storage.local.set({ [payload.key]: payload }, () => {});
      } else {
        localStorage.setItem(payload.key, JSON.stringify(payload));
      }
    } catch (e) {
      try { localStorage.setItem(payload.key, JSON.stringify(payload)); } catch {}
    }
    return payload;
  }

  // --- Init trackers
  hoverTracker.init({
    onChange: (hoverStats) => {
      const notes = AIExt.notesTracker?.getSnapshot?.() || {};
      // If you want your separate POST module to send this, hook it elsewhere.
      persist({ ...hoverStats, notes });
    }
  });

  // NotesTracker: no scope passed here; toggle via AIExt.notesTracker.setScope(...)
  console.log("[Main] init notesTracker");
  AIExt.notesTracker.init({
    getROKey: keyForRO,
    getURLKey: keyForURL,
    onChange: (notesStats) => {
      // Optional: persist on each notes change
      // const hoverStats = AIExt.hoverTracker.getSnapshot();
      // persist({ notes: notesStats, ...hoverStats });
    }
  });

  // SPA hooks: re-evaluate on route or DOM changes
  mountSpaHooks(
    () => { invalidateApprovalCache(); hoverTracker.refresh(); AIExt.notesTracker.refresh(); AIExt.repairOrderStatusTracker?.refresh?.(); },
    () => { invalidateApprovalCache(); hoverTracker.refresh(); AIExt.notesTracker.refresh(); AIExt.repairOrderStatusTracker?.refresh?.(); }
  );

  // Expose current state for popup → content messages
  chrome.runtime?.onMessage?.addListener((msg, _sender, sendResponse) => {
    if (msg?.fn === "getState") {
      const hoverStats = hoverTracker.getSnapshot();
      const notes = AIExt.notesTracker.getSnapshot();
      const meta = extractRoAndInvoice();
      sendResponse({
        key: keyForRO(),
        ...hoverStats,
        notes,
        ...meta,
        url: location.href,
        ts: Date.now()
      });
      return true;
    }
  });

  window.addEventListener('beforeunload', () => {
    const hoverStats = hoverTracker.getSnapshot();
    const notes = AIExt.notesTracker.getSnapshot();
    persist({ ...hoverStats, notes, ts: new Date().toISOString() });
  });

  // Other modules
  AIExt.cardTypeGuard.init();
  AIExt.notifier.init();
  AIExt.idleTracker.init();
  AIExt.profile.ensureCached();
  AIExt.sessionRecorder.init();
  AIExt.orphanedRO.init();
  AIExt.replacementGuard.init();
  AIExt.canadaGoogleParts.init();
  AIExt.clientInfoLinker?.init?.();
  AIExt.repairOrderStatusTracker?.init?.();
  AIExt.partCostTracker.init();
  AIExt.laborHrsTracker.init();
  AIExt.vehiclePolicyTracker.init();
  AIExt.similarRepairOrdersTracker.init();
  AIExt.highDollarReject.start();
  AIExt.fedexGuard.init();



  console.log("[AI Helper] content loaded", location.href);
})();
