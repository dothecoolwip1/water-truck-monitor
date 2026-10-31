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
  type: 'job' | 'position' | 'shift' | 'tank';
  [k: string]: unknown;
}

/** Subscribes to the server's live event stream; reconnects on its own. Hosts without streaming fall back to polling. */
export function useLive(onEvent: (e: LiveMessage) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const es = new EventSource(`/api/live/stream?token=${encodeURIComponent(token)}`);
    const relay = (ev: MessageEvent) => handler.current(JSON.parse(ev.data));
    for (const t of ['job', 'position', 'shift', 'tank']) es.addEventListener(t, relay as EventListener);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  return connected;
}
