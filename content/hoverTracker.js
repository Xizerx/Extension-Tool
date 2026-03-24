// hoverTracker.js
// Depends on: utils.js (AIExt.utils) and approvalState.js (AIExt.approval)

window.AIExt = window.AIExt || {};

(function () {

  /******************************************************************
   * SIMPLE VISUAL TOGGLE
   * ---------------------------------------------------------------
   * Set to false to disable the floating progress chip + popover.
   * Tracking logic still runs.
   ******************************************************************/
  const HOVER_TRACKER_ENABLED = false;

  const { qAll, lineItemRoot, escapeHtml } = AIExt.utils;
  const { Approval, getApprovalState } = AIExt.approval;

  const TRIANGLE = '[data-testid="ServiceCodeNotesIcon"]';
  const HOVER_ATTR = 'data-policy-hovered';
  const DWELL_MS = 1;

  function textClean(el) {
    if (!el) return "";
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function getField(container, label) {
    const node =
      container.querySelector(
        `h1[aria-label="${label}"],h2[aria-label="${label}"],h3[aria-label="${label}"],h4[aria-label="${label}"],h5[aria-label="${label}"],h6[aria-label="${label}"]`
      ) ||
      container.querySelector(`[aria-label="${label}"]`);
    return textClean(node);
  }

  function containerForTriangle(tri) {
    return (
      tri.closest?.(
        '[role="row"],[role="group"],[role="region"],section,article,.MuiCard-root,.card,.panel,.row,.item,.list-item'
      ) ||
      tri.parentElement ||
      document.body
    );
  }

  function labelForTriangle(tri) {
    const container = containerForTriangle(tri);
    const itemType = getField(container, "Item Type");
    const serviceCode = getField(container, "Service Code");
    if (itemType && serviceCode) return `${itemType} — ${serviceCode}`;
    return itemType || serviceCode || "";
  }

  function serviceCodeForTriangle(tri) {
    const container = containerForTriangle(tri);
    return getField(container, "Service Code");
  }

  function serviceCodeKeyForTriangle(tri) {
    const sc = serviceCodeForTriangle(tri);
    if (!sc) return `__NO_SC__:${labelForTriangle(tri) || "Untitled item"}`;
    return `SC:${sc}`;
  }

  function displayLabelForKey(key) {
    if (key.startsWith("SC:")) return key.slice(3);
    return key.replace(/^__NO_SC__:/, "");
  }

  let onChange = null;
  let panel = null, popover = null;

  let cachedTriangles = [];
  let cachedKeys = [];
  let hoverDataByKey = new Map();
  let lastURL = location.href;
  let lastStats = null;

  function ensureHoverDataByKey(key) {
    let d = hoverDataByKey.get(key);
    if (!d) {
      d = { total: 0, count: 0, startedAt: null, hovered: false };
      hoverDataByKey.set(key, d);
    }
    return d;
  }

  function collectTriangles() {
    const tris = qAll(TRIANGLE).filter((tri) => {
      const root = lineItemRoot(tri);
      const st = getApprovalState(root);
      tri.setAttribute("data-approval", st);
      return st === Approval.UNAPPROVED;
    });

    cachedTriangles = tris;

    const keySet = new Set();
    for (const tri of tris) {
      keySet.add(serviceCodeKeyForTriangle(tri));
    }

    cachedKeys = Array.from(keySet);
    return cachedTriangles;
  }

  function statsChanged(a, b) {
    if (!a || !b) return true;
    return (
      a.total !== b.total ||
      a.hovered !== b.hovered ||
      a.percentage !== b.percentage ||
      a.avgHoverMs !== b.avgHoverMs ||
      (a.unvisited?.length || 0) !== (b.unvisited?.length || 0)
    );
  }

  function computeStats() {
    if (!cachedTriangles.length) collectTriangles();

    const total = cachedKeys.length;
    let hovered = 0;
    const unvisitedKeys = [];

    for (const key of cachedKeys) {
      const d = hoverDataByKey.get(key);
      const isHovered = !!(d && d.hovered);
      if (isHovered) hovered += 1;
      else unvisitedKeys.push(key);
    }

    const percentage = total ? Math.round((hovered / total) * 100) : 0;

    let sumMs = 0;
    let itemCnt = 0;
    for (const [key, d] of hoverDataByKey.entries()) {
      if (cachedKeys.includes(key) && d.total > 0) {
        sumMs += d.total;
        itemCnt += 1;
      }
    }

    const avgHoverMs = itemCnt ? Math.round(sumMs / itemCnt) : 0;
    const unvisited = unvisitedKeys.map(displayLabelForKey);

    const stats = { total, hovered, percentage, unvisited, avgHoverMs };

    if (statsChanged(stats, lastStats)) {
      lastStats = { ...stats };
      console.log("[HoverTracker] Stats:", stats);
    }

    return stats;
  }

  function ensurePanel() {
    if (!HOVER_TRACKER_ENABLED) return null;
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "ai-policy-progress";
    panel.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      right: 12px;
      bottom: 12px;
      background: rgba(20,20,20,.92);
      color: #fff;
      font: 12px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Arial;
      padding: 10px 12px;
      border-radius: 10px;
      box-shadow: 0 6px 16px rgba(0,0,0,.35);
      display: flex;
      align-items: center;
      gap: 10px;
      user-select: none;
    `;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span id="ai-count" style="font-weight:600;">0 / 0</span>
        <span id="ai-percent" style="opacity:.9">0%</span>
      </div>
      <div id="ai-dot"
        style="width:10px;height:10px;border-radius:50%;background:#ef4444;">
      </div>
    `;

    document.documentElement.appendChild(panel);
    return panel;
  }

  function updateChip(stats) {
    if (!HOVER_TRACKER_ENABLED) return;

    const el = ensurePanel();
    if (!el) return;

    const { total, hovered, percentage } = stats;

    el.querySelector("#ai-count").textContent = `${hovered} / ${total}`;
    el.querySelector("#ai-percent").textContent = `${percentage}%`;

    const dot = el.querySelector("#ai-dot");

    let bg = "#ef4444";
    if (percentage >= 90) bg = "#22c55e";
    else if (percentage >= 50) bg = "#f59e0b";

    dot.style.background = bg;
  }

  function render() {
    collectTriangles();
    updateChip(computeStats());
  }

  function installDelegatedHover() {

    document.addEventListener("mouseover", (e) => {
      const tri = e.target instanceof Element ? e.target.closest(TRIANGLE) : null;
      if (!tri) return;

      const key = serviceCodeKeyForTriangle(tri);
      const d = ensureHoverDataByKey(key);

      if (d.startedAt == null) d.startedAt = performance.now();

      if (!d.hovered) {
        setTimeout(() => {
          const dd = ensureHoverDataByKey(key);
          dd.hovered = true;
          tri.setAttribute(HOVER_ATTR, "1");
          const s = computeStats();
          updateChip(s);
          onChange?.(s);
        }, DWELL_MS);
      }
    }, { passive: true, capture: true });

    document.addEventListener("mouseout", (e) => {
      const tri = e.target instanceof Element ? e.target.closest(TRIANGLE) : null;
      if (!tri) return;

      const key = serviceCodeKeyForTriangle(tri);
      const d = ensureHoverDataByKey(key);

      if (d.startedAt != null) {
        const dur = performance.now() - d.startedAt;
        d.total += dur;
        d.count += 1;
        d.startedAt = null;
        const s = computeStats();
        updateChip(s);
        onChange?.(s);
      }
    }, { passive: true, capture: true });

  }

  AIExt.hoverTracker = {
    init({ onChange: onChangeCb } = {}) {
      console.log("[HoverTracker] Initializing…");
      onChange = onChangeCb || null;
      ensurePanel();
      installDelegatedHover();
      render();
    },
    refresh() {
      render();
    },
    getSnapshot() {
      return computeStats();
    },
  };

})();
