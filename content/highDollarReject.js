// content/highDollarRejectGuard.js
// High-dollar Reject interstitial for line items > $20,000
// Robust selection with delay + retry for native <select> and MUI menus

window.AIExt = window.AIExt || {};

(function () {
  const OVERLAY_ID = "high-dollar-reject-overlay";
  const THRESHOLD = 20000;

  let _bypassOnce = false;

  function parseMoney(text) {
    if (!text) return NaN;
    const cleaned = String(text).replace(/[^\d.-]/g, "");
    return Number(cleaned);
  }

  function findRejectButtonFromEventTarget(target) {
    const btn = target?.closest?.("button");
    if (!btn) return null;
    const t = (btn.textContent || "").trim();
    if (/^reject$/i.test(t) || /\breject\b/i.test(t)) return btn;
    const span = btn.querySelector("span");
    if (span && /^reject$/i.test((span.textContent || "").trim())) return btn;
    return null;
  }

  function findLineItemScope(rejectBtn) {
    return (
      rejectBtn.closest('.MuiPaper-root, .MuiCard-root, [aria-label="Details"], section, article') ||
      rejectBtn.closest("div") ||
      document
    );
  }

  function readLineItemTotal(scope) {
    const el =
      scope.querySelector('span[aria-describedby*="totalCost"]') ||
      scope.querySelector('span[aria-describedby$="__totalCost"]') ||
      Array.from(scope.querySelectorAll("span,div")).find(n => /\$\s*\d/.test(n.textContent || ""));
    return el ? parseMoney(el.textContent) : NaN;
  }

  function isCostSavingsChecked() {
    const cb = document.querySelector('input#isCostSaving[type="checkbox"]');
    return !!cb && !!cb.checked;
  }

  function setCostSavingsChecked(checked) {
    const cb = document.querySelector('input#isCostSaving[type="checkbox"]');
    if (!cb) return false;
    if (cb.checked === !!checked) return true;
    try {
      cb.click();
      cb.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      cb.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      return cb.checked === !!checked;
    } catch (err) {
      cb.checked = !!checked;
      cb.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      cb.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      return cb.checked === !!checked;
    }
  }

  function removeOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
  }

  function createOverlay({ title, html, onValid, onInputError }) {
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
      zIndex: 100000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      background: "white",
      border: "8px solid #DC2626",
      borderRadius: "14px",
      padding: "34px",
      textAlign: "left",
      maxWidth: "780px",
      width: "min(94vw, 780px)",
      boxShadow: "0 0 40px rgba(220,38,38,0.7)",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    });

    const h1 = document.createElement("h1");
    h1.textContent = title;
    Object.assign(h1.style, {
      fontSize: "22px",
      margin: "0 0 12px",
      color: "#DC2626",
      letterSpacing: "0.2px",
    });

    const body = document.createElement("div");
    body.innerHTML = html;

    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "12px",
      justifyContent: "flex-end",
      marginTop: "20px",
    });

    const mkBtn = (label, bg, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      Object.assign(b.style, {
        backgroundColor: bg,
        color: "white",
        fontSize: "16px",
        border: "none",
        padding: "10px 18px",
        borderRadius: "8px",
        cursor: "pointer",
        boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
      });
      b.addEventListener("click", () => {
        try { onClick && onClick(); } finally { removeOverlay(); }
      });
      return b;
    };

    const validBtn = mkBtn("Valid", "#16A34A", onValid);
    const inputErrBtn = mkBtn("Input Error", "#DC2626", onInputError);

    actions.appendChild(inputErrBtn);
    actions.appendChild(validBtn);

    panel.appendChild(h1);
    panel.appendChild(body);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    inputErrBtn.focus();
  }

  function waitFor(predicate, { timeoutMs = 6000, intervalMs = 100 } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      const t = setInterval(() => {
        let ok = false;
        try { ok = !!predicate(); } catch (_) {}
        if (ok) { clearInterval(t); resolve(true); return; }
        if (Date.now() - start > timeoutMs) { clearInterval(t); resolve(false); }
      }, intervalMs);
    });
  }

  // small sleep helper
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Try to set native <select> by text; with robust fallbacks (value and index).
  // This function will wait for options to be populated (up to optionsTimeoutMs).
  async function setNativeSelectByText(selectEl, matcher, { optionsTimeoutMs = 2000 } = {}) {
    if (!selectEl) return false;

    // wait for options to populate
    const ok = await waitFor(() => (selectEl.options && selectEl.options.length > 0), { timeoutMs: optionsTimeoutMs, intervalMs: 100 });
    if (!ok) {
      console.debug("[HighDollarRejectGuard] native select has no options after wait", selectEl);
      // continue anyway - maybe options exist but length is 0 in this DOM; we'll still try
    }

    const opts = Array.from(selectEl.options || []);

    // 1) substring match (case-insensitive) using matcher function
    let target = opts.find(o => matcher((o.textContent || "").trim()));
    // 2) try exact trimmed text match (if matcher provided as string, handled by caller)
    if (!target) {
      target = opts.find(o => /(^|\s)other(\b|:)/i.test((o.textContent || "").trim()));
    }
    // 3) try known value fallback "6"
    if (!target) {
      target = opts.find(o => String((o.value || "")).trim() === "6");
    }
    // 4) try nth-child index 13 -> index 12
    if (!target && opts.length >= 13) {
      target = opts[12];
    }

    if (!target) {
      console.debug("[HighDollarRejectGuard] setNativeSelectByText: no matching option found", selectEl, opts.map(o => ({ v: o.value, t: o.textContent })));
      return false;
    }

    if (selectEl.value !== target.value) {
      selectEl.value = target.value;
      selectEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      selectEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }
    console.debug("[HighDollarRejectGuard] setNativeSelectByText: selected option", target.value, (target.textContent||"").trim());
    return true;
  }

  // Open MUI combobox and click target option; waits & retries for menu to render.
  async function chooseMUISelectOption(dialog, matcher, { maxRetries = 6, retryDelayMs = 250 } = {}) {
    // look for a combobox trigger in dialog first, then globally
    const trigger =
      (dialog && (dialog.querySelector('[role="combobox"]') || dialog.querySelector('[aria-haspopup="listbox"]'))) ||
      document.querySelector('[role="combobox"], [aria-haspopup="listbox"], .MuiSelect-root, button[aria-haspopup="listbox"]');

    if (!trigger) {
      console.debug("[HighDollarRejectGuard] chooseMUISelectOption: no trigger found");
      return false;
    }

    // attempt open
    try { trigger.click(); } catch (e) { /* ignore */ }

    // retry loop: wait for menu to appear and for option to be clickable
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // find menu (menu may be appended to body via portal)
      const menu = document.querySelector('[role="listbox"], .MuiList-root, .MuiMenu-list');
      if (menu) {
        // gather candidate nodes
        const candidateNodes = Array.from(menu.querySelectorAll('li, div[role="option"], button, span, .MuiMenuItem-root'))
          .filter(n => (n.textContent || "").trim().length > 0);

        const target = candidateNodes.find(n => matcher((n.textContent || "").trim()));
        if (target) {
          try {
            target.scrollIntoView({ block: 'center' });
            target.click();
            console.debug("[HighDollarRejectGuard] chooseMUISelectOption: clicked target", (target.textContent||"").trim());
            // ensure input/change events
            try {
              trigger.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
              trigger.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
            } catch (e) {}
            return true;
          } catch (err) {
            try {
              target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              return true;
            } catch (ee) {}
          }
        }
      }
      // not found yet; wait and retry
      await sleep(retryDelayMs);
    }

    console.debug("[HighDollarRejectGuard] chooseMUISelectOption: failed after retries");
    return false;
  }

  // Generic helper that attempts native select first, then MUI-style select, with retries/delays.
  async function setSelectToOptionText(selectElOrContainer, matcher, { overallRetries = 3, retryDelayMs = 200 } = {}) {
    // normalize matcher to function
    let matcherFn = matcher;
    if (typeof matcher === "string") matcherFn = txt => (txt || "").toLowerCase().includes(matcher.toLowerCase());
    if (typeof matcherFn !== "function") matcherFn = txt => /\bother\b/i.test(txt);

    for (let attempt = 0; attempt < overallRetries; attempt++) {
      // 1) if a select element was passed
      if (selectElOrContainer && selectElOrContainer.tagName === "SELECT") {
        const ok = await setNativeSelectByText(selectElOrContainer, matcherFn, { optionsTimeoutMs: 1500 });
        if (ok) return true;
      }

      const container = (selectElOrContainer && selectElOrContainer.nodeType) ? selectElOrContainer : document;

      // 2) try to find native select by id or other selectors
      const native = container.querySelector('select#roItemRejectionReasonId, select[id*="RejectionReason"], select');
      if (native) {
        const ok = await setNativeSelectByText(native, matcherFn, { optionsTimeoutMs: 1500 });
        if (ok) return true;
      }

      // 3) try MUI-style select
      const okMui = await chooseMUISelectOption(container, matcherFn, { maxRetries: 8, retryDelayMs: 300 });
      if (okMui) return true;

      // 4) try direct option-like clicks inside container
      const directOpts = Array.from(container.querySelectorAll('li, div[role="option"], button, .MuiMenuItem-root'))
        .filter(n => (n.textContent || "").trim().length > 0);
      const directTarget = directOpts.find(n => matcherFn((n.textContent || "").trim()));
      if (directTarget) {
        try { directTarget.click(); } catch (e) {
          try { directTarget.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (ee) {}
        }
        console.debug("[HighDollarRejectGuard] setSelectToOptionText: direct option clicked", (directTarget.textContent||"").trim());
        return true;
      }

      // nothing yet -> wait a bit and retry
      await sleep(retryDelayMs);
    }

    console.debug("[HighDollarRejectGuard] setSelectToOptionText: all retries exhausted");
    return false;
  }

  function fillTextField(el, value) {
    if (!el) return false;
    try {
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        el.focus && el.focus();
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        el.blur && el.blur();
        return true;
      } else {
        el.textContent = value;
        el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        return true;
      }
    } catch (err) {
      return false;
    }
  }

  function findRejectDialog() {
    return document.querySelector('div[role="dialog"]') || null;
  }

  function findDialogRejectSubmitButton(dialog) {
    if (!dialog) return null;
    const btns = Array.from(dialog.querySelectorAll("button"));
    return btns.find(b => /^reject$/i.test((b.textContent || "").trim())) || null;
  }

  async function applyInputErrorAutomation() {
    // Wait for rejection modal to appear with controls
    const ok = await waitFor(() => {
      const d = findRejectDialog();
      return !!(d && d.querySelector("select, textarea, input, [role='combobox'], [aria-haspopup='listbox']"));
    }, { timeoutMs: 6000 });

    if (!ok) {
      console.debug("[HighDollarRejectGuard] applyInputErrorAutomation: dialog didn't appear in time");
      return;
    }

    const dialog = findRejectDialog();
    if (!dialog) return;

    // 1) Set Reason to Other - with retries and delays. This will:
    //    - try native select (roItemRejectionReasonId) and wait for options
    //    - try MUI combobox menu selection
    //    - try value="6" / nth-child fallback internally
    const selected = await setSelectToOptionText(dialog, txt => /\bother\b/i.test(txt), { overallRetries: 4, retryDelayMs: 250 });
    console.debug("[HighDollarRejectGuard] applyInputErrorAutomation: reason selected?", selected);

    // 2) Prefill message (textarea or input)
    const msg =
      dialog.querySelector("textarea#roItemRejectionNotes") ||
      dialog.querySelector("textarea") ||
      dialog.querySelector('input[type="text"], input[type="search"], input[role="textbox"]');

    fillTextField(
      msg,
      "It appears this dollar amount was entered in error, please review and adjust the dollar amount and resubmit. Thank you."
    );

    // 3) Uncheck cost savings
    setCostSavingsChecked(false);

    // Note: Auto-submit left commented. Uncomment if desired.
    // const submitBtn = findDialogRejectSubmitButton(dialog);
    // if (submitBtn) submitBtn.click();
  }

  function onDocumentClickCapture(e) {
    if (_bypassOnce) return;
    const rejectBtn = findRejectButtonFromEventTarget(e.target);
    if (!rejectBtn) return;
    const scope = findLineItemScope(rejectBtn);
    const total = readLineItemTotal(scope);
    if (!Number.isFinite(total) || total <= THRESHOLD) return;

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    createOverlay({
      title: "High Dollar Reject Confirmation",
      html: `
        <div style="font-size:16px;line-height:1.45;color:#111">
          <p style="margin:0 0 10px">
            You are rejecting a line item over <b>$20,000</b>.
          </p>
          <p style="margin:0 0 10px">
            If this is due to an input error or another reason that would disqualify it from being a legitimate cost savings to the client, click <b>Input Error</b>.
            If it is a valid cost savings, click <b>Valid</b>.
          </p>
          <p style="margin:0;color:#444">
            Detected total: <b>$${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
            ${isCostSavingsChecked() ? " • Cost Savings is currently <b>checked</b>." : ""}
          </p>
        </div>
      `,
      onValid: () => {
        _bypassOnce = true;
        try { rejectBtn.click(); } finally { _bypassOnce = false; }
      },
      onInputError: async () => {
        _bypassOnce = true;
        try { rejectBtn.click(); } finally { _bypassOnce = false; }
        await applyInputErrorAutomation();
      },
    });
  }

  function start() {
    document.addEventListener("click", onDocumentClickCapture, true);
    console.log("[HighDollarRejectGuard] Started.");
  }

  function stop() {
    document.removeEventListener("click", onDocumentClickCapture, true);
    removeOverlay();
    console.log("[HighDollarRejectGuard] Stopped.");
  }

  AIExt.highDollarReject = { start, stop };
})();
