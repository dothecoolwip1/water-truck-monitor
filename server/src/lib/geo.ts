const EARTH_RADIUS_M = 6_371_000;

export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function insideGeofence(
  point: { lat: number; lng: number; accuracy_m?: number | null },
  fence: { lat: number; lng: number; radius_m: number },
): boolean {
  // Allow for GPS error, but cap it so one wild fix cannot trigger an arrival.
  const slack = Math.min(point.accuracy_m ?? 0, 50);
  return distanceM(point.lat, point.lng, fence.lat, fence.lng) <= fence.radius_m + slack;
}
