export interface TankShape {
  capacity_l: number;
  height_mm: number | null;
}

export interface RawReading {
  volume_l?: number | null;
  level_mm?: number | null;
  level_pct?: number | null;
  // Ultrasonic/radar sensors mounted on the lid report the gap down to the water.
  distance_mm?: number | null;
}

/**
 * Converts whatever the sensor sends into litres. Sensors report volume
 * directly, a water depth in mm, the gap from the lid down to the water, or a
 * percentage full. Depth assumes a
 * vertical tank with straight sides, which is how bulk water tanks are built.
 */
export function readingToLitres(tank: TankShape, r: RawReading): number | null {
  if (r.volume_l !== undefined && r.volume_l !== null) return clamp(r.volume_l, tank.capacity_l);
  if (r.level_mm !== undefined && r.level_mm !== null && tank.height_mm) {
    return clamp((r.level_mm / tank.height_mm) * tank.capacity_l, tank.capacity_l);
  }
  if (r.distance_mm !== undefined && r.distance_mm !== null && tank.height_mm) {
    return clamp(((tank.height_mm - r.distance_mm) / tank.height_mm) * tank.capacity_l, tank.capacity_l);
  }
  if (r.level_pct !== undefined && r.level_pct !== null) {
    return clamp((r.level_pct / 100) * tank.capacity_l, tank.capacity_l);
  }
  return null;
}

function clamp(v: number, max: number): number {
  return Math.round(Math.max(0, Math.min(v, max * 1.05)) * 10) / 10;
}

export interface TimedVolume {
  ts: Date;
  volume_l: number;
}

export interface Drawdown {
  start: Date;
  end: Date;
  litres: number;
}

/**
 * Finds the periods when the tank level fell, which is when trucks were
 * filling. Consecutive falling readings form one drawdown; small wobbles
 * under the noise threshold are ignored, and a rise (the tank being refilled)
 * ends the current drawdown.
 */
export function findDrawdowns(readings: TimedVolume[], noiseL: number): Drawdown[] {
  const out: Drawdown[] = [];
  let start: TimedVolume | null = null;
  let low: TimedVolume | null = null;
  const close = () => {
    if (start && low && start.volume_l - low.volume_l >= noiseL) {
      out.push({ start: start.ts, end: low.ts, litres: round1(start.volume_l - low.volume_l) });
    }
  };
  for (const r of readings) {
    if (!start) {
      start = r;
      low = r;
      continue;
    }
    if (start.volume_l - r.volume_l < noiseL && start.volume_l - low!.volume_l < noiseL) {
      // Still flat (no real drop yet): slide the start forward so the drawdown
      // begins at the last reading before the level falls, not at the start of
      // an overnight plateau. Otherwise it is counted on the wrong day.
      // Keep the plateau's highest level so sensor jitter isn't lost.
      start = { ts: r.ts, volume_l: Math.max(start.volume_l, r.volume_l) };
      low = r;
    } else if (r.volume_l <= low!.volume_l) {
      low = r;
    } else if (r.volume_l - low!.volume_l > noiseL) {
      // Real rise: the drawdown (if any) is over and a new one may start here.
      close();
      start = r;
      low = r;
    }
    // A small rise within noise keeps the current drawdown open.
  }
  close();
  return out;
}

/**
 * Litres taken out of the tank during a fill: the level just before it
 * started minus the level just after it ended. Returns null when the sensor
 * has no reading close enough on either side.
 */
export function litresDrawnBetween(
  readings: TimedVolume[],
  start: Date,
  end: Date,
  maxGapMs = 30 * 60_000,
): number | null {
  let before: TimedVolume | null = null;
  let after: TimedVolume | null = null;
  for (const r of readings) {
    if (r.ts.getTime() <= start.getTime()) before = r;
    if (r.ts.getTime() >= end.getTime() && !after) after = r;
  }
  if (!before || !after) return null;
  if (start.getTime() - before.ts.getTime() > maxGapMs) return null;
  if (after.ts.getTime() - end.getTime() > maxGapMs) return null;
  return round1(Math.max(0, before.volume_l - after.volume_l));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
