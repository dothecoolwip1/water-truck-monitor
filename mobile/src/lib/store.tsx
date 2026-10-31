import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { api, ApiError, loadToken, saveToken } from './api';
import { loadServer } from './config';
import { startTracking, stopTracking, updateGeofences } from './location';
import { registerForPush } from './notifications';
import * as queue from './queue';
import type { Job, Op, PhotoRef, Problem, Shift, Today, User } from './types';

const USER_KEY = 'wt.user';
const TODAY_KEY = 'wt.today';
const FILL_KEY = 'wt.fill';

export interface CompleteInput {
  litres: number;
  meter_start: number | null;
  meter_end: number | null;
  recipient_name: string | null;
  notes: string | null;
  meter_photo: PhotoRef | null;
  signature: PhotoRef | null;
  lat: number | null;
  lng: number | null;
}

interface Store {
  ready: boolean;
  user: User | null;
  today: Today | null;
  jobs: Job[];
  shift: Shift | null;
  pending: Op[];
  pendingGps: number;
  problems: Problem[];
  online: boolean;
  syncing: boolean;
  lastRefresh: Date | null;
  fillStartedAt: string | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  syncNow(): Promise<void>;
  startShift(truckId: string, startMeter: number | null): Promise<void>;
  endShift(endMeter: number | null): Promise<void>;
  startJob(jobId: string): Promise<void>;
  arrive(jobId: string): Promise<void>;
  complete(jobId: string, input: CompleteInput): Promise<void>;
  beginFill(): Promise<void>;
  finishFill(litres: number | null, tankId: string | null): Promise<void>;
  cancelFill(): Promise<void>;
  clearProblems(): Promise<void>;
}

const Ctx = createContext<Store | null>(null);

/** Applies actions that haven't reached the server yet, so the screen shows what the driver did. */
function overlay(today: Today | null, ops: Op[]): { jobs: Job[]; shift: Shift | null } {
  let shift = today?.shift ?? null;
  const jobs = new Map((today?.jobs ?? []).map((j) => [j.id, { ...j }]));
  for (const op of ops) {
    if (op.type === 'shift_start') {
      const truck = today?.trucks.find((t) => t.id === op.truck_id);
      shift = { id: op.client_id, truck_id: op.truck_id, truck_name: truck?.name ?? 'Truck', started_at: op.at, start_meter: op.start_meter ?? null };
    } else if (op.type === 'shift_end') {
      shift = null;
    } else if (op.type === 'job_start' || op.type === 'job_arrive' || op.type === 'job_complete') {
      const j = jobs.get(op.job_id);
      if (!j || j.status === 'completed' || j.status === 'cancelled') continue;
      if (op.type === 'job_start' && j.status === 'scheduled') Object.assign(j, { status: 'en_route', started_at: op.at });
      if (op.type === 'job_arrive' && (j.status === 'scheduled' || j.status === 'en_route')) Object.assign(j, { status: 'arrived', arrived_at: op.at });
      if (op.type === 'job_complete') Object.assign(j, { status: 'completed', completed_at: op.at, delivered_litres: op.litres });
    }
  }
  const order = (j: Job) => (j.status === 'completed' ? 2 : j.status === 'cancelled' ? 3 : j.status === 'en_route' || j.status === 'arrived' ? 0 : 1);
  return {
    shift,
    jobs: [...jobs.values()].sort((a, b) => order(a) - order(b) || a.sort_order - b.sort_order || a.number - b.number),
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [pending, setPending] = useState<Op[]>([]);
  const [pendingGps, setPendingGps] = useState(0);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [fillStartedAt, setFillStartedAt] = useState<string | null>(null);
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  const readQueue = useCallback(async () => {
    setPending(await queue.pending());
    setPendingGps(await queue.pendingGpsCount());
    setProblems(await queue.problems());
  }, []);

  const logout = useCallback(async () => {
    await stopTracking().catch(() => undefined);
    await api('POST', '/me/push-token', { token: null }).catch(() => undefined);
    await saveToken(null);
    await AsyncStorage.multiRemove([USER_KEY, TODAY_KEY, FILL_KEY]);
    await queue.resetLocal();
    setUser(null);
    setToday(null);
    setFillStartedAt(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!userRef.current) return;
    setSyncing(true);
    try {
      const r = await queue.flush();
      setOnline(!r.offline);
      // Only take the server's view once our own actions are in, or it would undo them on screen.
      const t = await api<Today>('GET', '/driver/today');
      setToday(t);
      setOnline(true);
      setLastRefresh(new Date());
      await AsyncStorage.setItem(TODAY_KEY, JSON.stringify(t));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await logout();
      else setOnline(false);
    } finally {
      await readQueue();
      setSyncing(false);
    }
  }, [logout, readQueue]);

  // Start-up: restore the session and the last copy of today's jobs.
  useEffect(() => {
    (async () => {
      await loadServer();
      const token = await loadToken();
      const [u, t, f] = await AsyncStorage.multiGet([USER_KEY, TODAY_KEY, FILL_KEY]);
      if (token && u[1]) {
        setUser(JSON.parse(u[1]));
        if (t[1]) setToday(JSON.parse(t[1]));
      }
      setFillStartedAt(f[1]);
      await readQueue();
      setReady(true);
    })();
    return queue.subscribe(() => void readQueue());
  }, [readQueue]);

  useEffect(() => {
    if (!user) return;
    void refresh();
    void registerForPush();
    const timer = setInterval(() => void refresh(), 60_000);
    const app = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    const net = NetInfo.addEventListener((s) => {
      if (s.isConnected && s.isInternetReachable !== false) void refresh();
    });
    const push = Notifications.addNotificationReceivedListener(() => void refresh());
    return () => {
      clearInterval(timer);
      app.remove();
      net();
      push.remove();
    };
  }, [user, refresh]);

  const view = useMemo(() => overlay(today, pending), [today, pending]);

  // Track the truck only while on duty; watch delivery points of jobs under way.
  const onDuty = !!view.shift;
  useEffect(() => {
    if (!user) return;
    (onDuty ? startTracking() : stopTracking()).catch(() => undefined);
  }, [user, onDuty]);
  const geofenceKey = view.jobs.filter((j) => j.status === 'en_route').map((j) => j.id).join(',');
  useEffect(() => {
    if (onDuty) updateGeofences(view.jobs).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geofenceKey, onDuty]);

  const act = useCallback(async (op: Parameters<typeof queue.enqueue>[0]) => {
    await queue.enqueue(op);
    await readQueue();
    void refresh();
  }, [readQueue, refresh]);

  const store: Store = {
    ready,
    user,
    today,
    jobs: view.jobs,
    shift: view.shift,
    pending,
    pendingGps,
    problems,
    online,
    syncing,
    lastRefresh,
    fillStartedAt,
    async login(email, password) {
      const res = await api<{ token: string; user: User }>('POST', '/auth/login', { email: email.trim(), password });
      if (res.user.role !== 'driver' && res.user.role !== 'admin') throw new Error('This app is for drivers. Office staff use the web dispatch screen.');
      await saveToken(res.token);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(res.user));
      setUser(res.user);
    },
    logout,
    refresh,
    async syncNow() {
      await refresh();
    },
    startShift: (truckId, startMeter) => act({ type: 'shift_start', at: new Date().toISOString(), truck_id: truckId, start_meter: startMeter }),
    endShift: (endMeter) => act({ type: 'shift_end', at: new Date().toISOString(), end_meter: endMeter }),
    startJob: (jobId) => act({ type: 'job_start', at: new Date().toISOString(), job_id: jobId }),
    arrive: (jobId) => act({ type: 'job_arrive', at: new Date().toISOString(), job_id: jobId, source: 'manual' }),
    complete: (jobId, input) => act({ type: 'job_complete', at: new Date().toISOString(), job_id: jobId, ...input }),
    async beginFill() {
      const at = new Date().toISOString();
      await AsyncStorage.setItem(FILL_KEY, at);
      setFillStartedAt(at);
    },
    async finishFill(litres, tankId) {
      if (!fillStartedAt) return;
      await act({ type: 'fill', started_at: fillStartedAt, ended_at: new Date().toISOString(), tank_id: tankId, litres_reported: litres });
      await AsyncStorage.removeItem(FILL_KEY);
      setFillStartedAt(null);
    },
    async cancelFill() {
      await AsyncStorage.removeItem(FILL_KEY);
      setFillStartedAt(null);
    },
    async clearProblems() {
      await queue.clearProblems();
      await readQueue();
    },
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
