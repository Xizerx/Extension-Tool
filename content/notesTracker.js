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

