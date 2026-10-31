import { useCallback, useEffect, useRef, useState } from 'react';
import { get, getToken } from './api';

/** Loads data from the API and reloads on demand or when deps change. */
export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await get<T>(path);
      if (mine === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

export interface LiveMessage {
  type: 'job' | 'position' | 'shift' | 'tank';
  [k: string]: unknown;
}

/** Subscribes to the server's live event stream; reconnects on its own. */
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

/** Collapses bursts of calls (e.g. many live events) into one call. */
export function useDebounced(fn: () => void, ms: number) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const f = useRef(fn);
  f.current = fn;
  return useCallback(() => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => f.current(), ms);
  }, [ms]);
}
