// hoverTracker.js
// Depends on: utils.js (AIExt.utils) and approvalState.js (AIExt.approval)
// Behavior:
// - Tracks user hover over policy triangles.
// - Uses approval state from approvalState.js; shows only UNAPPROVED items.
// - FREEZES states at RO load; does NOT refresh when agent actions change UI.
// - UNFREEZES and re-freezes only after URL change (new RO).

window.AIExt = window.AIExt || {};

(function () {
  const { qAll, lineItemRoot, escapeHtml } = AIExt.utils;
  const { Approval, getApprovalState } = AIExt.approval;

  const TRIANGLE = '[data-testid="ServiceCodeNotesIcon"]';
  const HOVER_ATTR = 'data-policy-hovered';
  const DWELL_MS = 1; // minimal dwell before marking hovered

  // ---------- Label helpers ----------
  function textClean(el) {
    if (!el) return "";
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }
  function getField(container, label) {
    const node =
      container.querySelector(
        `h1[aria-label="${label}"],h2[aria-label="${label}"],h3[aria-label="${label}"],h4[aria-label="${label}"],h5[aria-label="${label}"],h6[aria-label="${label}"]`
      ) || container.querySelector(`[aria-label="${label}"]`);
    return textClean(node);
  }
  function containerForTriangle(tri) {
    return (
      tri.closest?.(
        '[role="row"],[role="group"],[role="region"],section,article,.MuiCard-root,.card,.panel,.row,.item,.list-item'
      ) || tri.parentElement || document.body
    );
  }
  function labelForTriangle(tri) {
    const container = containerForTriangle(tri);
    const itemType = getField(container, "Item Type");
    const serviceCode = getField(container, "Service Code");
    if (itemType && serviceCode) return `${itemType} — ${serviceCode}`;
    return itemType || serviceCode || "";
  }

  // ---------- internals ----------
  let onChange = null;
  let panel = null, popover = null;
  let cachedTriangles = [];

  // Per-triangle hover timing. We accumulate total dwell across visits.
  // { total: ms, count: #completed hovers, startedAt: number|null }
  let hoverData = new WeakMap();

  // Track URL so we can detect SPA navigations.
  let lastURL = location.href;

  function ensureHoverData(tri) {
    let d = hoverData.get(tri);
    if (!d) { d = { total: 0, count: 0, startedAt: null }; hoverData.set(tri, d); }
    return d;
  }

  function collectTriangles() {
    cachedTriangles = qAll(TRIANGLE).filter(tri => {
      const root = lineItemRoot(tri);
      const st = getApprovalState(root);
      tri.setAttribute('data-approval', st);
      return st === Approval.UNAPPROVED;
    });
    return cachedTriangles;
  }

  // ---- changed-only console logging gate ----
  let lastStats = null;
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
    const list = cachedTriangles.length ? cachedTriangles : collectTriangles();
    const total = list.length;
    const hovered = list.filter(t => t.getAttribute(HOVER_ATTR) === "1").length;
    const percentage = total ? Math.round((hovered / total) * 100) : 0;
    const unvisited = list
      .filter(t => t.getAttribute(HOVER_ATTR) !== "1")
      .map(t => labelForTriangle(t) || "Untitled item");

    // Average hover time per unique item
    let sumMs = 0;
    let itemCnt = 0;
    for (const tri of list) {
      const d = hoverData.get(tri);
      if (d && d.total > 0) {
        sumMs += d.total;
        itemCnt += 1;
      }
    }
    const avgHoverMs = itemCnt ? Math.round(sumMs / itemCnt) : 0;

    const stats = { total, hovered, percentage, unvisited, avgHoverMs };

    if (statsChanged(stats, lastStats)) {
      lastStats = { ...stats };
      console.log("[HoverTracker] Stats:", stats);
    }

    return stats;
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'ai-policy-progress';
    panel.style.cssText = `
      position: fixed; z-index: 2147483647; right: 12px; bottom: 12px;
      background: rgba(20,20,20,.92); color: #fff; font: 12px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Arial;
      padding: 10px 12px; border-radius: 10px; box-shadow: 0 6px 16px rgba(0,0,0,.35);
      display: flex; align-items: center; gap: 10px; cursor: default; user-select: none;
    `;
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span id="ai-count" style="font-weight:600;">0 / 0</span>
        <span id="ai-percent" style="opacity:.9">0%</span>
      </div>
      <div id="ai-dot" style="width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow: 0 0 0 2px rgba(255,255,255,.12);" aria-label="Progress status"></div>
    `;
    document.documentElement.appendChild(panel);

    // drag (simple)
    let drag = null;
    panel.addEventListener('mousedown', (e) => {
      drag = { sx: e.clientX, sy: e.clientY, right: parseInt(panel.style.right) || 12, bottom: parseInt(panel.style.bottom) || 12 };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      panel.style.right = `${Math.max(0, drag.right - dx)}px`;
      panel.style.bottom = `${Math.max(0, drag.bottom - dy)}px`;
    });
    window.addEventListener('mouseup', () => (drag = null));

    // popover hooks
    panel.addEventListener('mouseenter', showPopover, { passive: true });
    panel.addEventListener('mouseleave', hidePopover, { passive: true });

    return panel;
  }

  function updateChip(stats) {
    const { total, hovered, percentage } = stats;
    const el = ensurePanel();
    el.querySelector('#ai-count').textContent = `${hovered} / ${total}`;
    el.querySelector('#ai-percent').textContent = `${percentage}%`;

    const dot = el.querySelector('#ai-dot');
    let bg = "#ef4444";
    if (percentage >= 90) bg = "#22c55e";
    else if (percentage >= 50) bg = "#f59e0b";
    dot.style.background = bg;
  }

  function render() {
    collectTriangles();
    updateChip(computeStats());
  }

  // ---------- delegated hover detection + timing ----------
  function installDelegatedHover() {
    // Start timing when entering triangle from outside it
    document.addEventListener('mouseover', (e) => {
      const tri = (e.target instanceof Element) ? e.target.closest(TRIANGLE) : null;
      if (!tri) return;

      const rel = (e.relatedTarget instanceof Element) ? e.relatedTarget : null;
      if (rel && tri.contains(rel)) return; // still inside same element

      const d = ensureHoverData(tri);
      if (d.startedAt == null) d.startedAt = performance.now();

      // mark as hovered after minimal dwell
      if (tri.getAttribute(HOVER_ATTR) !== '1') {
        setTimeout(() => {
          tri.setAttribute(HOVER_ATTR, '1');
          const s = computeStats();
          updateChip(s);
          onChange?.(s);
        }, DWELL_MS);
      }
    }, { passive: true, capture: true });

    // Stop timing when leaving triangle to outside it
    document.addEventListener('mouseout', (e) => {
      const tri = (e.target instanceof Element) ? e.target.closest(TRIANGLE) : null;
      if (!tri) return;

      const to = (e.relatedTarget instanceof Element) ? e.relatedTarget : null;
      if (to && tri.contains(to)) return; // moving within same element

      const d = ensureHoverData(tri);
      if (d.startedAt != null) {
        const dur = performance.now() - d.startedAt;
        d.total += dur;  // stack time for this same item
        d.count += 1;
        d.startedAt = null;

        const s = computeStats();
        updateChip(s);
        onChange?.(s);
      }
    }, { passive: true, capture: true });
  }

  // ---------- RO freeze handling ----------
  function uniqueRootsFromTriangles(tris) {
    const set = new Set();
    tris.forEach(t => {
      const root = lineItemRoot(t);
      if (root) set.add(root);
    });
    return Array.from(set);
  }

  function freezeCurrentRO() {
    // Freeze once the triangles for this RO are present.
    const tris = qAll(TRIANGLE);
    const roots = uniqueRootsFromTriangles(tris);
    AIExt.approval.freezeAll(roots);
    // Refresh cache-backed attributes and UI
    render();
  }

  function clearFrozenFromPreviousRO() {
    // Unfreeze everything from prior RO and reset caches/state
    const { unfreezeAll, invalidateApprovalCache, FROZEN_ATTR } = AIExt.approval;

    // Use attribute selector to unfreeze any leftover nodes from the previous screen
    const candidates = document.querySelectorAll(`[${FROZEN_ATTR}]`);
    unfreezeAll(candidates);

    invalidateApprovalCache();
    cachedTriangles = [];
    hoverData = new WeakMap();
    lastStats = null;

    // Reset UI chip immediately
    updateChip({ total: 0, hovered: 0, percentage: 0, unvisited: [], avgHoverMs: 0 });
    hidePopover();
  }

  // ---------- boot-time retry to survive SPA timing ----------
  function bootRetryUntilFound() {
    let tries = 0;
    const maxTries = 20; // ~5s
    const timer = setInterval(() => {
      tries++;
      collectTriangles();
      const s = computeStats();
      if (s.total > 0 || tries >= maxTries) {
        clearInterval(timer);
        // First time we "see" the RO, freeze its states
        freezeCurrentRO();
      } else {
        // keep chip updated while waiting
        updateChip(s);
      }
    }, 250);
  }

  // ---------- popover ----------
  function showPopover() {
    if (popover && popover.isConnected) { buildPopover(popover); return; }
    popover = document.createElement('div');
    popover.style.cssText = `
      position: fixed; z-index: 2147483647; max-width: 360px;
      right: ${parseInt(panel.style.right || 12)}px;
      bottom: ${parseInt(panel.style.bottom || 12) + 44}px;
      background: rgba(20,20,20,.98); color:#fff; border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,.45); padding: 10px 12px; font: 12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial;
      border: 1px solid rgba(255,255,255,.08);
    `;
    popover.addEventListener('mouseleave', hidePopover, { passive: true });
    buildPopover(popover);
    document.documentElement.appendChild(popover);
  }
  function hidePopover() { if (popover) { popover.remove(); popover = null; } }

  function buildPopover(el) {
    const list = cachedTriangles.length ? cachedTriangles : collectTriangles();
    const unvisited = list.filter(t => t.getAttribute(HOVER_ATTR) !== '1');
    const items = unvisited.map((t) => ({ tri: t, label: labelForTriangle(t) || "Untitled item" }));

    const summary = `<div style="opacity:.85;margin-bottom:8px;font-weight:600;">Remaining: ${items.length}</div>`;
    const html = items.length
      ? `<ul style="margin:0;padding:0;list-style:none;max-height:240px;overflow:auto;">
          ${items.map(({ label }, idx) => `
            <li data-idx="${idx}" style="padding:6px;border-radius:8px;margin:2px 0;display:flex;gap:8px;">
              <span style="opacity:.65;min-width:1.5em;text-align:right;">${idx + 1}.</span>
              <span style="flex:1 1 auto;word-break:break-word;">${escapeHtml(label)}</span>
            </li>`).join("")}
        </ul>`
      : `<div style="opacity:.9;">Nice! You’ve hovered everything.</div>`;
    el.innerHTML = summary + html;
  }

  // ---------- URL-change detection (SPA & navigation) ----------
  function installURLChangeListener() {
    // Monkey-patch pushState/replaceState to emit a custom event
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
      // Debounce distinct URL values only
      const href = location.href;
      if (href === lastURL) return;
      lastURL = href;

      console.log("[HoverTracker] URL changed; refreshing for new RO…");
      clearFrozenFromPreviousRO();
      // Wait a tiny bit for the new RO DOM to render, then freeze it.
      setTimeout(() => {
        bootRetryUntilFound();
      }, 50);
    });
  }

  // ---------- public API ----------
  AIExt.hoverTracker = {
    init({ onChange: onChangeCb } = {}) {
      console.log("[HoverTracker] Initializing…");
      onChange = onChangeCb || null;
      ensurePanel();
      installDelegatedHover();
      installURLChangeListener();
      render();
      bootRetryUntilFound(); // will freeze once items are found
    },
    refresh() { render(); },
    getSnapshot() { return computeStats(); }
  };
})();
