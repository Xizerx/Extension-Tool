// content/fedexGuard.js
// Submit interstitial when certain service codes are "Approved - Requires RO Approval" for a target client.
// Exposes: AIExt.fedexGuard.init(options) -> { stop }

window.AIExt = window.AIExt || {};

(function () {
  const OVERLAY_ID = "fedex-submit-overlay";

  const DEFAULTS = {
    DEBUG: true,

    // Init timing / readiness
    INIT_DELAY_MS: 750,            // wait this long before first attach attempt
    READY_RETRY_EVERY_MS: 350,      // poll interval while waiting for client code
    READY_TIMEOUT_MS: 15000,        // give up waiting after this long (still attaches click handler)

    TARGET_CLIENT_NUMBER: "FA9500",
    REQUIRED_AUTH_STATUS: "Approved - Requires RO Approval",

    // Optional legacy selector (leave blank if unstable)
    CLIENT_NUMBER_SELECTOR: "",
    
    SERVICE_CODES: [
      "Coolant Line/Hose",
      "Coolant Bypass Valve",
      "Global Positioning System Module",
      "Coolant Flush",
      "Cvi / Commercial Vehicle Inspection",
      "Diesel Fuel Filter",
      "Cooling System Service",
      "Differential Service - Front",
      "Differential Service - Rear",
      "Cvi / Commercial Vehicle Inspection",
      "Manual Transmission Service",
      "Secondary Diesel Fuel Filter",
      "Transfer Case Drain And Fill",
      "Transfer Case Service",
      "Transmission Drain And Fill",
      "Transfer Case Drain And Fill",
      "Transfer Case Service",
      "Transmission Filter And Gaskets",
      "Transmission Fluid & Filter Change",
      "Transmission Fluid & Filter Change - Cvt",
      "Transmission Flush",
      "Gasoline Fuel Filter",
      "Pm - A",
      "Pm - B",
      "Pm - B",
      "Pm - C",
      "Diesel Full Synthetic Engine Oil",
      "Pm - D",
      "Visual Safety Inspection",
      "Cabin Air Filter",
      "Brake Fluid Flush",
      "Differential Service - Rear",
      "Transmission Fluid & Filter Change",
      "Air Filter Element",
      "Diesel Particle Filter (Dpf)",
      "Diesel Fuel Filter",
      "Cvi / Commercial Vehicle Inspection",
      "Fan Belt",
      "Diesel Dpf Cleaning",
      "Spark Plug",
      "Diesel Emissions Fluid Filter",
      "Repack Axle Bearing",
      "Drive Belt",
      "Full Synthetic Engine Oil",
      "Semi-Synthetic Lube Oil Filter",
      "120 Day Inspection",
      "1 Year V&K Inspection",
      "Preventative Maintenance",
      "Front Wheel Oil Seal",
      "Wheel Hub Bearing Service",
      "Conventional Lube, Oil, And Filter",
      "Dot Inspection",
      "Oil Filter, Engine",
      "Conventional Engine Oil",
      "1 Year Ansi Inspection",
      "Brake Fluid",
      "Diesel Semi Synthetic Lube Oil Filter",
      "Diesel Semi Synthetic Engine Oil",
      "Cvi / Commercial Vehicle Inspection",
      "Secondary Diesel Fuel Filter",
      "Diesel Full Synthetic Lube Oil Filter",
      "Alternator Belt",
      "Full Synthetic Lube Oil Filter",
      "Air Conditioning Belt",
      "Transmission Drain And Fill",
      "Repack Wheel Bearing",
      "Transmission Flush",
      "Repack Wheel Bearing",
      "Diesel Conventional Engine Oil",
      "Diesel Conventional Lube Oil Filter"
    ],
  };

  let _opts = { ...DEFAULTS };
  let _attached = false;
  let _bypassOnce = false;
  let _boundHandler = null;

  // readiness polling
  let _readyTimer = null;
  let _readyStartTs = 0;

  // --------------------------
  // Structured Logger
  // --------------------------
  function logStatus(payload) {
    if (!_opts.DEBUG) return;
    console.log("[FedexGuard]", {
      ...payload,
      URL: window.location.pathname + window.location.hash,
    });
  }

  // --------------------------
  // Utils
  // --------------------------
  function norm(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[–—]/g, "-");
  }

  function normCode(s) {
    // normalize "fa-9500" / "FA 9500" -> "FA9500"
    return String(s || "")
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[-:]/g, "");
  }

  function isServiceCodeMatch(text) {
    const t = norm(text);
    return (_opts.SERVICE_CODES || []).some((c) => norm(c) === t);
  }

  // --------------------------
  // Client Code Detection (prefer Linker)
  // --------------------------
  function getClientCodeViaLinker() {
    const linker = window.AIExt?.clientInfoLinker;
    if (!linker || typeof linker.getClientCode !== "function") return "";
    const code = linker.getClientCode();
    return code ? normCode(code) : "";
  }

  function getClientCode() {
    return (
      getClientCodeViaLinker() ||
      ""
    );
  }
  // --------------------------
  // Line Item Scanning (same method as hoverTracker.js)
  // --------------------------

  // Optional dependency: utils.js (AIExt.utils) if present
  const _utils = window.AIExt?.utils || null;

  function qAll(sel) {
    return _utils?.qAll ? _utils.qAll(sel) : Array.from(document.querySelectorAll(sel));
  }

  // hoverTracker reads "fields" by aria-label; mirror that
  function textClean(el) {
    if (!el) return "";
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

function getField(container, label) {
  if (!container) return "";

  // 1) Best case: aria-label exists (your current behavior)
  const node =
    container.querySelector(
      `h1[aria-label="${label}"],h2[aria-label="${label}"],h3[aria-label="${label}"],h4[aria-label="${label}"],h5[aria-label="${label}"],h6[aria-label="${label}"]`
    ) || container.querySelector(`[aria-label="${label}"]`);

  const direct = textClean(node);
  if (direct) return direct;

  // 2) Fallback: find visible label text, then nearby staticData value
  const wanted = norm(label);

  // Candidate elements that might hold the label text
  const labelCandidates = Array.from(
    container.querySelectorAll("span,div,p,dt,dd,label,strong,b,h1,h2,h3,h4,h5,h6")
  );

  // Find an element whose visible text matches the label exactly
  const labelEl = labelCandidates.find((el) => norm(textClean(el)) === wanted);
  if (!labelEl) return "";

  // The value is usually close by in the DOM; prioritize staticData spans
  const valueCandidates = [];

  // a) same parent, next siblings
  if (labelEl.parentElement) {
    let sib = labelEl.nextElementSibling;
    for (let i = 0; i < 6 && sib; i++, sib = sib.nextElementSibling) {
      valueCandidates.push(sib);
    }

    // b) within the same parent, any staticData
    valueCandidates.push(
      ...Array.from(labelEl.parentElement.querySelectorAll("span.MuiTypography-staticData"))
    );
  }

  // c) within the nearest grid-ish container
  const grid = labelEl.closest?.(".MuiGrid-root,[class*='MuiGrid']");
  if (grid) {
    valueCandidates.push(...Array.from(grid.querySelectorAll("span.MuiTypography-staticData")));
  }

  // d) finally, search close-by following nodes in document order
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
  let started = false;
  let count = 0;
  while (walker.nextNode() && count < 120) {
    const el = walker.currentNode;
    if (el === labelEl) started = true;
    if (!started) continue;
    count++;

    if (el.matches?.("span.MuiTypography-staticData")) valueCandidates.push(el);
  }

  // Deduplicate candidates
  const uniq = Array.from(new Set(valueCandidates)).filter(Boolean);

  // Pick the first "good" value:
  // - has text
  // - is not the same as the label
  // - (optional) for auth status, strongly prefer ones containing "approved"/"requires"/etc.
  const labelText = wanted;

  const isAuthLabel = /authorization status|approval status/i.test(label);
  const authHint = /(approved|requires|rejected|pending|declined|authorized|removed)/i;

  for (const c of uniq) {
    const v = textClean(c);
    if (!v) continue;
    if (norm(v) === labelText) continue;

    if (isAuthLabel) {
      // Prefer values that look like a status, and avoid unrelated junk where possible
      if (!authHint.test(v)) continue;
    }
    return v;
  }

  // If auth-hint filtering removed everything, fall back to any non-empty value
  for (const c of uniq) {
    const v = textClean(c);
    if (v && norm(v) !== labelText) return v;
  }

  return "";
}


  function containerForNode(node) {
    if (!node) return document.body;

    // Prefer the same root concept hoverTracker uses (if available)
    if (_utils?.lineItemRoot) {
      const root = _utils.lineItemRoot(node);
      if (root) return root;
    }

    // Fallback heuristics: climb to likely "line item" container
    return (
      node.closest?.(
        '[role="row"],[role="group"],[role="region"],section,article,.MuiCard-root,.MuiPaper-root,.card,.panel,.row,.item,.list-item'
      ) ||
      node.parentElement ||
      document.body
    );
  }

  function findLineItemScopes() {
    // Anchor scan on Service Code fields (more deterministic than textContent searching)
    const serviceCodeNodes = qAll(
      `[aria-label="Service Code"],h1[aria-label="Service Code"],h2[aria-label="Service Code"],h3[aria-label="Service Code"],h4[aria-label="Service Code"],h5[aria-label="Service Code"],h6[aria-label="Service Code"]`
    );

    // Map to unique containers
    const set = new Set();
    for (const n of serviceCodeNodes) {
      set.add(containerForNode(n));
    }

    // Keep it sane if the page is huge
    return Array.from(set).slice(0, 200);
  }

  function collectMatches() {
  const scopes = findLineItemScopes();
  const matches = [];
  const detectedLineItems = [];

  for (const scope of scopes) {
    const serviceCodeRaw = getField(scope, "Service Code");
    const authStatusRaw = getField(scope, "Authorization Status");

    // Normalize display values (keep visibility into missing fields)
    const serviceCode = (serviceCodeRaw || "").trim();
    const authStatus = (authStatusRaw || "").trim();

    const matchesRule =
      !!serviceCode &&
      !!authStatus &&
      norm(authStatus) === norm(_opts.REQUIRED_AUTH_STATUS) &&
      isServiceCodeMatch(serviceCode);

    // ✅ Always record what we detected (even if missing fields)
    detectedLineItems.push({
      serviceCode: serviceCode || "(missing)",
      authStatus: authStatus || "(missing)",
      matchesRule,
    });

    // Keep your existing match behavior
    if (matchesRule) {
      matches.push({ serviceCode, authStatus });
    }
  }

  // ✅ Console output: ALL detected line items + boolean match flag
  if (_opts.DEBUG) {
    console.groupCollapsed("[FedexGuard] Line items detected (all)");
    console.table(detectedLineItems);
    console.groupEnd();
  }

  // Dedupe matches (unchanged)
  const seen = new Set();
  return matches.filter((m) => {
    const key = `${norm(m.serviceCode)}|${norm(m.authStatus)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

  // --------------------------
  // Overlay
  // --------------------------
  function removeOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
  }

  function createOverlay(matches, submitBtn) {
    removeOverlay();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Client Approval Required");

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.85)",
      zIndex: 100000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      background: "white",
      border: "8px solid #2563EB",
      borderRadius: "14px",
      padding: "28px",
      textAlign: "left",
      maxWidth: "820px",
      width: "min(94vw, 820px)",
      boxShadow: "0 0 40px rgba(37,99,235,0.45)",
      fontFamily:
        "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    });

    const listHtml = matches
      .map(
        (m) =>
          `<li style="margin:6px 0"><b>${m.serviceCode}</b><div style="color:#374151;font-size:13px;margin-top:2px">${m.authStatus}</div></li>`
      )
      .join("");

    panel.innerHTML = `
      <h2 style="margin:0 0 10px;color:#1D4ED8;font-size:20px">Client Approval Required</h2>
      <p style="margin:0 0 12px;font-size:16px;line-height:1.45">
        This RO has been identified as having a line item that requires approval by the client.
        <b>Submit the RO to the client in the next step</b> to ensure client policy compliance.
      </p>

      <div style="margin:12px 0 0;padding:12px;border:1px solid #E5E7EB;border-radius:10px;background:#F9FAFB">
        <div style="font-weight:700;margin-bottom:8px">Matched line items (${matches.length}):</div>
        <ul style="margin:0;padding-left:18px">${listHtml}</ul>
      </div>

      <div style="margin-top:18px;display:flex;gap:12px;justify-content:flex-end">
        <button id="fedex-cancel" type="button"
          style="background:#DC2626;color:#fff;font-size:16px;border:none;padding:10px 18px;border-radius:8px;cursor:pointer">
          Cancel
        </button>
        <button id="fedex-continue" type="button"
          style="background:#16A34A;color:#fff;font-size:16px;border:none;padding:10px 18px;border-radius:8px;cursor:pointer">
          Continue
        </button>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const cancelBtn = document.getElementById("fedex-cancel");
    const contBtn = document.getElementById("fedex-continue");

    cancelBtn?.addEventListener("click", () => {
      logStatus({ status: "cancel-clicked" });
      removeOverlay();
    });

    contBtn?.addEventListener("click", () => {
      logStatus({ status: "continue-clicked" });
      _bypassOnce = true;
      try {
        removeOverlay();
        submitBtn.click();
      } finally {
        _bypassOnce = false;
      }
    });

    cancelBtn?.focus();
  }

  // --------------------------
  // Click Handler
  // --------------------------
  function onClickCapture(e) {
    if (_bypassOnce) return;

    const btn = e.target?.closest?.("button");
    if (!btn) return;

    const btnText = (btn.textContent || "").trim();
    if (!/^submit$/i.test(btnText)) return;

    logStatus({ status: "submit-click-detected" });

    const client = getClientCode();
    if (!client) {
      logStatus({ status: "not-ready-client-missing" });
      return;
    }

    const expected = normCode(_opts.TARGET_CLIENT_NUMBER);
    if (normCode(client) !== expected) {
      logStatus({
        status: "client-mismatch",
        clientDetected: client,
        expected: _opts.TARGET_CLIENT_NUMBER,
      });
      return;
    }

    const matches = collectMatches();
    if (!matches.length) {
      logStatus({ status: "no-matching-line-items", client });
      return;
    }

    logStatus({
      status: "intercepting-submit",
      client,
      matchedCount: matches.length,
      matchedServices: matches.map((m) => m.serviceCode),
    });

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    createOverlay(matches, btn);
  }

  // --------------------------
  // Readiness / delayed attach
  // --------------------------
  function attachClickHandler() {
    if (_attached) return;

    _boundHandler = onClickCapture.bind(null);
    document.addEventListener("click", _boundHandler, true);
    _attached = true;

    logStatus({ status: "handler-attached" });
  }

  function clearReadyTimer() {
    if (_readyTimer) {
      clearInterval(_readyTimer);
      _readyTimer = null;
    }
  }

  function startReadyPolling() {
    _readyStartTs = Date.now();
    clearReadyTimer();

    _readyTimer = setInterval(() => {
      const elapsed = Date.now() - _readyStartTs;
      const client = getClientCode();

      if (client) {
        logStatus({ status: "ready-client-detected", client });
        clearReadyTimer();
        attachClickHandler();
        return;
      }

      if (elapsed >= _opts.READY_TIMEOUT_MS) {
        logStatus({ status: "ready-timeout-attaching-anyway", elapsedMs: elapsed });
        clearReadyTimer();
        attachClickHandler();
      } else {
        logStatus({ status: "waiting-for-client", elapsedMs: elapsed });
      }
    }, _opts.READY_RETRY_EVERY_MS);
  }

  // --------------------------
  // Init / Stop
  // --------------------------
  function init(options = {}) {
    if (_attached || _readyTimer) {
      console.warn("[FedexGuard] already initialized");
      return { stop };
    }

    _opts = { ...DEFAULTS, ...options };

    logStatus({ status: "init-called", initDelayMs: _opts.INIT_DELAY_MS });

    setTimeout(() => {
      logStatus({ status: "init-delay-elapsed" });
      startReadyPolling();
    }, Math.max(0, _opts.INIT_DELAY_MS));

    function stop() {
      clearReadyTimer();
      if (_attached && _boundHandler) {
        document.removeEventListener("click", _boundHandler, true);
      }
      removeOverlay();
      _attached = false;
      _boundHandler = null;

      console.log("[FedexGuard] stopped");
    }

    return { stop };
  }

  AIExt.fedexGuard = { init };
})();
