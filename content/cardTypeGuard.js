// cardTypeGuard.js
// Clean version — removes notifier popups, uses full-screen overlays only
window.AIExt = window.AIExt || {};

(function () {
  const STATE = Object.freeze({
    NATIONAL: "national",
    FUEL_ONLY: "fuel-only",
    UNKNOWN: "unknown",
  });

  // ---------- DOM HELPERS ----------
  function createOverlay({ id, themeColor, title, lines, buttonText }) {
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
    btn.textContent = buttonText || "Acknowledge";
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

    btn.addEventListener("click", () => overlay.remove());

    panel.appendChild(iconWrap);
    panel.appendChild(h1);
    panel.appendChild(desc);
    panel.appendChild(btn);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  // ---------- CARD TYPE SCRAPING ----------
  function getVehicleDetailsScope() {
    const tab = Array.from(document.querySelectorAll('button[role="tab"]'))
      .find(b => /vehicle\s*details/i.test(b.textContent || ""));
    const panelId = tab?.getAttribute("aria-controls");
    const panel = panelId ? document.getElementById(panelId) : null;
    return panel || document;
  }

  function readCardType() {
    const scope = getVehicleDetailsScope();

    const label = Array.from(scope.querySelectorAll("*"))
      .find(el => /card\s*type/i.test(el.textContent || ""));

    if (label) {
      const sib = label.nextElementSibling;
      const valText = (sib?.textContent || label.parentElement?.querySelector?.("a,span,strong,div")?.textContent || "").trim();
      if (valText) return valText;
    }

    const guess = Array.from(scope.querySelectorAll("a,span,strong,div"))
      .map(x => (x.textContent || "").trim())
      .find(t => /national\s+account\s+purchasing|fuel\s*only|wex\s*fuel\s*only/i.test(t));

    return guess || "";
  }

  function classify(cardTypeText) {
    const t = (cardTypeText || "").trim();
    if (/national\s+account\s+purchasing/i.test(t)) return STATE.NATIONAL;
    if (/fuel\s*only/i.test(t) || /wex\s*fuel\s*only/i.test(t)) return STATE.FUEL_ONLY;
    return STATE.UNKNOWN;
  }

  // ---------- RENDERING ----------
  function removeOverlays() {
    document.getElementById("fuel-only-overlay")?.remove();
    document.getElementById("national-overlay")?.remove();
  }

  function render(type) {
    removeOverlays();

    if (type === STATE.NATIONAL) {
      createOverlay({
        id: "national-overlay",
        themeColor: "#1363DF", // blue
        title: "NATIONAL ACCOUNT PURCHASING",
        lines: [
          "This vehicle is on our National Account (Blue Card) program.",
          "<b>Approve all repairs</b> — do not escalate to Client or MCP.",
        ],
        buttonText: "Got it",
      });
    } else if (type === STATE.FUEL_ONLY) {
      createOverlay({
        id: "fuel-only-overlay",
        themeColor: "#E11900", // red
        title: "FUEL ONLY CARD — ACTION REQUIRED",
        lines: [
          "This client is <b>NOT</b> on our maintenance program.",
          "<b>Reject all repairs</b> and refer the supplier to the driver for payment.",
        ],
        buttonText: "Acknowledge",
      });
    }
  }

  // ---------- STATE LOOP ----------
  let last = { type: "init", text: "" };
  function check() {
    const txt = readCardType();
    const type = classify(txt);
    if (type !== last.type || txt !== last.text) {
      last = { type, text: txt };
      console.log("[CardTypeGuard]", { type, text: txt });
      render(type);
    }
  }

  // ---------- PUBLIC API ----------
  AIExt.cardTypeGuard = {
    init() {
      console.log("[CardTypeGuard] Initializing…");
      check();

      const mo = new MutationObserver(() => check());
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true });

      let tries = 0, max = 24;
      const t = setInterval(() => {
        tries++; check();
        if (tries >= max) clearInterval(t);
      }, 250);
    },
    getSnapshot() { return { ...last }; }
  };
})();
