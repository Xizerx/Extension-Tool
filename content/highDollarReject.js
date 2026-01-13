// content/highDollarReject.js
window.AIExt = window.AIExt || {};

(function () {
  const FEATURE = "HighDollarReject";

  const RO_URL_RE = /https:\/\/online\.autointegrate\.com\/EditRepairOrder\?/i;
  const HIGH_DOLLAR_THRESHOLD = 20000;

  // React bundle root exists on this page; we scan within it.
  const ROOT_SELECTOR = "#Cnt_reactRepairOrderBundle";

  // NOTE: Your earlier selector pointed at a specific Typography span.
  // Instead of hard-coding the entire chain (brittle), we scan Typography body2 nodes
  // inside the React root and parse currency from them.
  const MONEY_NODE_SELECTOR = `${ROOT_SELECTOR} span.MuiTypography-root`;

  const INPUT_ERROR_MESSAGE =
    "It appears this dollar amount was entered in error, please review and adjust the dollar amount and resubmit. Thank you.";

  // Visual theme (match replacementGuard vibe)
  const THEME_COLOR = "#F59E0B"; // amber, same as replacementGuard example
  const OVERLAY_ID = "aiext-high-dollar-reject-overlay";

  let didLogInit = false;
  let didLogDetection = false;
  let didLogSummary = false;

  /* ============================
     Logging
  ============================ */

  function logInitOnce() {
    if (didLogInit) return;
    console.log(`[${FEATURE}]`, {
      initiated: true,
      url: location.href,
      isROPage: RO_URL_RE.test(location.href),
      rootPresent: !!document.querySelector(ROOT_SELECTOR),
      moneySelector: MONEY_NODE_SELECTOR,
      threshold: HIGH_DOLLAR_THRESHOLD,
    });
    didLogInit = true;
  }

  function logDetectionOnce(ctx) {
    if (didLogDetection) return;
    console.log(`[${FEATURE}]`, {
      highDollarDetected: !!ctx,
      detectedTotalCost: ctx?.totalCost ?? null,
      detectedRawText: ctx?.rawText ?? null,
      detectedNodeText: ctx?.nodeText ?? null,
      threshold: HIGH_DOLLAR_THRESHOLD,
    });
    didLogDetection = true;
  }

  function logSummaryOnce(agentSelection, ctx) {
    if (didLogSummary) return;
    console.log(`[${FEATURE}]`, {
      enabled: true,
      detectedTotalCost: ctx?.totalCost ?? null,
      detectedRawText: ctx?.rawText ?? null,
      agentSelection, // "Input Error" | "Valid"
    });
    didLogSummary = true;
  }

  /* ============================
     Helpers
  ============================ */

  function parseCurrency(text) {
    if (!text) return 0;
    // handles "$40,000.00", "CA$ 40,000.00", etc.
    const n = parseFloat(String(text).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  // Scan likely money nodes and return the *highest* value we see (or first over threshold).
  // This is intentionally robust against layout changes.
  function detectHighDollarLineItem() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) {
      console.warn(`[${FEATURE}]`, { reason: "React root not found", selector: ROOT_SELECTOR });
      return null;
    }

    const nodes = Array.from(root.querySelectorAll(MONEY_NODE_SELECTOR));
    if (!nodes.length) {
      console.warn(`[${FEATURE}]`, { reason: "No money nodes found", selector: MONEY_NODE_SELECTOR });
      return null;
    }

    let best = null;

    for (const node of nodes) {
      const nodeText = (node.innerText || node.textContent || "").trim();
      if (!nodeText) continue;

      // Quick filter: must contain $ to reduce false parses
      if (!/\$/.test(nodeText) && !/CA\$/i.test(nodeText)) continue;

      const value = parseCurrency(nodeText);
      if (value <= 0) continue;

      if (!best || value > best.totalCost) {
        best = {
          totalCost: value,
          rawText: nodeText,
          nodeText,
        };
      }
    }

    if (best && best.totalCost > HIGH_DOLLAR_THRESHOLD) return best;

    return null;
  }

  function getRejectReasonSelect() {
    // Keep simple; your rejection form uses a select.
    return document.querySelector("select");
  }

  function getNotesTextarea() {
    return document.querySelector("textarea");
  }

  function removeOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
  }

  /* ============================
     Overlay UI (match replacementGuard)
     Based on createOverlay styling pattern. :contentReference[oaicite:1]{index=1}
  ============================ */

  function createOverlay({ title, lines, onValid, onInputError }) {
    removeOverlay();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
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
      border: `8px solid ${THEME_COLOR}`,
      borderRadius: "14px",
      padding: "40px",
      textAlign: "center",
      maxWidth: "760px",
      width: "min(92vw, 760px)",
      boxShadow: `0 0 40px ${THEME_COLOR}`,
      fontFamily:
        "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    });

    const iconWrap = document.createElement("div");
    iconWrap.style.marginBottom = "18px";
    iconWrap.innerHTML = `
      <svg width="140" height="140" viewBox="0 0 120 110" aria-hidden="true">
        <polygon points="60,5 115,105 5,105" fill="${THEME_COLOR}" stroke="${THEME_COLOR}" stroke-width="2"></polygon>
        <rect x="55" y="32" width="10" height="40" fill="white" rx="2"></rect>
        <circle cx="60" cy="83" r="6" fill="white"></circle>
      </svg>
    `;

    const h1 = document.createElement("h1");
    h1.textContent = title;
    Object.assign(h1.style, {
      fontSize: "28px",
      margin: "0 0 10px",
      color: THEME_COLOR,
      letterSpacing: "0.5px",
    });

    const desc = document.createElement("div");
    desc.innerHTML = lines
      .map(
        (l) =>
          `<p style="margin:8px 0;font-size:18px;line-height:1.45;color:#111">${l}</p>`
      )
      .join("");

    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, {
      marginTop: "22px",
      display: "flex",
      justifyContent: "center",
      gap: "12px",
      flexWrap: "wrap",
    });

    const btnValid = document.createElement("button");
    btnValid.type = "button";
    btnValid.textContent = "Valid";
    Object.assign(btnValid.style, {
      backgroundColor: "white",
      color: "#111",
      fontSize: "18px",
      border: `2px solid ${THEME_COLOR}`,
      padding: "12px 28px",
      borderRadius: "8px",
      cursor: "pointer",
      boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
      minWidth: "140px",
    });

    const btnInput = document.createElement("button");
    btnInput.type = "button";
    btnInput.textContent = "Input Error";
    Object.assign(btnInput.style, {
      backgroundColor: THEME_COLOR,
      color: "white",
      fontSize: "18px",
      border: "none",
      padding: "12px 28px",
      borderRadius: "8px",
      cursor: "pointer",
      boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
      minWidth: "160px",
    });

    btnValid.addEventListener("click", () => {
      try { onValid && onValid(); } catch (_) {}
      try { overlay.remove(); } catch (_) {}
    });

    btnInput.addEventListener("click", () => {
      try { onInputError && onInputError(); } catch (_) {}
      try { overlay.remove(); } catch (_) {}
    });

    btnRow.appendChild(btnValid);
    btnRow.appendChild(btnInput);

    panel.appendChild(iconWrap);
    panel.appendChild(h1);
    panel.appendChild(desc);
    panel.appendChild(btnRow);
    overlay.appendChild(panel);

    // Click outside panel does nothing (intentional, like a blocking modal)
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        // no-op
      }
    });

    document.body.appendChild(overlay);
  }

  /* ============================
     Input Error Automation
  ============================ */

  function applyInputError() {
    const reason = getRejectReasonSelect();
    const notes = getNotesTextarea();

    if (reason) {
      const opt = Array.from(reason.options || []).find(
        (o) => (o.textContent || "").trim() === "Other"
      );
      if (opt) {
        reason.value = opt.value;
        reason.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        console.warn(`[${FEATURE}]`, { reason: "Could not find 'Other' option in select" });
      }
    } else {
      console.warn(`[${FEATURE}]`, { reason: "Reject reason <select> not found" });
    }

    if (notes) {
      notes.value = INPUT_ERROR_MESSAGE;
      notes.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      console.warn(`[${FEATURE}]`, { reason: "Notes <textarea> not found" });
    }

    console.log(`[${FEATURE}]`, { inputErrorApplied: true });
  }

  /* ============================
     Reject Click Intercept
  ============================ */

  function handleClickCapture(e) {
    const btn = e.target && e.target.closest ? e.target.closest("button") : null;
    if (!btn) return;

    const label = (btn.innerText || btn.textContent || "").trim();
    if (!label) return;

    // Only react to Reject clicks.
    if (!/^\s*reject\s*$/i.test(label) && !/\breject\b/i.test(label)) return;

    console.log(`[${FEATURE}]`, {
      event: "reject_click",
      buttonText: label,
      url: location.href,
      isROPage: RO_URL_RE.test(location.href),
    });

    if (!RO_URL_RE.test(location.href)) return;

    // Allow UI to render rejection UI (if it opens) before scanning.
    setTimeout(() => {
      const ctx = detectHighDollarLineItem();
      logDetectionOnce(ctx);

      if (!ctx) {
        console.warn(`[${FEATURE}]`, { event: "no_high_dollar_detected_on_reject" });
        return;
      }

      createOverlay({
        title: "HIGH DOLLAR REJECTION — CONFIRM",
        lines: [
          `You are rejecting a line item over <b>$20,000</b>.`,
          `Detected amount: <b>${ctx.rawText}</b>.`,
          `If this is due to an input error or another reason that would disqualify it from being a legitimate cost savings to the client, click <b>Input Error</b>.`,
          `If it is a valid cost savings, click <b>Valid</b>.`,
        ],
        onValid: () => {
          logSummaryOnce("Valid", ctx);
        },
        onInputError: () => {
          applyInputError();
          logSummaryOnce("Input Error", ctx);
        },
      });
    }, 350);
  }

  /* ============================
     Init
  ============================ */

  function init() {
    logInitOnce();

    document.addEventListener("click", handleClickCapture, true);

    console.log(`[${FEATURE}]`, {
      listenerAttached: true,
      capture: true,
    });

    // SPA re-hydration can cause DOM to load later; we log a short readiness probe.
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const rootPresent = !!document.querySelector(ROOT_SELECTOR);
      if (tries === 1 || tries === 6 || tries === 12) {
        console.log(`[${FEATURE}]`, { probe: true, tries, rootPresent });
      }
      if (rootPresent || tries >= 12) clearInterval(t);
    }, 250);
  }

  window.AIExt.highDollarReject = { init };
})();
