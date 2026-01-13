// content/canadaGoogleParts.js
window.AIExt = window.AIExt || {};

(function () {
  const LOG = (...args) => console.debug("[AIExt][CanadaGoogleParts]", ...args);
  const WARN = (...args) => console.warn("[AIExt][CanadaGoogleParts]", ...args);

  const RO_URL_RE = /https:\/\/online\.autointegrate\.com\/EditRepairOrder\?/i;

  // Marker so we don't re-process the same <a>
  const MARK_ATTR = "data-aiext-q-canada";

  // How we decide "this RO is Canadian"
  const CAD_MARK_RE = /\bCA\$\s?\d/i; // matches "CA$1,234.00" etc.

  function isCanadianRO() {
    // Fast and simple: check visible text for CA$ patterns
    // If you have a more deterministic selector for currency, use that instead.
    const t = document.body?.innerText || "";
    return CAD_MARK_RE.test(t);
  }

  function isGoogleSearchLink(a) {
    try {
      const u = new URL(a.href);
      // Accept both www.google.com/search and google.com/search
      if (!/^(www\.)?google\.com$/i.test(u.hostname)) return false;
      if (u.pathname !== "/search") return false;
      return u.searchParams.has("q");
    } catch {
      return false;
    }
  }

  function hasCanadaAlready(q) {
    return /\bcanada\b/i.test(q || "");
  }

  function appendCanadaToQueryHref(a) {
    try {
      const u = new URL(a.href);

      const q = u.searchParams.get("q") || "";
      if (!q) return false;

      if (hasCanadaAlready(q)) return false;

      // Append " Canada" to the query
      u.searchParams.set("q", `${q} Canada`);

      a.href = u.toString();
      a.setAttribute(MARK_ATTR, "1");
      return true;
    } catch (e) {
      WARN("Failed to rewrite href:", e);
      return false;
    }
  }

  function processLinksOnce() {
    if (!RO_URL_RE.test(location.href)) return;

    // Only do anything if the RO looks Canadian
    if (!isCanadianRO()) return;

    const anchors = Array.from(document.querySelectorAll("a[href]")).filter(
      (a) =>
        !a.hasAttribute(MARK_ATTR) &&
        isGoogleSearchLink(a)
    );

    if (!anchors.length) return;

    let changed = 0;
    for (const a of anchors) {
      if (appendCanadaToQueryHref(a)) changed++;
    }

    if (changed) LOG(`Updated ${changed} Google search link(s) with 'Canada'.`);
  }

  function start() {
    processLinksOnce();

    const mo = new MutationObserver(() => {
      try {
        processLinksOnce();
      } catch (_) {}
    });

    try {
      mo.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
    } catch (_) {}
  }

  function init() {
    LOG("init called");

    const kickOff = () => start();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", kickOff, { once: true });
    } else {
      kickOff();
    }

    // If you have SPA hooks, re-run on route changes
    const { mountSpaHooks } = window.AIExt.utils || {};
    if (mountSpaHooks) {
      mountSpaHooks(
        () => kickOff(),
        () => kickOff()
      );
    }
  }

  window.AIExt.canadaGoogleParts = { init };
})();
