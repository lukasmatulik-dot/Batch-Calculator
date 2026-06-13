import {
  getSubscriptionsStore,
  isValidSubscription,
  jsonResponse,
  subscriptionId
} from "../lib/push-utils.js";

export default async function handler(request) {
  if (request.method === "GET") {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
      return jsonResponse({ error: "Push notifications are not configured." }, 503);
    }
    return jsonResponse({ publicKey });
  }

  if (request.method !== "POST" && request.method !== "DELETE") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const subscription = payload?.subscription;
  if (!isValidSubscription(subscription)) {
    return jsonResponse({ error: "Invalid push subscription." }, 400);
  }

  const id = subscriptionId(subscription);
  const store = getSubscriptionsStore();

  if (request.method === "DELETE") {
    await store.delete(id);
    return jsonResponse({ ok: true, subscriptionId: id });
  }

  await store.setJSON(id, {
    subscription,
    createdAt: Number(payload?.createdAt) || Date.now(),
    updatedAt: Date.now()
  });

  return jsonResponse({ ok: true, subscriptionId: id });
}
