// utils.js
window.AIExt = window.AIExt || {};

(function () {
  const qAll = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function lineItemRoot(fromEl) {
    const labeled = fromEl.closest?.('section[aria-label], article[aria-label]');
    if (labeled) return labeled;
    return (
      fromEl.closest?.('[role="row"],[role="group"],[role="region"]') ||
      fromEl.closest?.('.MuiBox-root') ||
      fromEl.parentElement ||
      document.body
    );
  }

  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function throttle(fn, ms) {
    let last = 0, timer = null, pendingArgs = null;
    return function (...args) {
      const now = Date.now();
      if (now - last >= ms) {
        last = now; fn.apply(this, args);
      } else {
        pendingArgs = args;
        clearTimeout(timer);
        timer = setTimeout(() => {
          last = Date.now();
          fn.apply(this, pendingArgs);
          pendingArgs = null;
        }, ms - (now - last));
      }
    };
  }

  // Wait until body exists (rare race at document_start/idle on some SPAs)
  function whenBodyReady() {
    if (document.body) return Promise.resolve();
    return new Promise(res => {
      const i = setInterval(() => {
        if (document.body) { clearInterval(i); res(); }
      }, 10);
    });
  }

  /**
   * Your original DOM/SPA hooks, wrapped as a helper.
   * Calls `onDomChange()` on mutations; `onUrlChange()` on SPA navigations.
   */
  function mountSpaHooks(onDomChange, onUrlChange) {
    let cleanup = () => {};

    whenBodyReady().then(() => {
      // Observe DOM/SPAs (your original snippet)
      const mo = new MutationObserver(() => onDomChange?.());
      mo.observe(document.body, { childList: true, subtree: true });

      // Avoid double patching history in case this runs twice
      if (!history.__aiext_patched) {
        const origPush = history.pushState;
        const origRep  = history.replaceState;
        const handler  = () => setTimeout(() => onUrlChange?.(location.href), 120);

        history.pushState = function () { origPush.apply(this, arguments); handler(); };
        history.replaceState = function () { origRep.apply(this, arguments); handler(); };
        window.addEventListener("popstate", handler);

        history.__aiext_patched = true;
      }

      cleanup = () => mo.disconnect();
    });

    // Return a cleanup that at least disconnects the MO (we keep history patched)
    return () => cleanup();
  }

  AIExt.utils = { qAll, lineItemRoot, escapeHtml, throttle, mountSpaHooks };
})();
