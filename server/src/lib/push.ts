import { config } from '../config.js';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export type PushSender = (messages: PushMessage[]) => Promise<void>;

/** Sends through Expo's push service, which delivers to both APNs and FCM. */
export const expoPush: PushSender = async (messages) => {
  const valid = messages.filter((m) => /^Expo(nent)?PushToken\[.+\]$/.test(m.to));
  if (!config.pushEnabled || valid.length === 0) return;
  try {
    const res = await fetch(config.expoPushUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(valid.map((m) => ({ ...m, sound: 'default', priority: 'high', channelId: 'jobs' }))),
    });
    if (!res.ok) console.warn(`push failed: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.warn('push failed:', (err as Error).message);
  }
};
