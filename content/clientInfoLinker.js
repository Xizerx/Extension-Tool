// content/clientInfoLinker.js
window.AIExt = window.AIExt || {};

(function () {
  const FEATURE = "ClientInfoLinker";

  const RO_URL_RE = /https:\/\/online\.autointegrate\.com\/EditRepairOrder\?/i;
  const BASE =
    "http://managedmaintenancepolicy.fleet.ad/index.html#index.html?cli_no=";

  const START_DELAY_MS = 3000;

  const VPH_PRIMARY_SELECTOR =
    '#pageSidePanelLeft section[aria-label="Vehicle Policy Highlights"]';
  const VPH_FALLBACK_SELECTOR = "#pageSidePanelLeft > div";

  let cachedClientNo = "";
  let rawClientText = "";
  let finalUrl = "";
  let didLogSummary = false;
  let clickedClientTabOnce = false;
  let roKey = "";

  function norm(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function extractClientDigits(raw) {
    const m = String(raw || "")
      .toUpperCase()
      .match(/\b(?:FA|CA)?\s*[-:]?\s*(\d{3,})\b/);
    return m ? m[1] : "";
  }

  function getCurrentRoKey() {
    return location.href;
  }

  function resetForNewRoIfNeeded() {
    const k = getCurrentRoKey();
    if (k !== roKey) {
      roKey = k;
      cachedClientNo = "";
      rawClientText = "";
      finalUrl = "";
      clickedClientTabOnce = false;
      didLogSummary = false;
    }
  }

  function getVphBox() {
    return (
      document.querySelector(VPH_PRIMARY_SELECTOR) ||
      document.querySelector(VPH_FALLBACK_SELECTOR)
    );
  }

  function findTabByText(re) {
    return Array.from(
      document.querySelectorAll('button[role="tab"],[role="tab"]')
    ).find(t => re.test(norm(t.textContent || "")));
  }

  function isTabActive(tab) {
    return (
      tab?.getAttribute("aria-selected") === "true" ||
      (tab?.className || "").includes("Mui-selected")
    );
  }

  function getTabPanel(tab) {
    const id = tab?.getAttribute("aria-controls");
    return id ? document.getElementById(id) : null;
  }

  function goToVehicleDetails() {
    const tab = findTabByText(/vehicle\s*details/i);
    if (tab && !isTabActive(tab)) {
      try { tab.click(); } catch {}
    }
  }

  function parseClient(panel) {
    const text = panel?.innerText || "";
    const m = text.match(
      /corp\s*\/\s*client\s*number[\s\S]{0,80}?((?:FA|CA)?[-:\s]*\d{3,})/i
    );
    if (!m) return "";

    rawClientText = m[1];
    return extractClientDigits(m[1]);
  }

  function attemptClientCapture() {
    if (cachedClientNo) return;

    const clientTab = findTabByText(/client\s*details/i);
    if (!clientTab) return;

    if (!isTabActive(clientTab) && !clickedClientTabOnce) {
      clickedClientTabOnce = true;
      try { clientTab.click(); } catch {}
      return;
    }

    const panel = getTabPanel(clientTab);
    if (!panel) return;

    const parsed = parseClient(panel);
    if (!parsed) return;

    cachedClientNo = parsed;
    finalUrl = `${BASE}${encodeURIComponent(parsed)}`;

    goToVehicleDetails();
  }

  function upsertButton() {
    resetForNewRoIfNeeded();
    if (!RO_URL_RE.test(location.href)) return;

    attemptClientCapture();

    const vph = getVphBox();
    if (!vph) return;

    let wrap =
      vph.nextElementSibling?.getAttribute?.("data-aiext-client") === "1"
        ? vph.nextElementSibling
        : null;

    if (!wrap) {
      wrap = document.createElement("div");
      wrap.setAttribute("data-aiext-client", "1");
      wrap.style.marginTop = "8px";

      const a = document.createElement("a");
      a.textContent = "Client Information Link";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.display = "block";
      a.style.padding = "10px";
      a.style.border = "1px solid #ccc";
      a.style.textAlign = "center";
      wrap.appendChild(a);

      vph.insertAdjacentElement("afterend", wrap);
    }

    const a = wrap.querySelector("a");

    if (cachedClientNo) {
      a.href = finalUrl;
      a.style.pointerEvents = "auto";
      a.style.opacity = "1";

      if (!didLogSummary) {
        console.log(`[${FEATURE}]`, {
          enabled: true,
          originalClientId: rawClientText,
          parsedClientId: cachedClientNo,
          finalUrl,
        });
        didLogSummary = true;
      }
    } else {
      a.href = "#";
      a.style.pointerEvents = "none";
      a.style.opacity = "0.6";
    }
  }

  function start() {
    upsertButton();
    const mo = new MutationObserver(() => upsertButton());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  setTimeout(start, START_DELAY_MS);

  window.AIExt.clientInfoLinker = { init: start };
})();
