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

  // We now cache the FULL client code token, e.g. "FA9500"
  let cachedClientCode = "";
  let rawClientText = "";
  let finalUrl = "";
  let didLogSummary = false;
  let clickedClientTabOnce = false;
  let roKey = "";

  function norm(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  // Normalize anything like:
  // "FA 9500" / "FA-9500" / "fa:9500" -> "FA9500"
  // "9500" (no prefix) -> "" (we require prefix per your requirement)
  function normalizeClientCode(raw) {
    const t = String(raw || "").toUpperCase();
    const m = t.match(/\b(FA|CA)\s*[-:]?\s*([A-Z0-9]{3,})\b/);
    return m ? `${m[1]}${m[2]}` : "";

  }

  function getCurrentRoKey() {
    return location.href;
  }

  function resetForNewRoIfNeeded() {
    const k = getCurrentRoKey();
    if (k !== roKey) {
      roKey = k;
      cachedClientCode = "";
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
    ).find((t) => re.test(norm(t.textContent || "")));
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
      try {
        tab.click();
      } catch {}
    }
  }

  function parseClient(panel) {
    const text = panel?.innerText || "";
    const m = text.match(
    /corp\s*\/\s*client\s*number[\s\S]{0,120}?((?:FA|CA)\s*[-:\s]*[A-Z0-9]{3,})/i
    );
    if (!m) return "";

    rawClientText = m[1];
    return normalizeClientCode(m[1]); // => "FA9500"
  }

  function attemptClientCapture() {
    if (cachedClientCode) return;

    const clientTab = findTabByText(/client\s*details/i);
    if (!clientTab) return;

    if (!isTabActive(clientTab) && !clickedClientTabOnce) {
      clickedClientTabOnce = true;
      try {
        clientTab.click();
      } catch {}
      return;
    }

    const panel = getTabPanel(clientTab);
    if (!panel) return;

    const parsedCode = parseClient(panel);
    if (!parsedCode) return;

    cachedClientCode = parsedCode;

    // IMPORTANT: policy site expects cli_no digits in your existing code.
    // We keep that behavior, but now derive digits from the full code.
    const digits = parsedCode.replace(/^(FA|CA)/, "");
    finalUrl = `${BASE}${encodeURIComponent(digits)}`;

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

    if (cachedClientCode) {
      a.href = finalUrl;
      a.style.pointerEvents = "auto";
      a.style.opacity = "1";

      if (!didLogSummary) {
        console.log(`[${FEATURE}]`, {
          enabled: true,
          originalClientId: rawClientText,
          parsedClientCode: cachedClientCode, // "FA9500"
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

  // Export full client code for FedexGuard (and others)
  window.AIExt.clientInfoLinker = {
    init: start,

    // Full code, e.g. "FA9500"
    getClientCode: () => cachedClientCode || "",

    // Debug helpers
    getRawClientText: () => rawClientText || "",
    getFinalUrl: () => finalUrl || "",
  };
})();
