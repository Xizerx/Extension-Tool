// orphanedROGuard.js — API only (no network)
// Exposes a tiny API for sessionrecorder.js to read whether the current RO is
// "orphaned" (Requires Approval AND NOT submitted back to supplier).
//
// Usage from sessionrecorder.js:
//   const snap = window.AIExt?.orphanedRO?.getSnapshot?.() || { orphaned_ro: 0 };
//   row.orphaned_ro = snap.orphaned_ro; // 1 = orphaned, 0 = not
//
// Optional live updates:
//   window.AIExt.orphanedRO.startAuto(1500); // emits 'orphaned-ro-updated' events
//   document.addEventListener('orphaned-ro-updated', (e) => console.log(e.detail));

(function(){
  const CONFIG = {
    // Detect status using MUI aria-describedby pattern first
    statusLabelTextRe: /ro\s*status\s*name/i,
    statusSelectorFallback: '[data-ro-status], .ro-status, [aria-label="RO Status"]',
    statusRequiresApprovalRe: /requires\s*approval/i,

    // Detect "submitted back to supplier"
    submittedFlagSelector: '[data-submitted-back="true"], .chip--submitted-back, [aria-label="Submitted back to supplier"]',
    submittedFlagTextSelector: '[data-submitted-text], .ro-submission-state',
    submittedFlagTextRe: /submitted\s+back\s+to\s+supplier|returned\s+to\s+supplier/i,

  };

  window.AIExt = window.AIExt || {};
  if (window.AIExt.orphanedRO) return; // singleton

  // -------- DOM helpers --------
  function textOf(sel){
    const el = document.querySelector(sel);
    return (el?.textContent || el?.getAttribute?.('content') || '').trim();
  }

  function getStatusText(){
    // Prefer aria-describedby label→value pair
    const nodes = document.querySelectorAll('[aria-describedby]');
    for (const el of nodes){
      const id = el.getAttribute('aria-describedby'); if (!id) continue;
      const label = document.getElementById(id); if (!label) continue;
      const t = (label.textContent || '').trim();
      if (CONFIG.statusLabelTextRe.test(t)) return (el.textContent || '').trim();
    }
    const fb = document.querySelector(CONFIG.statusSelectorFallback);
    return (fb?.textContent || '').trim();
  }

  function hasRequiresApproval(){
    return CONFIG.statusRequiresApprovalRe.test(getStatusText());
  }

  function hasSubmittedBack(){
    if (document.querySelector(CONFIG.submittedFlagSelector)) return true;
    const txt = textOf(CONFIG.submittedFlagTextSelector);
    return !!txt && CONFIG.submittedFlagTextRe.test(txt);
  }

  // -------- Snapshot --------
  let lastSnap = { orphaned_ro: 0, status_text: '', submitted_back: false, last_checked: '' };

  function computeSnapshot(){
    const status_text = getStatusText();
    const submitted_back = hasSubmittedBack();
    const orphaned_ro = (CONFIG.statusRequiresApprovalRe.test(status_text) && !submitted_back) ? 1 : 0;
    return {
      orphaned_ro,
      status_text,
      submitted_back,
      last_checked: new Date().toISOString(),
    };
  }

  function emitIfChanged(snap){
    if (
      snap.orphaned_ro !== lastSnap.orphaned_ro ||
      snap.status_text !== lastSnap.status_text ||
      snap.submitted_back !== lastSnap.submitted_back
    ){
      lastSnap = snap;
      document.dispatchEvent(new CustomEvent('orphaned-ro-updated', { detail: snap }));
    } else {
      lastSnap = snap; // still refresh timestamp
    }
  }

  // -------- Public API --------
  window.AIExt.orphanedRO = {
    init(){
        console.log("[orphanedROGuard] initialized");
      const snap = computeSnapshot();
      emitIfChanged(snap);
    },
    getSnapshot(){
      const snap = computeSnapshot();
      emitIfChanged(snap);
      return snap;
    },
    startAuto(intervalMs = 1500){
      if (this._timer) return;
      this._timer = setInterval(() => emitIfChanged(computeSnapshot()), intervalMs);
    },
    stopAuto(){
      if (!this._timer) return;
      clearInterval(this._timer); this._timer = null;
    }
  };
})();