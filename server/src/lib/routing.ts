import { distanceM } from './geo.js';

export interface Stop { id: string; lat: number; lng: number; urgent?: boolean }
interface Pt { lat: number; lng: number }

// Straight-line distance stretched a little for roads; good enough to order stops in a small town.
const ROAD = 1.3;
const d = (a: Pt, b: Pt) => distanceM(a.lat, a.lng, b.lat, b.lng) * ROAD;

export function routeLength(start: Pt | null, stops: Pt[], back = true): number {
  let total = 0;
  let prev = start;
  for (const s of stops) {
    if (prev) total += d(prev, s);
    prev = s;
  }
  if (back && start && stops.length) total += d(stops[stops.length - 1], start);
  return total;
}

function runLength(start: Pt | null, stops: Pt[], end: Pt | null): number {
  return routeLength(start, stops, false) + (end && stops.length ? d(stops[stops.length - 1], end) : 0);
}

/** Nearest neighbour from start, then 2-opt until no swap shortens the run (ending at end, if given). */
function orderGroup(start: Pt | null, stops: Stop[], end: Pt | null): Stop[] {
  if (stops.length < 2) return [...stops];
  const left = [...stops];
  const route: Stop[] = [];
  let at: Pt = start ?? left[0];
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (d(at, left[i]) < d(at, left[best])) best = i;
    at = left.splice(best, 1)[0];
    route.push(at as Stop);
  }
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++) {
      for (let k = i + 1; k < route.length; k++) {
        const candidate = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)];
        if (runLength(start, candidate, end) + 0.5 < runLength(start, route, end)) {
          route.splice(0, route.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return route;
}

/**
 * Best stop order for one truck's day: people out of water first (in the shortest order among
 * themselves), then everyone else, starting and ending at the depot.
 */
export function optimizeStops(start: Pt | null, stops: Stop[]): Stop[] {
  const urgent = orderGroup(start, stops.filter((s) => s.urgent), null);
  const from = urgent.length ? urgent[urgent.length - 1] : start;
  return [...urgent, ...orderGroup(from, stops.filter((s) => !s.urgent), start)];
}
