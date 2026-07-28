import { matchOrders } from "../services/matching.service.js";

let intervalId = null;

export function startMatchingWorker() {
  if (intervalId) return;
  console.log("[worker] Starting order matching worker (2s interval)");
  intervalId = setInterval(() => {
    matchOrders().catch((err) => console.error("[worker] Matching error:", err.message));
  }, 2000);
}

export function stopMatchingWorker() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}
