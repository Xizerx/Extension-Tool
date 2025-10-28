async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function setDot(pct) {
  const dot = document.getElementById("dot");
  let bg = "#ef4444";
  if (pct >= 90) bg = "#22c55e";
  else if (pct >= 50) bg = "#f59e0b";
  dot.style.background = bg;
}

function render(state) {
  document.getElementById("count").textContent = `${state.hovered} / ${state.total}`;
  document.getElementById("pct").textContent = `${state.percentage}%`;
  document.getElementById("ro").textContent = state.repairOrderId || "—";
  document.getElementById("inv").textContent = state.invoiceNumber || "—";
  document.getElementById("url").textContent = state.url || "—";
  setDot(state.percentage);

  const list = document.getElementById("list");
  list.innerHTML = "";
  if (!state.unvisited || state.unvisited.length === 0) {
    const el = document.createElement("div");
    el.className = "muted";
    el.textContent = "Nice! You’ve hovered everything.";
    list.appendChild(el);
  } else {
    state.unvisited.forEach((desc, i) => {
      const row = document.createElement("div");
      row.className = "li";
      row.innerHTML = `<div class="num">${i + 1}.</div><div class="desc"></div>`;
      row.querySelector(".desc").textContent = desc;
      list.appendChild(row);
    });
  }
}
async function refresh() {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  // Only handle if we are on an EditRepairOrder page
  if (!/https:\/\/online\.autointegrate\.com\/EditRepairOrder\?/i.test(tab.url || "")) {
    render({
      hovered: 0,
      total: 0,
      percentage: 0,
      unvisited: [],
      repairOrderId: "—",
      invoiceNumber: "—",
      url: "—"
    });
    return;
  }

  chrome.tabs.sendMessage(tab.id, { fn: "getState" }, (resp) => {
    if (chrome.runtime.lastError || !resp) {
      // fallback if no response from content.js
      render({
        hovered: 0,
        total: 0,
        percentage: 0,
        unvisited: [],
        repairOrderId: "—",
        invoiceNumber: "—",
        url: "—"
      });
      return;
    }
    render(resp);
  });
}


document.getElementById("refresh").addEventListener("click", refresh);
document.addEventListener("DOMContentLoaded", refresh);

//Username rendering
async function renderUser() {
  const nameEl = document.getElementById("userName");
  const emailEl = document.getElementById("userEmail");

  // Load from chrome.storage.local
  const { agentProfile } = await chrome.storage.local.get("agentProfile");
  const p = agentProfile;

  if (p) {
    const fullName = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
    nameEl.textContent = fullName || (p.email ? p.email.split("@")[0] : "Guest");
  } else {
    nameEl.textContent = "—";
    emailEl.textContent = "—";
  }
}
document.addEventListener("DOMContentLoaded", async () => {
  await renderUser();
  await refresh();  // your existing function
});