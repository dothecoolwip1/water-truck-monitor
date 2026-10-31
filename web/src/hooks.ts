import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { get, getToken } from './api';

/** GET an API path with caching; the path is the cache key. */
export function useApi<T>(path: string | null, opts: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'> = {}) {
  return useQuery<T>({ queryKey: [path], queryFn: () => get<T>(path!), enabled: !!path, ...opts });
}

/** Refetches every cached query whose path starts with one of the prefixes. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...prefixes: string[]) =>
    qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && prefixes.some((p) => (q.queryKey[0] as string).startsWith(p)) });
}

export function notifyError(e: unknown, title = 'Something went wrong') {
  notifications.show({ color: 'red', title, message: (e as Error).message });
}

export function notifyOk(message: string) {
  notifications.show({ color: 'teal', message });
}

export interface LiveMessage {
  type: 'job' | 'position' | 'shift' | 'tank' | 'comment' | 'notification';
  [k: string]: unknown;
}

/**
 * Subscribes to live events and reconnects on its own. The server says how:
 * Ably when it runs on serverless hosting (events cross instances), its own stream on a single server,
 * or nothing, in which case screens fall back to polling.
 */
export function useLive(onEvent: (e: LiveMessage) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!getToken()) return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const retry = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void connect(), ms);
    };

    async function connect() {
      es?.close();
      if (stopped) return;
      let cfg: { mode: 'ably' | 'sse' | 'poll'; channel?: string; token?: string; expires?: number };
      try {
        cfg = await get('/live/config');
      } catch {
        setConnected(false);
        return retry(15_000);
      }
      if (stopped || cfg.mode === 'poll') return setConnected(false);
      const relay = (ev: MessageEvent) => {
        try { handler.current(JSON.parse(ev.data)); } catch { /* not an event */ }
      };
      if (cfg.mode === 'ably') {
        es = new EventSource(`https://realtime.ably.io/event-stream?v=1.2&enveloped=false&channels=${cfg.channel}&accessToken=${encodeURIComponent(cfg.token!)}`);
        es.onmessage = relay;
        // Tokens last an hour; reconnect with a fresh one a minute early.
        retry(Math.max(60_000, (cfg.expires ?? Date.now() + 3_600_000) - Date.now() - 60_000));
      } else {
        es = new EventSource(`/api/live/stream?token=${encodeURIComponent(getToken() ?? '')}`);
        for (const t of ['job', 'position', 'shift', 'tank', 'comment', 'notification']) es.addEventListener(t, relay as EventListener);
      }
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        // Ably drops a stream whose token expired; fetch a new one rather than retrying the old URL.
        if (cfg.mode === 'ably') { es?.close(); retry(5_000); }
      };
    }

    void connect();
    return () => { stopped = true; clearTimeout(timer); es?.close(); };
  }, []);

  return connected;
}
