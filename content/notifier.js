// notifier.js
// Depends on: (none) — safe to load anywhere
window.AIExt = window.AIExt || {};

(function () {
  const LEVELS = {
    info:  { bg: "rgba(2,132,199,.95)"  }, // blue
    warn:  { bg: "rgba(245,158,11,.95)" }, // amber
    error: { bg: "rgba(190,18,60,.95)"  }  // red
  };

  let root = null;
  const notices = new Map(); // id -> {el, data}

  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "ai-notifier";
    root.style.cssText = `
      position: fixed; z-index: 2147483647; right: 12px; bottom: 12px;
      display: flex; flex-direction: column; gap: 10px;
      pointer-events: none; /* cards handle their own clicks */
    `;
    document.documentElement.appendChild(root);
    return root;
  }

  function makeCard({ id, level = "info", title = "", message = "", source = "", actions = [] }) {
    const card = document.createElement("div");
    const bg = (LEVELS[level] || LEVELS.info).bg;
    card.className = "ai-notice";
    card.style.cssText = `
      pointer-events: auto;
      max-width: 420px; padding: 10px 12px; border-radius: 10px;
      font: 12px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      color: #fff; background: ${bg};
      box-shadow: 0 6px 16px rgba(0,0,0,.35);
      border: 1px solid rgba(255,255,255,.12);
    `;

    card.innerHTML = `
      <div style="display:flex; gap:10px; align-items:flex-start;">
        <div style="flex:1 1 auto;">
          <div style="font-weight:700; margin-bottom:4px;">${title || "Notice"}</div>
          <div style="opacity:.95;">${message}</div>
          ${source ? `<div style="opacity:.7; margin-top:6px; font-style:italic;">Detected in: ${source}</div>` : ""}
          <div class="ai-actions" style="margin-top:8px; display:flex; gap:6px;"></div>
        </div>
        <button aria-label="Dismiss" title="Dismiss"
          style="cursor:pointer; background:transparent; border:0; color:#fff; opacity:.8; font-size:14px;">
          ✕
        </button>
      </div>
    `;

    // actions
    const actionsEl = card.querySelector(".ai-actions");
    (actions || []).forEach(({ label, onClick }) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.style.cssText = `
        cursor:pointer; border:0; border-radius:8px; padding:6px 10px;
        background: rgba(255,255,255,.15); color:#fff;
      `;
      btn.addEventListener("click", (e) => { e.stopPropagation(); onClick?.(); });
      actionsEl.appendChild(btn);
    });

    // dismiss
    card.querySelector("button[aria-label='Dismiss']").addEventListener("click", (e) => {
      e.stopPropagation();
      remove(id);
    });

    return card;
  }

  function add({ id, level, title, message, source, actions }) {
    ensureRoot();
    if (!id) id = "ai-" + Math.random().toString(36).slice(2);
    // update if present
    if (notices.has(id)) {
      update(id, { level, title, message, source, actions });
      return id;
    }
    const el = makeCard({ id, level, title, message, source, actions });
    root.appendChild(el);
    notices.set(id, { el, data: { id, level, title, message, source } });
    return id;
  }

  function update(id, patch = {}) {
    const rec = notices.get(id);
    if (!rec) return;
    const { el, data } = rec;
    const newData = { ...data, ...patch };
    // re-render card by replacing node (simple & safe)
    const idx = Array.from(root.children).indexOf(el);
    const newEl = makeCard(newData);
    root.replaceChild(newEl, el);
    notices.set(id, { el: newEl, data: newData });
  }

  function remove(id) {
    const rec = notices.get(id);
    if (!rec) return;
    rec.el.remove();
    notices.delete(id);
  }

  function clear() {
    notices.forEach(({ el }) => el.remove());
    notices.clear();
  }

  function init() {
    ensureRoot();
    console.log("[Notifier] Initialized");
  }

  AIExt.notifier = { add, update, remove, clear, LEVELS, init };
})();
