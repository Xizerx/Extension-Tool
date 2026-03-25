// repairOrderStatusTracker.js
// Reads Repair Order status from the Auto Integrate RO page.

(function () {
  window.AIExt = window.AIExt || {};
  if (window.AIExt.repairOrderStatusTracker) return; // singleton

  const VALID_STATUSES = new Set([
    "Approved",
    "Awaiting Client",
    "Awaiting Final Approval",
    "Awaiting Payment",
    "Awaiting Payment (National)",
    "Awaiting Shop",
    "Cancelled",
    "Historic",
    "Modified",
    "Not Submitted",
    "Not Submitted - Historic",
    "On Hold",
    "Paid",
    "Paid (National)",
    "Requires Approval",
    "Requires Shop Notification",
    "Returned from Client"
  ]);

  // This is the container you identified in DevTools.
  // If this class changes in the future, update this selector.
  const STATUS_CONTAINER_SELECTOR = ".MuiBox-root.css-sjaymb";

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getRepairOrderStatus() {
    const container = document.querySelector(STATUS_CONTAINER_SELECTOR);
    if (!container) return "";

    const candidates = Array.from(
      container.querySelectorAll("span, h1, h2, h3, h4, h5, h6, div")
    );

    const match = candidates.find((el) => {
      const text = normalizeText(el.textContent);
      return VALID_STATUSES.has(text);
    });

    return normalizeText(match?.textContent);
  }

  function getSnapshot() {
    const status = getRepairOrderStatus();

    return {
      repair_order_status: status || "",
      repair_order_status_found: Boolean(status),
      repair_order_status_container_selector: STATUS_CONTAINER_SELECTOR,
      last_checked: new Date().toISOString()
    };
  }

  window.AIExt.repairOrderStatusTracker = {
    init() {
      console.log("[repairOrderStatusTracker] initialized");
    },
    getSnapshot,
    getRepairOrderStatus
  };
})();