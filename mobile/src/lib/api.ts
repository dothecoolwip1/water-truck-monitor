import * as SecureStore from 'expo-secure-store';
import { server } from './config';

const TOKEN_KEY = 'wt.token';
let token: string | null = null;

export async function loadToken(): Promise<string | null> {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token;
}

export async function saveToken(t: string | null): Promise<void> {
  token = t;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export function hasToken(): boolean {
  return !!token;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the server. A network failure throws ApiError with status 0, meaning "offline, try later". */
export async function api<T>(method: string, path: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${server()}/api${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, 'No connection to the server');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (e.g. a captive portal page); treat as offline.
    throw new ApiError(0, 'Unexpected response from the server');
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Server error ${res.status}`);
  return data as T;
}
