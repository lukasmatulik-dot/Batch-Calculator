
import {
  getSubscriptionsStore,
  getTimersStore,
  isValidSubscription,
  jsonResponse,
  normalizeTimerInput,
  subscriptionId,
  timerStorageKey
} from "../lib/push-utils.js";

async function readPayload(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

async function cancelAllTimers(subscriptionHash) {
  const timers = getTimersStore();
  const { blobs } = await timers.list({ prefix: `timer-${subscriptionHash}-` });
  await Promise.all((blobs || []).map(blob => timers.delete(blob.key)));
  return blobs?.length || 0;
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let payload;
  try {
    payload = await readPayload(request);
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  const action = String(payload?.action || "schedule");
  const subscription = payload?.subscription;
  if (!isValidSubscription(subscription)) {
    return jsonResponse({ error: "Invalid push subscription." }, 400);
  }

  const subscriptionHash = subscriptionId(subscription);
  const subscriptions = getSubscriptionsStore();
  const savedSubscription = await subscriptions.get(subscriptionHash, {
    consistency: "strong",
    type: "json"
  });

  if (!savedSubscription) {
    return jsonResponse({ error: "Push subscription is not registered." }, 409);
  }

  const timers = getTimersStore();

  if (action === "cancelAll") {
    const canceled = await cancelAllTimers(subscriptionHash);
    return jsonResponse({ ok: true, canceled });
  }

  const timerId = String(payload?.timerId || "").trim();
  if (!timerId) {
    return jsonResponse({ error: "timerId is required." }, 400);
  }
  const key = timerStorageKey(subscriptionHash, timerId);

  if (action === "cancel") {
    await timers.delete(key);
    return jsonResponse({ ok: true, timerId });
  }

  if (action !== "schedule") {
    return jsonResponse({ error: "Unsupported action." }, 400);
  }

  let timer;
  try {
    timer = normalizeTimerInput(payload);
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  await timers.setJSON(key, {
    ...timer,
    subscriptionId: subscriptionHash,
    subscription: savedSubscription.subscription,
    notificationSent: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attempts: 0
  });

  return jsonResponse({ ok: true, timerId: timer.timerId, endTime: timer.endTime });
}
