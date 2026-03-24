// notesTracker.js — optimized: only logs on state change
window.AIExt = window.AIExt || {};

(function () {
  const MUST_CLICK_CLASS = 'MuiSvgIcon-colorError';
  const OPTIONAL_CLASS   = 'MuiSvgIcon-colorInfo';
  const CLICK_ATTR       = 'data-notes-clicked';

  const POLL_MS = 100;
  const OPEN_GRACE_MS = 1500;

  let notesSvgRef = null;

  // Core state
  let clicked = false;
  let type = 'unknown';
  let totalNoteHoverMs = 0;

  // Timing
  let readingOngoing = false;
  let readingStartTs = 0;
  let armedForNextOpen = false;
  let armGraceDeadline = 0;

  // Internals
  let observer = null;
  let pollTimer = null;
  let isNotesOpenOverride = null;
  let lastHref = location.href;
  let lastOnChange = null;
  let lastStats = null; // used for change detection

  // ---------- DOM helpers
  function resolvePrimaryNotesSvg() {
    if (notesSvgRef?.isConnected) return notesSvgRef;
    const inBar = document.querySelector('nav[aria-label="Repair Order"] svg[data-testid="NotesIcon"]');
    if (inBar) return (notesSvgRef = inBar);
    const any = document.querySelector('svg[data-testid="NotesIcon"]');
    if (any) return (notesSvgRef = any);
    return null;
  }

  function noteTypeFor(el) {
    if (!el) return 'unknown';
    try {
      const cl = el.classList || [];
      if (cl.contains(MUST_CLICK_CLASS)) return 'must';
      if (cl.contains(OPTIONAL_CLASS))   return 'optional';
    } catch {}
    try {
      const color = getComputedStyle(el).color || '';
      if (/rgb\(\s*(1[5-9]\d|2[0-5]\d)\s*,\s*[0-8]?\d\s*,\s*[0-8]?\d\s*\)/i.test(color)) return 'must';
      if (/rgb\(\s*\d+\s*,\s*\d+\s*,\s*(1[5-9]\d|2\d{2})\s*\)/i.test(color))            return 'optional';
    } catch {}
    return 'unknown';
  }

  // ---------- Popup detection (specific to Repair Order Notes)
  function isElementVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.05) return false;
    if (el.offsetParent === null && style.position !== 'fixed') return false;
    return true;
  }

  function findDialogTitleText(dialogEl) {
    const h2 = dialogEl.querySelector('h2, [role="heading"]');
    if (h2 && h2.textContent) return h2.textContent.trim();
    const id = dialogEl.getAttribute('aria-labelledby');
    if (id) {
      const lab = document.getElementById(id);
      if (lab && lab.textContent) return lab.textContent.trim();
    }
    return '';
  }

  function defaultIsRepairOrderNotesOpen() {
    const dialogs = document.querySelectorAll('[role="dialog"].MuiDialog-root, .MuiDialog-root[role="dialog"], [role="dialog"].MuiModal-root, .MuiModal-root[role="dialog"]');
    for (const dlg of dialogs) {
      if (!isElementVisible(dlg)) continue;
      const titleText = findDialogTitleText(dlg);
      if (/repair\s*order\s*notes/i.test(titleText)) return true;
    }
    const labelled = document.querySelector('[role="dialog"][aria-label*="Repair Order Notes" i]');
    return labelled && isElementVisible(labelled);
  }

  function isNotesOpenNow() {
    try { if (typeof isNotesOpenOverride === 'function') return !!isNotesOpenOverride(); } catch {}
    return defaultIsRepairOrderNotesOpen();
  }

  // ---------- Polling
  function startPoll() {
    if (pollTimer != null) return;
    pollTimer = setInterval(() => {
      tickTimers();
      maybeEmitChange();
    }, POLL_MS);
    tickTimers();
  }
  function stopPoll() {
    if (pollTimer != null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ---------- Timing logic (click-gated)
  function tickTimers() {
    const now = performance.now();
    const open = isNotesOpenNow();

    if (armedForNextOpen && !readingOngoing) {
      if (open) {
        readingOngoing = true;
        readingStartTs = now;
      } else if (now > armGraceDeadline) {
        armedForNextOpen = false;
        stopPoll();
      }
    } else if (readingOngoing) {
      if (!open) {
        const dur = Math.max(0, Math.round(now - readingStartTs));
        totalNoteHoverMs += dur;
        readingOngoing = false;
        readingStartTs = 0;
        armedForNextOpen = false;
        stopPoll();
      }
    }
  }

  function computeNow() {
    tickTimers();
    const svg = resolvePrimaryNotesSvg();
    type = noteTypeFor(svg);
    return { clicked, type, totalNoteHoverMs };
  }

  // ---------- Change detection / logging
  function statsChanged(a, b) {
    if (!a || !b) return true;
    return a.clicked !== b.clicked ||
           a.type !== b.type ||
           a.totalNoteHoverMs !== b.totalNoteHoverMs;
  }

  function maybeEmitChange() {
    const s = computeNow();
    if (statsChanged(s, lastStats)) {
      lastStats = { ...s };
      console.log('[NotesTracker]', s);
      lastOnChange?.(s);
    }
  }

  // ---------- Reset helpers
  function finalizeAnyOngoingSession() {
    if (readingOngoing) {
      const dur = Math.max(0, Math.round(performance.now() - readingStartTs));
      totalNoteHoverMs += dur;
      readingOngoing = false;
      readingStartTs = 0;
    }
    // Make sure lastStats reflects finalized timing before anyone snapshots
    maybeEmitChange();
  }

  function resetAll() {
    finalizeAnyOngoingSession();
    clicked = false;
    type = 'unknown';
    totalNoteHoverMs = 0;
    readingOngoing = false;
    readingStartTs = 0;
    armedForNextOpen = false;
    armGraceDeadline = 0;
    stopPoll();
    const svg = resolvePrimaryNotesSvg();
    if (svg) svg.removeAttribute(CLICK_ATTR);
    lastStats = null;
    maybeEmitChange(); // emit reset once
  }

  // ---------- SPA / URL change detection
  function hookHistoryForNav() {
    ['pushState','replaceState'].forEach(fn => {
      const orig = history[fn];
      if (typeof orig !== 'function' || orig.__aiPatched) return;
      const wrapped = function(...args) {
        const ret = orig.apply(this, args);
        queueMicrotask(checkHrefAndResetIfChanged);
        return ret;
      };
      wrapped.__aiPatched = true;
      history[fn] = wrapped;
    });
    window.addEventListener('popstate', checkHrefAndResetIfChanged, { passive: true });
    setInterval(checkHrefAndResetIfChanged, 1000);
  }
  function checkHrefAndResetIfChanged() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      resetAll();
    }
  }

  // ---------- Events
  function installClickListener(onChange) {
    document.addEventListener('click', (e) => {
      const svg = resolvePrimaryNotesSvg();
      if (!svg) return;
      const within = svg.contains(e.target) || e.target === svg || svg.closest('button')?.contains(e.target);
      if (!within) return;

      type = noteTypeFor(svg);
      clicked = true;
      armedForNextOpen = true;
      armGraceDeadline = performance.now() + OPEN_GRACE_MS;
      svg.setAttribute(CLICK_ATTR, '1');
      startPoll();

      maybeEmitChange();
    }, { capture: true, passive: true });
  }

  function startObserver(onChange) {
    if (observer) return;
    let debounced = null;
    const kick = () => {
      clearTimeout(debounced);
      debounced = setTimeout(() => maybeEmitChange(), 50);
    };
    observer = new MutationObserver(kick);
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden', 'role', 'data-notes']
    });
  }

  // ---------- Public API
  AIExt.notesTracker = {
    init({ onChange, isNotesOpen: isOpenFn } = {}) {
      if (typeof isOpenFn === 'function') isNotesOpenOverride = isOpenFn;
      lastOnChange = typeof onChange === 'function' ? onChange : null;

      // Do NOT reset state on unload; only finalize timers and emit last snapshot.
      window.addEventListener('pagehide', finalizeAnyOngoingSession, { passive: true });
      window.addEventListener('beforeunload', finalizeAnyOngoingSession, { passive: true });

      lastHref = location.href;
      hookHistoryForNav();

      installClickListener(lastOnChange);
      maybeEmitChange();
      startObserver(lastOnChange);
    },

    getSnapshot() {
      return computeNow();
    },

    refresh(onChange) {
      if (typeof onChange === 'function') lastOnChange = onChange;
      maybeEmitChange();
      return { ...lastStats };
    },

    reset: resetAll
  };
})();





const SUPABASE_URL = "https://efjkriqnyyxiowkedygy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmamtyaXFueXl4aW93a2VkeWd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0OTg2MjQsImV4cCI6MjA3NjA3NDYyNH0.injWR1IxECf4_cgVggdLe3MAvhWSeF3y00PG8UrP5OY";
const SUPABASE_TABLE = "ai_ro_events";

// ---- Global namespace ----
window.AIExt = window.AIExt || {};

// -------- SINGLETON GUARD --------
if (window.AIExt.__sessionRecorderLoaded) {
  console.warn("[SessionRecorder] Duplicate load detected, skipping init.");
} else {
  window.AIExt.__sessionRecorderLoaded = true;

(function () {
  // ---- Tiny logger ----
  const log = {
    info:    (...a) => console.log("%c[SessionRecorder]", "color:#0af;", ...a),
    warn:    (...a) => console.log("%c[SessionRecorder]", "color:#fa0;", ...a),
    error:   (...a) => console.log("%c[SessionRecorder]", "color:#f44;", ...a),
    success: (...a) => console.log("%c[SessionRecorder]", "color:#0b0;", ...a),
  };

  // ---- URL helpers ----
  const RO_URL_RE = /online\.autointegrate\.com\/EditRepairOrder\?/i;

  function extractRepairOrderId() {
    if (!RO_URL_RE.test(location.href)) return "";
    try {
      const url = new URL(location.href);
      const q = url.searchParams;
      return q.get("jsId") || q.get("jsid") || q.get("id") || url.searchParams.toString();
    } catch {
      return "";
    }
  }

  // ---- Supabase REST insert (single row) ----
  async function insertRowIntoTable(row, { debug = false, timeoutMs = 5000 } = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(SUPABASE_TABLE)}`;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort("timeout"), timeoutMs);

    let res, bodyText = "";
    const reqInit = {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "apikey": SUPABASE_ANON_KEY,
        "Prefer": "return=minimal",
        "Content-Type": "application/json"
      },
      body: JSON.stringify([row]),
      signal: ctrl.signal,

      // improve success rate during tab close
      keepalive: true,
    };

    const startedAt = Date.now();
    try {
      res = await fetch(url, reqInit);
      bodyText = await res.text().catch(() => "");
    } catch (e) {
      clearTimeout(to);
      const err = {
        kind: "network",
        message: e && e.message ? e.message : String(e),
        isAbort: e && (e.name === "AbortError" || e === "timeout"),
        durationMs: Date.now() - startedAt,
        request: { url, method: reqInit.method },
      };
      if (debug) console.error("[SessionRecorder] Network error", err);
      throw Object.assign(new Error(`Network/timeout error: ${err.message}`), { __dbg: err });
    }
    clearTimeout(to);

    const dbg = {
      kind: "http",
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      durationMs: Date.now() - startedAt,
      responseBody: bodyText,
      requestId: res.headers.get("x-request-id") || res.headers.get("x-supabase-request-id") || null
    };

    if (!res.ok) {
      if (debug) console.error("[SessionRecorder] DB insert failed", dbg);
      const msg = `DB insert failed: ${dbg.status} ${dbg.statusText} ${bodyText || ""}`.trim();
      throw Object.assign(new Error(msg), { __dbg: dbg });
    }

    if (debug) console.log("[SessionRecorder] DB insert ok", dbg);
    return dbg;
  }

  // ---- Core: capture + append ----
  let lastSent = { ro: null, t: 0 };
  const inflight = new Map(); // ro -> Promise

  async function captureAndAppend({ debug = false, echoRow = false } = {}) {
    function showDebugPanel(title, data) {
      if (!debug) return;
      try {
        const el = document.createElement("div");
        el.style.cssText = `
          position:fixed; z-index:2147483647; right:12px; bottom:12px;
          max-width:min(90vw, 700px); max-height:60vh; overflow:auto;
          background:#111; color:#eee; font:12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          border:1px solid #333; box-shadow:0 8px 24px rgba(0,0,0,.4); border-radius:10px; padding:12px;
        `;
        el.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="font-size:12px;color:#0bf;">${title}</strong>
            <button aria-label="Close" style="all:unset;cursor:pointer;padding:4px 8px;border-radius:6px;background:#222;color:#ddd;">×</button>
          </div>
          <pre style="white-space:pre-wrap;word-break:break-word;margin:0;">${(() => {
            try { return JSON.stringify(data, null, 2); } catch { return String(data); }
          })()}</pre>
        `;
        el.querySelector("button").onclick = () => el.remove();
        document.body.appendChild(el);
      } catch {}
    }

    const ro = extractRepairOrderId();
    if (!ro) {
      const info = { reason: "no_ro", url: location.href };
      log.warn("Skipped record — no Repair Order ID found or not on RO page.", info);
      if (debug) showDebugPanel("SessionRecorder: Skipped (no RO)", info);
      return { ok: false, skipped: true, reason: "no_ro" };
    }

    // ---- CONCURRENCY GUARD: collapse multiple exit events into one insert ----
    if (inflight.has(ro)) {
      log.warn(`Join inflight send for RO ${ro}.`);
      return inflight.get(ro);
    }

    const p = (async () => {
      try {
        const now = Date.now();

        // Debounce + immediate mark to block near-simultaneous reentry
        if (lastSent.ro === ro && now - lastSent.t < 1000) {
          const info = { reason: "debounced", ro, deltaMs: now - lastSent.t };
          log.warn(`Debounced duplicate send for RO ${ro}.`, info);
          if (debug) showDebugPanel("SessionRecorder: Debounced", info);
          return { ok: false, skipped: true, reason: "debounced" };
        }
        lastSent = { ro, t: now };

        const profile  = await window.AIExt.profile?.getCached?.()?.catch?.(() => null) || window.AIExt.profile?.getCached?.();
        const hover    = window.AIExt.hoverTracker?.getSnapshot?.() || {};
        const notes    = window.AIExt.notesTracker?.getSnapshot?.() || {};
        const idle     = window.AIExt.idleTracker?.getSnapshot?.() || {};
        const orphanedSnap = window.AIExt?.orphanedRO?.getSnapshot?.() || {};
        const orphanedBool =
           typeof orphanedSnap.orphaned_ro === "boolean"
             ? orphanedSnap.orphaned_ro
             : orphanedSnap.orphaned_ro == null
              ? null
               : Boolean(orphanedSnap.orphaned_ro);
        const partCost = window.AIExt.partCostTracker?.getSnapshot?.() || {};
        const laborHrs = window.AIExt.laborHrsTracker?.getSnapshot?.() || {};
        const similarRO = window.AIExt.similarRepairOrdersTracker?.getSnapshot?.() || {};
        const vehiclePolicy =
          window.AIExt.vehiclePolicyTracker?.getSnapshot?.() ||
          window.AIExt.vehiclePolicy?.getSnapshot?.() ||
          {};

        const row = {
          timestamp: new Date().toISOString(),
          ro: ro || null,
          url: location.href || null,
          agent_first: profile?.firstName || "",
          agent_last:  profile?.lastName  || "",
          agent_email: profile?.email     || "",
          hover_total: hover.total ?? null,
          hover_hovered: hover.hovered ?? null,
          avg_hover_sec: hover.avgHoverMs != null ? hover.avgHoverMs / 1000 : null,

          notes_clicked: notes.clicked ?? null,
          notes_type: notes.type || "",
          notes_read_sec: notes.totalNoteHoverMs != null ? notes.totalNoteHoverMs / 1000 : null,

          orphaned_ro: orphanedBool,
          first_work_delay_sec: idle.firstWorkDelaySec ?? null,
          idle_total_sec: idle.totalIdleSec ?? null,

          part_needs_check_count: partCost.needsCheckCount ?? null,
          part_checked_count: partCost.checkedCount ?? null,

          labor_needs_check_count: laborHrs.needsCheckCount ?? null,
          labor_checked_count: laborHrs.checkedCount ?? null,

          sro_total_similar_ros: similarRO.total_similar_ros ?? null,
          sro_clicked_total: similarRO.clicked_total ?? null,
          sro_clicked_unique: similarRO.clicked_unique ?? null,
          sro_clicked_ro_ids: Array.isArray(similarRO.clicked_ro_ids)
            ? similarRO.clicked_ro_ids.join("|")
            : "",

          vehicle_policy_requires_scroll: vehiclePolicy.requires_scroll ?? null,
          vehicle_policy_scrolled: vehiclePolicy.scrolled ?? null,
          vehicle_policy_hover_sec:
            vehiclePolicy.hover_ms != null ? vehiclePolicy.hover_ms / 1000 : null,
          vehicle_policy_scroll_top: vehiclePolicy.scroll_top ?? null,
          vehicle_policy_max_scroll_top: vehiclePolicy.max_scroll_top ?? null,
        };

        const db = await insertRowIntoTable(row, { debug });
        log.success(`Appended RO ${ro} to ${SUPABASE_TABLE}.`, db);

        const result = { ok: true, ro, row: echoRow ? row : undefined, db };
        window.AIExt.sessionRecorder.__lastDebug = result;
        if (debug) showDebugPanel("SessionRecorder: Insert OK", result);
        return result;

      } catch (err) {
        const details = {
          message: err?.message || String(err),
          debug: err?.__dbg || null
        };
        log.error("Error appending RO row:", details);
        window.AIExt.sessionRecorder.__lastDebug = { ok: false, error: details };

        // Allow retries on genuine failure: clear lastSent so a later trigger can try again.
        // (Keeps your original behavior from getting "stuck" in debounced state.)
        try {
          if (lastSent.ro === ro) lastSent = { ro: null, t: 0 };
        } catch {}

        if (debug) showDebugPanel("SessionRecorder: Insert FAILED", details);

        try {
          window.dispatchEvent(new CustomEvent("aixt:sr:error", { detail: details }));
        } catch {}

        if (debug) {
          try { alert(`[SessionRecorder] Insert failed:\n${details.message}`); } catch {}
        }

        return { ok: false, error: details };
      }
    })();

    inflight.set(ro, p);
    try {
      return await p;
    } finally {
      inflight.delete(ro);
    }
  }

  // ---- Triggers ----
  function onRepairOrderExit() {
    if (RO_URL_RE.test(location.href)) {
      log.info("RO close/navigation detected → appending row…");
      captureAndAppend();
    }
  }

  if (!window.AIExt.__srListenersAttached_simple) {
    window.AIExt.__srListenersAttached_simple = true;

    // Use pagehide only (avoid double-fire with beforeunload).
    // capture:true helps run earlier in the event phase.
    window.addEventListener("pagehide", onRepairOrderExit, { capture: true });

    // Keep SPA navigation trigger if you need it.
    window.addEventListener("aixt:locationchange", onRepairOrderExit);
  }

  // ---- Public API ----
  window.AIExt.sessionRecorder = {
    debug: false,
    init: () => {
      log.info("Session Recorder (simple) ready.");
    },
    recordNow: (opts = {}) => {
      const debug = opts.debug ?? window.AIExt.sessionRecorder.debug; // AIExt.sessionRecorder.recordNow({ debug: true, echoRow: true });
      const echoRow = !!opts.echoRow;
      log.info("[recordNow] Manual capture → append.", { debug, echoRow });
      return captureAndAppend({ debug, echoRow });
    },
    __lastDebug: null
  };

  // Auto-init
  window.AIExt.sessionRecorder.init();
})(); // end IIFE
} // end singleton guard