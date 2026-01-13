// vehiclePolicyTracker.js
// Track interaction with Vehicle Policy Highlights area.
//
// Tracks:
// - requires_scroll: whether the policy box needs scrolling (scrollHeight > clientHeight)
// - scrolled: whether user scrolled it (scrollTop change)
// - hover_ms: total mouse time inside the panel (#pageSidePanelLeft)
//
// Implementation notes:
// - Hover is tracked on #pageSidePanelLeft.
// - Scroll detection/measurement is tracked on the actual scroll element inside the panel.
//   Primary selector (from your inspect):
//     #pageSidePanelLeft > div > div > section > div.MuiCardContent-root.css-1oekbi8
//   Fallback: find the best scroll candidate inside the panel (in case css hash changes).
// - Adds a slight delayed measurement after attach/refresh to avoid measuring too early.
// - Console debug logs ONLY when snapshot changes.
// - No UI.

window.AIExt = window.AIExt || {};

(function () {
  const PANEL_SELECTOR = "#pageSidePanelLeft";

  // Prefer your exact inspected selector, but keep it robust with fallback.
  const SCROLL_SELECTOR_EXACT =
    '#pageSidePanelLeft > div > div > section > div.MuiCardContent-root.css-1oekbi8';
  // More resilient fallback selector (if css hash changes)
  const SCROLL_SELECTOR_FALLBACK = "#pageSidePanelLeft section .MuiCardContent-root";

  const MEASURE_DELAY_MS = 300;

  // ----- State -----
  let lastURL = location.href;

  let panelEl = null; // hover region
  let scrollEl = null; // actual scroll region

  let requiresScroll = null; // boolean|null
  let initialScrollTop = 0;
  let scrolled = false;

  let hoverActive = false;
  let hoverStartMs = 0;
  let totalHoverMs = 0;

  // Debug: only log when snapshot changes
  let lastSig = "";
  let lastSnap = null;

  // ----- Helpers -----
  function nowMs() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }
  function clamp0(n) {
    return n > 0 ? n : 0;
  }
  function getPanel() {
    return document.querySelector(PANEL_SELECTOR);
  }

  function measureRequiresScroll(el) {
    if (!el) return null;
    const ch = el.clientHeight || 0;
    const sh = el.scrollHeight || 0;
    if (!ch || !sh) return null;
    return sh > ch + 2;
  }

  function findBestScrollContainer(panel) {
    if (!panel) return null;

    // Prefer elements that actually have scrollable extent.
    const all = Array.from(panel.querySelectorAll("*"));
    let best = null;
    let bestExtent = 0;

    for (const el of all) {
      const ch = el.clientHeight || 0;
      const sh = el.scrollHeight || 0;
      if (!ch || !sh) continue;
      const extent = sh - ch;
      if (extent > bestExtent + 2) {
        best = el;
        bestExtent = extent;
      }
    }
    return best;
  }

  function getScrollEl(panel) {
    // 1) Exact selector
    const exact = document.querySelector(SCROLL_SELECTOR_EXACT);
    if (exact) return exact;

    // 2) Resilient selector (no css hash)
    const fallback = document.querySelector(SCROLL_SELECTOR_FALLBACK);
    if (fallback) return fallback;

    // 3) Fallback heuristic
    return findBestScrollContainer(panel);
  }

  function computeSnapshot() {
    const liveHover = hoverActive ? clamp0(nowMs() - hoverStartMs) : 0;
    const hoverMs = Math.round(totalHoverMs + liveHover);

    const se = scrollEl && scrollEl.isConnected ? scrollEl : null;
    const scrollTop = se ? Math.round(se.scrollTop || 0) : null;
    const maxScrollTop = se ? Math.round((se.scrollHeight || 0) - (se.clientHeight || 0)) : null;

    return {
      requires_scroll: requiresScroll, // boolean|null
      scrolled: scrolled, // boolean
      hover_ms: hoverMs, // integer ms
      scroll_top: scrollTop, // integer px|null
      max_scroll_top: maxScrollTop, // integer px|null
      scroll_el_found: Boolean(se), // boolean diagnostic
    };
  }

  function signatureOf(s) {
    // Avoid noisy fields; but include enough to detect meaningful changes.
    return [
      `req=${s.requires_scroll}`,
      `did=${s.scrolled}`,
      `hover=${s.hover_ms}`,
      `top=${s.scroll_top}`,
      `max=${s.max_scroll_top}`,
      `found=${s.scroll_el_found}`,
    ].join("|");
  }

  function diffSummary(prev, next) {
    if (!prev)
      return `init req=${next.requires_scroll} scrolled=${next.scrolled} hover_ms=${next.hover_ms}`;

    const parts = [];
    if (prev.requires_scroll !== next.requires_scroll)
      parts.push(`requires_scroll ${prev.requires_scroll}→${next.requires_scroll}`);
    if (prev.scrolled !== next.scrolled) parts.push(`scrolled ${prev.scrolled}→${next.scrolled}`);
    if (prev.hover_ms !== next.hover_ms) parts.push(`hover_ms ${prev.hover_ms}→${next.hover_ms}`);
    if (prev.scroll_el_found !== next.scroll_el_found)
      parts.push(`scroll_el_found ${prev.scroll_el_found}→${next.scroll_el_found}`);
    if ((prev.max_scroll_top ?? 0) === 0 && (next.max_scroll_top ?? 0) > 0)
      parts.push(`max_scroll_top 0→${next.max_scroll_top}`);
    return parts.length ? parts.join(", ") : "no-op";
  }

  function emitIfChanged(reason) {
    // IMPORTANT: do NOT call AIExt.vehiclePolicyTracker.getSnapshot() here (recursion risk);
    // compute directly.
    const snap = computeSnapshot();
    const sig = signatureOf(snap);
    if (sig === lastSig) return;

    const msg = diffSummary(lastSnap, snap);
    lastSig = sig;
    lastSnap = snap;

    console.log(`[VehiclePolicyTracker] ${reason}: ${msg}`, snap);
    AIExt.vehiclePolicyTracker?.onChange?.(snap);
  }

  let measureTimer = null;
  function delayedMeasureScroll(delayMs = MEASURE_DELAY_MS) {
    if (measureTimer) {
      clearTimeout(measureTimer);
      measureTimer = null;
    }

    measureTimer = setTimeout(() => {
      measureTimer = null;
      if (!scrollEl || !scrollEl.isConnected) return;

      const req = measureRequiresScroll(scrollEl);
      if (req != null) requiresScroll = req;

      emitIfChanged("delayed-measure");
    }, delayMs);
  }

  // ----- Event handlers -----
  function onScroll() {
    if (!scrollEl) return;

    const top = scrollEl.scrollTop || 0;
    if (!scrolled && Math.abs(top - initialScrollTop) > 1) scrolled = true;

    // Re-measure on scroll as well (content may load lazily)
    const req = measureRequiresScroll(scrollEl);
    if (req != null) requiresScroll = req;

    emitIfChanged("scroll");
  }

  function onMouseEnter() {
    if (hoverActive) return;
    hoverActive = true;
    hoverStartMs = nowMs();
    emitIfChanged("mouseenter");
  }

  function onMouseLeave() {
    if (!hoverActive) return;
    totalHoverMs += clamp0(nowMs() - hoverStartMs);
    hoverActive = false;
    hoverStartMs = 0;
    emitIfChanged("mouseleave");
  }

  // ----- Attach / detach -----
  function attach(panel) {
    panelEl = panel;

    // Hover listeners on panel
    panelEl.addEventListener("mouseenter", onMouseEnter, { passive: true });
    panelEl.addEventListener("mouseleave", onMouseLeave, { passive: true });

    // Resolve scroll element
    scrollEl = getScrollEl(panelEl);

    if (scrollEl) {
      initialScrollTop = scrollEl.scrollTop || 0;
      requiresScroll = null; // defer initial decision
      scrolled = false;

      scrollEl.addEventListener("scroll", onScroll, { passive: true });

      // Measure after layout settles
      delayedMeasureScroll(MEASURE_DELAY_MS);
    } else {
      initialScrollTop = 0;
      requiresScroll = null;
      scrolled = false;
    }

    // Reset debug baseline so first attach logs
    lastSig = "";
    lastSnap = null;
    emitIfChanged("attach");
  }

  function detach() {
    if (measureTimer) {
      clearTimeout(measureTimer);
      measureTimer = null;
    }

    if (panelEl && panelEl.isConnected) {
      panelEl.removeEventListener("mouseenter", onMouseEnter);
      panelEl.removeEventListener("mouseleave", onMouseLeave);
    }
    if (scrollEl && scrollEl.isConnected) {
      scrollEl.removeEventListener("scroll", onScroll);
    }

    panelEl = null;
    scrollEl = null;

    requiresScroll = null;
    initialScrollTop = 0;
    scrolled = false;

    hoverActive = false;
    hoverStartMs = 0;
    totalHoverMs = 0;

    lastSig = "";
    lastSnap = null;
  }

  // ----- Boot / retry -----
  function bootRetryUntilFound() {
    let tries = 0;
    const maxTries = 40; // ~10s

    const timer = setInterval(() => {
      tries++;

      const p = getPanel();
      if (p) {
        // Try to ensure scroll element exists too (lazy render)
        const se = getScrollEl(p);
        if (se || tries >= maxTries) {
          clearInterval(timer);
          attach(p);
        }
        return;
      }

      if (tries >= maxTries) {
        clearInterval(timer);
        emitIfChanged("not-found");
      }
    }, 250);
  }

  // ----- URL change watcher -----
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
      if (location.href === lastURL) return;
      lastURL = location.href;

      console.log("[VehiclePolicyTracker] URL changed; refreshing…");
      detach();
      setTimeout(() => bootRetryUntilFound(), 50);
    });
  }

  // ----- Public API -----
  AIExt.vehiclePolicyTracker = {
    onChange: null,

    init({ onChange } = {}) {
      console.log("[VehiclePolicyTracker] Initializing…");
      this.onChange = typeof onChange === "function" ? onChange : null;

      installURLChangeListener();
      bootRetryUntilFound();
    },

    refresh() {
      const p = getPanel();
      if (!p) {
        detach();
        emitIfChanged("refresh-not-found");
        return this.getSnapshot();
      }

      // If panel node changed or was detached, reattach.
      if (panelEl !== p || !panelEl?.isConnected) {
        detach();
        attach(p);
        return this.getSnapshot();
      }

      // Re-resolve scroll element in case css hash / structure changed.
      const newScroll = getScrollEl(panelEl);

      if (newScroll !== scrollEl) {
        if (scrollEl && scrollEl.isConnected) {
          scrollEl.removeEventListener("scroll", onScroll);
        }

        scrollEl = newScroll;

        if (scrollEl) {
          initialScrollTop = scrollEl.scrollTop || 0;
          requiresScroll = null;
          scrolled = false;

          scrollEl.addEventListener("scroll", onScroll, { passive: true });

          delayedMeasureScroll(MEASURE_DELAY_MS);
        } else {
          initialScrollTop = 0;
          requiresScroll = null;
          scrolled = false;
        }

        emitIfChanged("refresh-rebind");
        return this.getSnapshot();
      }

      // Same scroll element; re-measure with a slight delay.
      if (scrollEl && scrollEl.isConnected) {
        requiresScroll = null;
        delayedMeasureScroll(MEASURE_DELAY_MS);
      } else {
        requiresScroll = null;
      }

      emitIfChanged("refresh");
      return this.getSnapshot();
    },

    getSnapshot() {
      return computeSnapshot();
    },
  };
})();
