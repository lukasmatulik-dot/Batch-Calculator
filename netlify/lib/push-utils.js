import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

export const SUBSCRIPTIONS_STORE = "sous-vide-push-subscriptions";
export const TIMERS_STORE = "sous-vide-push-timers";

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export function getSubscriptionsStore() {
  return getStore({ name: SUBSCRIPTIONS_STORE, consistency: "strong" });
}

export function getTimersStore() {
  return getStore({ name: TIMERS_STORE, consistency: "strong" });
}

export function hashValue(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

export function isValidSubscription(subscription) {
  return Boolean(
    subscription &&
    typeof subscription.endpoint === "string" &&
    subscription.endpoint.startsWith("https://") &&
    subscription.keys &&
    typeof subscription.keys.p256dh === "string" &&
    typeof subscription.keys.auth === "string"
  );
}

export function subscriptionId(subscription) {
  return hashValue(subscription?.endpoint);
}

export function timerStorageKey(subscriptionHash, timerId) {
  return `timer-${subscriptionHash}-${hashValue(timerId)}`;
}

export function normalizeTimerInput(input) {
  const timerId = String(input?.timerId || "").trim();
  const ingredientName = String(input?.ingredientName || "").trim();
  const endTime = Number(input?.endTime);

  if (!timerId || timerId.length > 500) {
    throw new Error("Invalid timerId.");
  }
  if (!ingredientName || ingredientName.length > 160) {
    throw new Error("Invalid ingredientName.");
  }
  if (!Number.isFinite(endTime)) {
    throw new Error("Invalid endTime.");
  }

  const now = Date.now();
  const maxFutureTime = now + 14 * 24 * 60 * 60 * 1000;
  if (endTime <= now - 60_000 || endTime > maxFutureTime) {
    throw new Error("endTime is outside the allowed range.");
  }

  return { timerId, ingredientName, endTime };
}
