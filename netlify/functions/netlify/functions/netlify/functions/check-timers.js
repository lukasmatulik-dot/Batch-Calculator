import webpush from "web-push";
import {
  getSubscriptionsStore,
  getTimersStore
} from "../lib/push-utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PROCESSING_LOCK_MS = 2 * 60 * 1000;

function configureWebPush() {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!subject || !publicKey || !privateKey) {
    throw new Error("Missing VAPID_SUBJECT, VAPID_PUBLIC_KEY, or VAPID_PRIVATE_KEY.");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

async function processTimer(timers, subscriptions, blob, now) {
  const entry = await timers.getWithMetadata(blob.key, {
    consistency: "strong",
    type: "json"
  });

  if (!entry) return { skipped: 1 };
  const timer = entry.data;

  if (timer.notificationSent) {
    if (now - Number(timer.endTime || 0) > DAY_MS) await timers.delete(blob.key);
    return { skipped: 1 };
  }

  if (!Number.isFinite(Number(timer.endTime)) || Number(timer.endTime) > now) {
    return { skipped: 1 };
  }

  if (Number(timer.processingAt) > 0 && now - Number(timer.processingAt) < PROCESSING_LOCK_MS) {
    return { skipped: 1 };
  }

  const lockedTimer = {
    ...timer,
    processingAt: now,
    updatedAt: now
  };
  const lock = await timers.setJSON(blob.key, lockedTimer, {
    onlyIfMatch: entry.etag
  });
  if (!lock.modified) return { skipped: 1 };

  try {
    await webpush.sendNotification(
      lockedTimer.subscription,
      JSON.stringify({
        title: "Sous Vide Timer Done",
        body: `${lockedTimer.ingredientName} is ready.`,
        ingredientName: lockedTimer.ingredientName,
        timerId: lockedTimer.timerId,
        url: "./"
      }),
      {
        TTL: 60 * 60,
        urgency: "high"
      }
    );

    await timers.setJSON(blob.key, {
      ...lockedTimer,
      notificationSent: true,
      notificationSentAt: now,
      processingAt: 0,
      updatedAt: now,
      lastError: ""
    }, lock.etag ? { onlyIfMatch: lock.etag } : undefined);
    return { sent: 1 };
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode === 404 || statusCode === 410) {
      await timers.delete(blob.key);
      if (lockedTimer.subscriptionId) await subscriptions.delete(lockedTimer.subscriptionId);
      return { expired: 1 };
    }

    await timers.setJSON(blob.key, {
      ...lockedTimer,
      attempts: Number(lockedTimer.attempts || 0) + 1,
      processingAt: 0,
      updatedAt: now,
      lastError: String(error?.message || "Push delivery failed.").slice(0, 300)
    }, lock.etag ? { onlyIfMatch: lock.etag } : undefined);
    return { failed: 1 };
  }
}

export default async function handler() {
  configureWebPush();

  const timers = getTimersStore();
  const subscriptions = getSubscriptionsStore();
  const { blobs } = await timers.list();
  const now = Date.now();
  const totals = { checked: blobs?.length || 0, sent: 0, failed: 0, expired: 0, skipped: 0 };

  for (const blob of blobs || []) {
    const result = await processTimer(timers, subscriptions, blob, now);
    for (const [key, value] of Object.entries(result)) totals[key] += value;
  }

  return new Response(JSON.stringify(totals), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export const config = {
  schedule: "* * * * *"
};
