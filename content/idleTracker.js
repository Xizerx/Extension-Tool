// idleTracker.js
// Tracks: (1) time to first activity (in seconds), (2) total idle time (≥ threshold, in seconds)
// Depends on: none (optionally uses AIExt.utils.throttle if present)
window.AIExt = window.AIExt || {};

(function () {
  const INACTIVITY_MS = 3_000;           // threshold before we consider the user "idle"
  const INITIAL_IDLE_BUFFER_MS = 5_000;  // subtract this once at first meaningful activity

  // State
  let startedAt = Date.now();       // when we began tracking for this RO/tab
  let firstActiveAt = null;         // timestamp of first *meaningful* activity
  let lastActiveAt = null;          // last activity timestamp
  let idleStartAt = null;           // when we *entered* idle (null if active)
  let totalIdleMs = 0;              // accumulated idle time
  let isIdle = false;               // current idle state
  let idleTimer = null;             // timer that fires when inactivity crosses the threshold

  // For logging
  let lastPrinted = null;

  // Event policies
  const FIRST_ACTIVITY_TYPES = new Set(["mousedown", "keydown", "touchstart", "wheel"]);
  const ALL_ACTIVITY_TYPES = new Set([
    "mousedown", "keydown", "touchstart",
    "mousemove", "wheel", "touchmove"
  ]);

  // Helpers
  function toSeconds(ms) {
    return +(ms / 1000).toFixed(2);
  }

  function snapshot() {
    const firstWorkDelayMs = firstActiveAt
    ? Math.max(firstActiveAt - startedAt - INITIAL_IDLE_BUFFER_MS, 0)
    : 0;

    return {
      startedAt,
      lastActiveAt,
      firstActiveAt,
      firstWorkDelaySec: toSeconds(firstWorkDelayMs),
      totalIdleSec: toSeconds(totalIdleMs),
      isIdle
    };
  }

  function different(a, b) {
    if (!a || !b) return true;
    return (
      a.firstWorkDelaySec !== b.firstWorkDelaySec ||
      a.totalIdleSec !== b.totalIdleSec ||
      a.isIdle !== b.isIdle
    );
  }

  function logIfChanged() {
    const s = snapshot();
    if (different(s, lastPrinted)) {
      lastPrinted = { ...s };
      console.log("[IdleTracker]", {
        firstWorkDelaySec: s.firstWorkDelaySec,
        totalIdleSec: s.totalIdleSec,
        isIdle: s.isIdle
      });
    }
  }

  // Timer helpers
  function clearIdleTimer() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  function armIdleTimer() {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      const now = Date.now();

      // Enter idle as soon as we cross the inactivity threshold — no special casing for the initial buffer.
      if (!isIdle) {
        isIdle = true;
        idleStartAt = now;
        logIfChanged();
      }
    }, INACTIVITY_MS);
  }

  // Core activity handling
  function commitActivity(ts) {
    const isFirstMeaningful = (firstActiveAt == null);

    if (isFirstMeaningful) {
      firstActiveAt = ts;
    }
    lastActiveAt = ts;

    if (isIdle) {
      isIdle = false;
      if (idleStartAt != null) {
        totalIdleMs += (ts - idleStartAt);
        idleStartAt = null;
      }
    }

    // Apply the initial buffer exactly once, at the moment we record first meaningful activity.
    if (isFirstMeaningful) {
      totalIdleMs = Math.max(0, totalIdleMs - INITIAL_IDLE_BUFFER_MS);
    }

    logIfChanged();
    armIdleTimer();
  }

  function onUserActivity(e) {
    const now = Date.now();

    // Always keep the idle timer fresh on any event we listen to
    armIdleTimer();

    // If we don't have first activity yet, only accept strong, trusted inputs
    if (!firstActiveAt) {
      if (!e || !e.isTrusted) return;                 // ignore synthetic events
      if (!FIRST_ACTIVITY_TYPES.has(e.type)) return;  // ignore soft inputs before first activity
      commitActivity(now);
      return;
    }

    // After first activity, any of our listened events count as activity
    if (e && ALL_ACTIVITY_TYPES.has(e.type)) {
      commitActivity(now);
    }
  }

  function onVisibilityChange() {
    // Becoming visible should prevent idle, but must NOT set first activity
    if (document.visibilityState === "visible") {
      armIdleTimer();
      if (firstActiveAt) commitActivity(Date.now());
    }
  }

  // Public API
  AIExt.idleTracker = {
    init() {
      console.log("[IdleTracker] Initializing… (threshold:", INACTIVITY_MS / 1000, "s, idle buffer:", INITIAL_IDLE_BUFFER_MS / 1000, "s)");
      startedAt = Date.now();
      firstActiveAt = null;
      lastActiveAt = null;
      idleStartAt = null;
      totalIdleMs = 0;
      isIdle = false;
      clearIdleTimer();
      armIdleTimer();

      const opts = { passive: true, capture: true };

      // Strong inputs (can establish first activity)
      window.addEventListener("mousedown", onUserActivity, opts);
      window.addEventListener("keydown", onUserActivity, opts);
      window.addEventListener("touchstart", onUserActivity, opts);

      // Soft inputs (ignored for first activity, but count afterwards)
      window.addEventListener("mousemove", onUserActivity, opts);
      window.addEventListener("wheel", onUserActivity, opts);
      window.addEventListener("touchmove", onUserActivity, opts);

      // Focus keeps timer fresh, never establishes first activity
      window.addEventListener(
        "focus",
        () => {
          armIdleTimer();
          if (firstActiveAt) commitActivity(Date.now());
        },
        true
      );

      document.addEventListener("visibilitychange", onVisibilityChange, opts);

      // Boot retry so logs appear even if idle before first action
      let tries = 0, max = 20;
      const t = setInterval(() => {
        tries++;
        logIfChanged();
        if (tries >= max) clearInterval(t);
      }, 250);
    },

    reset() {
      console.log("[IdleTracker] Reset for new RO.");
      this.init();
    },

    getSnapshot() {
      return snapshot();
    }
  };
})();
