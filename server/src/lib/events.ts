import { EventEmitter } from 'node:events';

export type LiveEvent =
  | { type: 'job'; jobId: string; status: string }
  | { type: 'position'; driverId: string; truckId: string | null; lat: number; lng: number; ts: string }
  | { type: 'shift'; driverId: string; onDuty: boolean }
  | { type: 'tank'; tankId: string; volume_l: number; ts: string }
  | { type: 'comment'; jobId: string }
  | { type: 'notification'; userIds: string[] };

export const LIVE_CHANNEL = 'office';

/**
 * Fan-out of live events to dispatch screens.
 * In one long-running process the in-process emitter is enough (SSE at /live/stream).
 * On serverless hosts each request may run on a different instance, so when ABLY_API_KEY is set
 * every event is also published to Ably, and browsers subscribe there instead.
 */
export class LiveBus extends EventEmitter {
  private inflight = new Set<Promise<unknown>>();

  constructor(private ablyKey: string | undefined = process.env.ABLY_API_KEY || undefined) {
    super();
  }

  get relayed(): boolean {
    return !!this.ablyKey;
  }

  publish(event: LiveEvent): void {
    this.emit('event', event);
    if (!this.ablyKey) return;
    this.track(fetch(`https://rest.ably.io/channels/${LIVE_CHANNEL}/messages`, {
      method: 'POST',
      headers: { authorization: this.auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ name: event.type, data: JSON.stringify(event) }),
      signal: AbortSignal.timeout(4000),
    }));
  }

  private auth(): string {
    return `Basic ${Buffer.from(this.ablyKey ?? '').toString('base64')}`;
  }

  /** Background work (relays, resident alerts) that must finish before the response goes out. */
  track(p: Promise<unknown>): void {
    const q = p.catch(() => undefined).finally(() => this.inflight.delete(q));
    this.inflight.add(q);
  }

  /** Serverless instances freeze after the response; wait for relays first. */
  async drain(): Promise<void> {
    if (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  /** A short-lived, subscribe-only token for one browser. */
  async token(clientId: string): Promise<unknown> {
    if (!this.ablyKey) return null;
    const keyName = this.ablyKey.split(':')[0];
    const res = await fetch(`https://rest.ably.io/keys/${encodeURIComponent(keyName)}/requestToken`, {
      method: 'POST',
      headers: { authorization: this.auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ keyName, clientId, capability: JSON.stringify({ [LIVE_CHANNEL]: ['subscribe'] }), ttl: 60 * 60 * 1000, timestamp: Date.now() }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Ably token request failed (${res.status})`);
    return res.json();
  }
}
