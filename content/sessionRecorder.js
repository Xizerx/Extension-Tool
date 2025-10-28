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
      signal: ctrl.signal
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

    try {
      const ro = extractRepairOrderId();
      if (!ro) {
        const info = { reason: "no_ro", url: location.href };
        log.warn("Skipped record — no Repair Order ID found or not on RO page.", info);
        if (debug) showDebugPanel("SessionRecorder: Skipped (no RO)", info);
        return { ok: false, skipped: true, reason: "no_ro" };
      }

      const now = Date.now();
      if (lastSent.ro === ro && now - lastSent.t < 1000) {
        const info = { reason: "debounced", ro, deltaMs: now - lastSent.t };
        log.warn(`Debounced duplicate send for RO ${ro}.`, info);
        if (debug) showDebugPanel("SessionRecorder: Debounced", info);
        return { ok: false, skipped: true, reason: "debounced" };
      }

      const profile  = await window.AIExt.profile?.getCached?.()?.catch?.(() => null) || window.AIExt.profile?.getCached?.();
      const hover    = window.AIExt.hoverTracker?.getSnapshot?.() || {};
      const notes    = window.AIExt.notesTracker?.getSnapshot?.() || {};
      const idle     = window.AIExt.idleTracker?.getSnapshot?.() || {};
      const orphaned = window.AIExt?.orphanedRO?.getSnapshot?.() || { orphaned_ro: 0 };

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
        orphaned_ro: orphaned.orphaned_ro ?? null,
        first_work_delay_sec: idle.firstWorkDelaySec ?? null,
        idle_total_sec: idle.totalIdleSec ?? null,
      };


      const db = await insertRowIntoTable(row, { debug });
      lastSent = { ro, t: now };
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
      if (debug) showDebugPanel("SessionRecorder: Insert FAILED", details);

      try {
        window.dispatchEvent(new CustomEvent("aixt:sr:error", { detail: details }));
      } catch {}

      if (debug) {
        try { alert(`[SessionRecorder] Insert failed:\n${details.message}`); } catch {}
      }

      return { ok: false, error: details };
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
    window.addEventListener("beforeunload", onRepairOrderExit);
    window.addEventListener("aixt:locationchange", onRepairOrderExit);
  }

  // ---- Public API ----
  window.AIExt.sessionRecorder = {
    debug: false,
    init: () => {
      log.info("Session Recorder (simple) ready.");
    },
    recordNow: (opts = {}) => {
      const debug = opts.debug ?? window.AIExt.sessionRecorder.debug;
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