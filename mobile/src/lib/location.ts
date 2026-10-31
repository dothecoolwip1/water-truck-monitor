import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { hasToken, loadToken } from './api';
import { loadServer } from './config';
import { addGpsPoints, enqueue, flush } from './queue';
import type { Job } from './types';

/**
 * Background tasks must be defined when the JS bundle loads, before any
 * screen renders, so the OS can wake the app for them. This file is imported
 * from the root layout for that reason.
 */
export const LOCATION_TASK = 'wt-location';
export const GEOFENCE_TASK = 'wt-geofence';

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  await addGpsPoints(
    data.locations.map((l) => ({
      ts: new Date(l.timestamp).toISOString(),
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      accuracy_m: l.coords.accuracy,
      speed_mps: l.coords.speed,
      heading: l.coords.heading,
    })),
  );
  // Send roughly once a minute while driving; the queue coalesces calls.
  if (Date.now() - lastBackgroundFlush > 60_000) {
    lastBackgroundFlush = Date.now();
    await ensureSession();
    void flush();
  }
});
let lastBackgroundFlush = 0;

// When Android wakes the app only for a background task, nothing has loaded the session yet.
async function ensureSession() {
  if (hasToken()) return;
  await loadServer();
  await loadToken();
}

TaskManager.defineTask<{ eventType: Location.LocationGeofencingEventType; region: Location.LocationRegion }>(
  GEOFENCE_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    const id = data.region.identifier ?? '';
    if (data.eventType !== Location.LocationGeofencingEventType.Enter || !id.startsWith('job:')) return;
    await ensureSession();
    await enqueue({ type: 'job_arrive', at: new Date().toISOString(), job_id: id.slice(4), source: 'geofence' });
  },
);

export type PermissionState = 'always' | 'foreground' | 'denied';

/** Asks for location in the order both stores require: while-using first, then always. */
export async function requestLocation(): Promise<PermissionState> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted' ? 'always' : 'foreground';
}

export async function locationPermission(): Promise<PermissionState> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.status === 'granted' ? 'always' : 'foreground';
}

export async function startTracking(): Promise<void> {
  if ((await locationPermission()) === 'denied') return;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 15_000,
    distanceInterval: 25,
    deferredUpdatesInterval: 30_000,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'On duty',
      notificationBody: 'Recording the truck route for deliveries.',
      notificationColor: '#1769AA',
    },
  });
}

export async function stopTracking(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false)) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
}

/**
 * Watches the delivery points of jobs under way, so arrival is logged even
 * with the phone in a pocket. iOS allows 20 regions, so only started jobs are
 * watched.
 */
export async function updateGeofences(jobs: Job[]): Promise<void> {
  if ((await locationPermission()) !== 'always') return;
  const regions = jobs
    .filter((j) => j.status === 'en_route' && j.site_lat !== null && j.site_lng !== null)
    .slice(0, Platform.OS === 'ios' ? 20 : 100)
    .map((j) => ({
      identifier: `job:${j.id}`,
      latitude: j.site_lat!,
      longitude: j.site_lng!,
      radius: Math.max(j.site_geofence_m, 50),
      notifyOnEnter: true,
      notifyOnExit: false,
    }));
  const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
  if (regions.length === 0) {
    if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK);
    return;
  }
  await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
}

export async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 });
    const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}
