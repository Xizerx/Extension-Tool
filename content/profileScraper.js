// content/profileScraper.js
// No warning prompt. Only success toast + console logging on success.

window.AIExt = window.AIExt || {};

(function () {
  const STORAGE_KEY = "agentProfile";
  const TTL_MS = 1 * 24 * 60 * 60 * 1000;  // 1 day

  // ---- singleton guard ----
  if (window.__AI_PROFILE_SCRIPT_BOUND) return;
  window.__AI_PROFILE_SCRIPT_BOUND = true;

  let hasShownSuccess = false;
  let captureInFlight = false;

  // ---- storage helpers ----
  async function loadProfile() {
    try {
      const res = await new Promise(r => chrome.storage.local.get(STORAGE_KEY, r));
      return res?.[STORAGE_KEY] || null;
    } catch { return null; }
  }

  async function saveProfile(p) {
    const payload = { ...p, ts: new Date().toISOString() };
    await chrome.storage.local.set({ [STORAGE_KEY]: payload });
    return payload;
  }

  function isFresh(p) {
    if (!p?.ts) return false;
    const age = Date.now() - new Date(p.ts).getTime();
    return age >= 0 && age < TTL_MS;
  }

  // ---- success UI ----
  function showToastSuccess(profile) {
    if (hasShownSuccess) return;
    hasShownSuccess = true;

    AIExt.notifier?.remove?.("profile-needed"); // just in case anything old exists

    AIExt.notifier?.add?.({
      id: "profile-loaded",
      level: "info",
      title: "Credentials loaded",
      message: `${profile.firstName || ""} ${profile.lastName || ""} • ${profile.email || ""}`,
      source: "Profile",
      actions: []
    });
    setTimeout(() => AIExt.notifier?.remove?.("profile-loaded"), 4000);

    console.log("[Profile] Credentials loaded:", {
      firstName: profile.firstName,
      lastName:  profile.lastName,
      ts:        profile.ts || new Date().toISOString()
    });
  }

  // ---- background RPC (no prompts/timers) ----
  async function requestBackgroundCapture() {
    if (captureInFlight) return null;
    captureInFlight = true;

    console.log("[Profile] requesting background capture…");
    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "PROFILE_CAPTURE_REQUEST" }, (resp) => {
        captureInFlight = false;
        if (chrome.runtime.lastError) {
          console.warn("[Profile] BG message error:", chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        if (resp?.ok && resp.profile) {
          saveProfile(resp.profile).catch(()=>{});
          resolve(resp.profile);
        } else {
          resolve(null);
        }
      });
    });

    return result;
  }

  // ---- listen ONLY for success; ignore failures entirely ----
  if (!window.__AI_PROFILE_LISTENER_BOUND) {
    window.__AI_PROFILE_LISTENER_BOUND = true;

    chrome.runtime.onMessage.addListener(async (msg) => {
      if (msg?.type === "PROFILE_CAPTURED" && msg.profile) {
        await saveProfile(msg.profile).catch(()=>{});
        showToastSuccess(msg.profile);
      }
      // Ignore PROFILE_CAPTURE_FAILED / _FINAL etc. No warning UI.
    });
  }

  // ---- public API ----
  AIExt.profile = {
    async ensureCached() {
      const cached = await loadProfile();
      if (isFresh(cached) && (cached.email || (cached.firstName && cached.lastName))) {
        if (!hasShownSuccess) {
          console.log("[Profile] Using cached credentials:", {
            firstName: cached.firstName, lastName: cached.lastName, email: cached.email, ts: cached.ts
          });
        }
        hasShownSuccess = true;
        return cached;
      }

      const captured = await requestBackgroundCapture();
      if (captured && (captured.email || (captured.firstName && captured.lastName))) {
        await saveProfile(captured).catch(()=>{});
        showToastSuccess(captured);
        return captured;
      }

      // No UI on failure; simply return whatever we had (likely null on first run)
      return cached || null;
    },

    async getCached() {
      return await loadProfile();
    },

    async refresh() {
      const p = await requestBackgroundCapture();
      if (p) { await saveProfile(p).catch(()=>{}); showToastSuccess(p); }
      return p || (await loadProfile());
    },

    async clearCache() {
      await new Promise(r => chrome.storage.local.remove(STORAGE_KEY, r));
      hasShownSuccess = false;
      console.log("[Profile] cache cleared");
    }
  };
})();
