// content/replacementGuard.js
// Full-screen overlay; shows once per RO per page load (no persistence across reloads)
window.AIExt = window.AIExt || {};

(function () {
  const OVERLAY_ID = "replacement-policy-overlay";
  const DEFAULT_DELAY_MS = 3000; // ⏱ default startup delay

  // ---------- IN-MEMORY (session/page-only) VISITED MAP ----------
  // Keyed by getCurrentROKey(); cleared on reload, not persisted.
  const _visitedMap = Object.create(null);

  // ---------- DOM HELPERS ----------
  function createOverlay({ id, themeColor, title, lines, buttonText, onPrimary }) {
    const pre = document.getElementById(id);
    if (pre) pre.remove();

    const overlay = document.createElement("div");
    overlay.id = id;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", title);

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      backgroundColor: "rgba(0,0,0,0.85)",
      zIndex: 99999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      background: "white",
      border: `8px solid ${themeColor}`,
      borderRadius: "14px",
      padding: "40px",
      textAlign: "center",
      maxWidth: "720px",
      width: "min(92vw, 720px)",
      boxShadow: `0 0 40px ${themeColor}`,
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    });

    const iconWrap = document.createElement("div");
    iconWrap.style.marginBottom = "20px";
    iconWrap.innerHTML = `
      <svg width="140" height="140" viewBox="0 0 120 110" aria-hidden="true">
        <polygon points="60,5 115,105 5,105" fill="${themeColor}" stroke="${themeColor}" stroke-width="2"></polygon>
        <rect x="55" y="32" width="10" height="40" fill="white" rx="2"></rect>
        <circle cx="60" cy="83" r="6" fill="white"></circle>
      </svg>
    `;

    const h1 = document.createElement("h1");
    h1.textContent = title;
    Object.assign(h1.style, {
      fontSize: "28px",
      margin: "0 0 8px",
      color: themeColor,
      letterSpacing: "0.5px",
    });

    const desc = document.createElement("div");
    desc.innerHTML = lines.map(l => `<p style="margin:8px 0;font-size:18px;line-height:1.4;color:#111">${l}</p>`).join("");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = buttonText || "Open Replacement Tab";
    Object.assign(btn.style, {
      marginTop: "22px",
      backgroundColor: themeColor,
      color: "white",
      fontSize: "18px",
      border: "none",
      padding: "12px 28px",
      borderRadius: "8px",
      cursor: "pointer",
      boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
    });

    btn.addEventListener("click", () => {
      try { onPrimary && onPrimary(); } catch (_) {}
      try { overlay.remove(); } catch (_) {}
    });

    panel.appendChild(iconWrap);
    panel.appendChild(h1);
    panel.appendChild(desc);
    panel.appendChild(btn);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  function getVehicleDetailsScope() {
    const tab = Array.from(document.querySelectorAll('button[role="tab"]'))
      .find(b => /vehicle\s*details/i.test(b.textContent || ""));
    const panelId = tab?.getAttribute("aria-controls");
    const panel = panelId ? document.getElementById(panelId) : null;
    return panel || document;
  }

  function cssEscape(s) {
    return (window.CSS && window.CSS.escape) ? window.CSS.escape(s) : String(s).replace(/([^\w-])/g, "\\$1");
  }

  // ---------- CURRENT RO KEY ----------
  function getCurrentROKey() {
    const scope = getVehicleDetailsScope();

    // Try common labels first
    const label = Array.from(scope.querySelectorAll("span,div,dt,th,strong,label"))
      .find(el => /\b(?:RO|RO\s*#|Repair\s*Order|Work\s*Order)\b/i.test((el.textContent || "").trim()));
    if (label) {
      // ARIA-linked value
      if (label.id) {
        const id = cssEscape(label.id);
        const byAria = scope.querySelector(`[aria-labelledby~="${id}"],[aria-describedby~="${id}"]`);
        const text = byAria && byAria.textContent ? byAria.textContent.trim() : "";
        if (text) return `RO:${text}`;
      }
      // Same row/sibling value
      const row = label.closest('[role="row"],[class*="Row"],[class*="Grid"],[class*="Stack"],[class*="Details"],[class*="Data"]');
      if (row) {
        const cand = Array.from(row.querySelectorAll("a,span,strong,div"))
          .map(n => (n.textContent || "").trim())
          .filter(Boolean)
          .find(t => !/\b(?:RO|Repair\s*Order|Work\s*Order)\b/i.test(t));
        if (cand) return `RO:${cand}`;
      }
      let sib = label.nextElementSibling;
      for (let i = 0; i < 3 && sib; i++, sib = sib.nextElementSibling) {
        const txt = (sib.textContent || "").trim();
        if (txt && !/\b(?:RO|Repair\s*Order|Work\s*Order)\b/i.test(txt)) return `RO:${txt}`;
      }
    }

    // Fallbacks: a data attribute or URL + a vehicle identifier
    const vehIdEl = scope.querySelector('[data-vehicle-id],[data-id],[data-ro-id]');
    if (vehIdEl) {
      const v = vehIdEl.getAttribute("data-vehicle-id") || vehIdEl.getAttribute("data-ro-id") || vehIdEl.getAttribute("data-id");
      if (v) return `RO:${v}`;
    }

    // Last resort: use URL path + any visible VIN/Unit number
    const vin = Array.from(scope.querySelectorAll("span,div,code"))
      .map(x => (x.textContent || "").trim())
      .find(t => /^[A-HJ-NPR-Z0-9]{11,17}$/.test(t)); // rough VIN
    return `URL:${location.pathname}${vin ? `#${vin}` : ""}`;
  }

  function readVehicleStatusText() {
    const scope = getVehicleDetailsScope();

    const label = Array.from(scope.querySelectorAll("span,div,dt,th,strong"))
      .find(el => /\bvehicle\s*status\b/i.test((el.textContent || "").trim()));
    if (!label) return "";

    if (label.id) {
      const id = cssEscape(label.id);
      const byAria = scope.querySelector(`[aria-labelledby~="${id}"],[aria-describedby~="${id}"]`);
      const text = byAria && byAria.textContent ? byAria.textContent.trim() : "";
      if (text) return text;
    }

    const row = label.closest('[role="row"],[class*="Row"],[class*="Grid"],[class*="Stack"],[class*="vehicleDetails"],[class*="Data"]');
    if (row) {
      const cand = Array.from(row.querySelectorAll("a,span,strong,div"))
        .map(n => (n.textContent || "").trim())
        .filter(Boolean)
        .find(t => !/\bvehicle\s*status\b/i.test(t));
      if (cand) return cand;
    }

    let sib = label.nextElementSibling;
    for (let i = 0; i < 4 && sib; i++, sib = sib.nextElementSibling) {
      const txt = (sib.textContent || "").trim();
      if (txt && !/\bvehicle\s*status\b/i.test(txt)) return txt;
    }

    const guess = Array.from(scope.querySelectorAll("a,span,strong,div"))
      .map(x => (x.textContent || "").trim())
      .find(t => /(pending\s*replacement|active|retired|total\s*loss|replacement)/i.test(t));
    return guess || "";
  }

  function findReplacementTabButton() {
    return Array.from(document.querySelectorAll('[role="tab"]'))
      .find(b => /replacement/i.test(b.textContent || ""));
  }

  function isReplacementTabActive(btn) {
    if (!btn) return false;
    if (btn.getAttribute("aria-selected") === "true") return true;
    if ((btn.className || "").includes("Mui-selected")) return true;
    const panelId = btn.getAttribute("aria-controls");
    if (panelId) {
      const panel = document.getElementById(panelId);
      if (panel && panel.offsetParent !== null) return true;
    }
    return false;
  }

  function removeOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
  }

  // ---------- RENDER (idempotent) ----------
  function render(statusText, replacementTabActive, alreadyVisited) {
    const overlay = document.getElementById(OVERLAY_ID);
    const isPending = /pending\s*replacement/i.test(statusText || "");
    const shouldShow = isPending && !replacementTabActive && !alreadyVisited;

    if (shouldShow) {
      if (!overlay) {
        createOverlay({
          id: OVERLAY_ID,
          themeColor: "#F59E0B", // amber
          title: "PENDING REPLACEMENT — ACTION REQUIRED",
          lines: [
            "This vehicle’s <b>Vehicle Status</b> is <b>Pending Replacement</b>.",
            "Open the <b>Replacement</b> tab and review the replacement details/status.",
            "Policy reminders:",
            "<ul style='margin:6px 0 0 18px;text-align:left'>"
              + "<li><b>US Units:</b> Approve only oil changes and safety related repairs.</li>"
              + "<li><b>CA Units:</b> Always send to the MCP for review.</li>"
              + "<li>Refer to <a href=\"onenote:https://elementfinancialcorporation.sharepoint.com/sites/FleetCommunities/SC/LearningandDevelopment/Shared%20Documents/ONE%20NOTE%20MM%20source%20files/OneNote%20Page%20Files/Maintenance/SOP%27s.one#New%20Vehicle%20on%20Order&section-id=%7B0590F175-811B-4F0B-8982-35273B93520B%7D&page-id=%7B24475002-7B4B-4E19-831B-9AE2232D008E%7D&object-id=%7BD032C083-55A5-0143-0A46-F89772412467%7D&12\" target=\"_blank\">New Vehicle on Order</a> for more details.</li>"
              + "</ul>"
          ],
          buttonText: "Go to Replacement Tab",
          onPrimary: () => {
            // Do not mark visited on click alone—wait until the tab is actually active.
            const btn = findReplacementTabButton();
            if (btn) btn.click();
          }
        });
      }
    } else if (overlay) {
      overlay.remove();
    }
  }

  // ---------- STATE LOOP ----------
  let last = { status: "", replacementTabVisited: false, roKey: "", visitedForRO: false };
  let _mo; // observer ref
  let _checking = false; // re-entrancy guard

  function check() {
    if (_checking) return;
    _checking = true;
    try {
      const status = readVehicleStatusText();
      const btn = findReplacementTabButton();
      const active = isReplacementTabActive(btn);
      const roKey = getCurrentROKey();
      const alreadyVisited = !!_visitedMap[roKey];

      // If they open the Replacement tab at least once for this RO, mark visited (page-only).
      if (active && roKey && !alreadyVisited) {
        _visitedMap[roKey] = true;
      }

      render(status, active, alreadyVisited);

      // Log only on meaningful change
      if (
        status !== last.status ||
        active !== last.replacementTabVisited ||
        roKey !== last.roKey ||
        alreadyVisited !== last.visitedForRO
      ) {
        last = { status, replacementTabVisited: active, roKey, visitedForRO: alreadyVisited };
        console.log("[ReplacementGuard]", { status, replacementTabVisited: active, roKey, visitedForRO: alreadyVisited });
      }
    } finally {
      _checking = false;
    }
  }

  function start() {
    // initial check
    check();

    _mo = new MutationObserver((mutations) => {
      // If *all* mutations are happening inside the overlay, ignore them
      if (mutations.length > 0) {
        const allInsideOverlay = mutations.every(m => {
          const t = m.target && m.target.nodeType === 1 ? m.target : null;
          return t && t.closest && t.closest(`#${OVERLAY_ID}`);
        });
        if (allInsideOverlay) return;
      }
      check();
    });

    _mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-hidden", "aria-selected", "role", "aria-labelledby", "aria-describedby"],
    });

    // short retry loop for delayed hydration/paint
    let tries = 0, max = 24;
    const t = setInterval(() => {
      tries++; check();
      if (tries >= max) clearInterval(t);
    }, 250);

    // Handle SPA route changes: re-check on URL change.
    let _lastHref = location.href;
    setInterval(() => {
      if (location.href !== _lastHref) {
        _lastHref = location.href;
        removeOverlay(); // clear any stale overlay
        check();         // will show for new RO unless already marked visited in-memory
      }
    }, 500);
  }

  // ---------- PUBLIC API ----------
  AIExt.replacementGuard = {
    /**
     * Initialize the guard after a delay.
     * @param {number} delayMs - optional delay in ms (default 3000)
     */
    init(delayMs) {
      const cfgMs = Number(window.AIExt && window.AIExt.replacementGuardDelay);
      const ms = Number.isFinite(delayMs) ? delayMs
               : Number.isFinite(cfgMs) ? cfgMs
               : DEFAULT_DELAY_MS;

      const kickOff = () => {
        console.log(`[ReplacementGuard] Initializing in ${ms}ms…`);
        setTimeout(() => {
          console.log("[ReplacementGuard] Running initialization now…");
          start();
        }, ms);
      };

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", kickOff, { once: true });
      } else {
        kickOff();
      }
    },

    /** Debug snapshot */
    getSnapshot() { return { ...last }; },

    /** Optional: stop observing (handy if navigating away within SPA) */
    stop() {
      try { _mo && _mo.disconnect(); } catch (_) {}
      _mo = null;
      removeOverlay();
      console.log("[ReplacementGuard] Stopped.");
    }
  };
})();
