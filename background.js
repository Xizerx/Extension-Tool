// background.js (MV3) — Profile capture with retry/backoff + final-failure signaling

// ====== Helpers executed IN the /UserProfile page ======
function __probeProfileReady() {
  // Return true when "First Name" label exists AND its value (via aria-describedby) is non-empty
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const txt = el => norm(el?.textContent || "");

  const label = Array.from(document.querySelectorAll("span,div,strong,label"))
    .find(el => el.id && txt(el).toLowerCase() === "first name");
  if (!label) return false;

  const valEl = document.querySelector(`[aria-describedby="${CSS.escape(label.id)}"]`);
  return !!(valEl && txt(valEl));
}

function __scrapeProfile() {
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const txt = el => norm(el?.textContent || "");

  function valueByAria(labelText) {
    const label = Array.from(document.querySelectorAll("span,div,strong,label"))
      .find(el => el.id && txt(el).toLowerCase() === labelText.toLowerCase());
    if (!label) return "";
    const el = document.querySelector(`[aria-describedby="${CSS.escape(label.id)}"]`);
    return txt(el);
  }

  const firstName = valueByAria("First Name");
  const lastName  = valueByAria("Last Name");
  const email     = valueByAria("Email") || valueByAria("E-mail");

  return { firstName, lastName, email };
}

// ====== Orchestration ======
const PROFILE_URL       = "https://online.autointegrate.com/UserProfile";
const MAX_ATTEMPTS      = 3;
const LOAD_TIMEOUT_MS   = 20_000;         // wait for navigation complete
const READY_TIMEOUT_MS  = 20_000;         // wait for DOM to render values
const BACKOFF_MS        = [0, 4000, 6000]; // between attempts (after 1st, 2nd)
let   _captureLock      = false;

// Wait for tab status === 'complete'
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpd);
      reject(new Error("Timeout waiting for tab complete"));
    }, timeoutMs);

    function onUpd(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(to);
        chrome.tabs.onUpdated.removeListener(onUpd);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpd);
  });
}

// Poll inside the page until labels/values are present
async function waitForProfileReady(tabId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const [{ result: isReady }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: __probeProfileReady
      });
      if (isReady) return true;
    } catch {
      // ignore, the page may not be fully script-injectable yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function openSilentTab() {
  return await chrome.tabs.create({ url: PROFILE_URL, active: false });
}
async function closeTabSafe(tabId) {
  try { await chrome.tabs.remove(tabId); } catch {}
}

async function captureOnce() {
  const tab = await openSilentTab();
  try {
    await waitForTabComplete(tab.id, LOAD_TIMEOUT_MS);
    const domReady = await waitForProfileReady(tab.id, READY_TIMEOUT_MS);
    if (!domReady) return null;

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: __scrapeProfile
    });
    const ok = !!(result?.firstName || result?.lastName || result?.email);
    return ok ? result : null;
  } finally {
    await closeTabSafe(tab.id);
  }
}

async function captureProfileWithRetry() {
  if (_captureLock) return null;
  _captureLock = true;

  let profile = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, BACKOFF_MS[attempt - 1] || 0));
    try {
      profile = await captureOnce();
      if (profile) break;
    } catch {
      // ignore; proceed to next attempt
    }
  }

  _captureLock = false;
  return profile;
}

// ====== Messaging / Notifications ======
async function notifyAllTabs(type, payload) {
  const tabs = await chrome.tabs.query({ url: "https://online.autointegrate.com/*" });
  for (const t of tabs) {
    try { chrome.tabs.sendMessage(t.id, { type, ...payload }); } catch {}
  }
}

async function showChromeNotification(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/Logomark_Color_Large.png",
      title,
      message,
      priority: 1
    });
  } catch {}
}

// Handle content → background requests
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "PROFILE_CAPTURE_REQUEST") {
    (async () => {
      const profile = await captureProfileWithRetry();

      if (profile) {
        const payload = { ...profile, ts: new Date().toISOString() };
        await chrome.storage.local.set({ agentProfile: payload });

        await notifyAllTabs("PROFILE_CAPTURED", { profile: payload });
        await showChromeNotification(
          "Credentials loaded",
          `${payload.firstName || ""} ${payload.lastName || ""} • ${payload.email || ""}`
        );

        sendResponse({ ok: true, profile: payload });
      } else {
        // Only sent AFTER all retries are exhausted
        console.warn("[BG] Failed to capture profile after all retries");
        await notifyAllTabs("PROFILE_CAPTURE_FAILED_FINAL", {});
        sendResponse({ ok: false, error: "Could not capture after retries" });
      }
    })();
    return true; // keep message channel open for async response
  }
});
