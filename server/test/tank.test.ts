import { describe, expect, it } from 'vitest';
import { findDrawdowns, litresDrawnBetween, readingToLitres } from '../src/lib/tank.js';

const tank = { capacity_l: 100_000, height_mm: 5000 };
const t = (min: number) => new Date(Date.UTC(2026, 9, 1, 12, min));

describe('readingToLitres', () => {
  it('prefers volume, then depth, then lid gap, then percent', () => {
    expect(readingToLitres(tank, { volume_l: 1234.56 })).toBe(1234.6);
    expect(readingToLitres(tank, { level_mm: 2500 })).toBe(50_000);
    expect(readingToLitres(tank, { distance_mm: 1000 })).toBe(80_000);
    expect(readingToLitres(tank, { level_pct: 25 })).toBe(25_000);
    expect(readingToLitres({ capacity_l: 1000, height_mm: null }, { level_mm: 10 })).toBeNull();
    expect(readingToLitres(tank, {})).toBeNull();
  });

  it('clamps nonsense readings', () => {
    expect(readingToLitres(tank, { level_mm: -50 })).toBe(0);
    expect(readingToLitres(tank, { level_pct: 400 })).toBe(105_000);
  });
});

describe('findDrawdowns', () => {
  it('groups a falling run into one fill and ignores noise and refills', () => {
    const series = [
      [0, 90_000], [5, 89_950], [10, 89_980], // noise
      [15, 85_000], [20, 80_000], [25, 76_400], // fill of 13,580 from 89,980
      [30, 76_500], [60, 79_000], // refill
      [65, 75_000], [70, 72_000], // second fill of 7,000
    ].map(([m, v]) => ({ ts: t(m), volume_l: v }));
    const d = findDrawdowns(series, 200);
    expect(d.map((x) => x.litres)).toEqual([13_600, 7000]);
    expect(d[0].end).toEqual(t(25));
  });

  it('starts a fill at the end of a flat stretch, not its beginning', () => {
    const series = [[0, 90_000], [600, 90_010], [1200, 89_990], [1210, 85_000], [1220, 80_000]]
      .map(([m, v]) => ({ ts: t(m), volume_l: v }));
    const [d] = findDrawdowns(series, 200);
    expect(d.start).toEqual(t(1200));
    expect(d.litres).toBe(10_010);
  });

  it('returns nothing for a flat tank', () => {
    expect(findDrawdowns([{ ts: t(0), volume_l: 5 }, { ts: t(1), volume_l: 5 }], 200)).toEqual([]);
  });
});

describe('litresDrawnBetween', () => {
  const series = [[0, 90_000], [10, 90_000], [20, 76_400], [30, 76_400]].map(([m, v]) => ({ ts: t(m), volume_l: v }));
  it('uses the readings either side of the fill', () => {
    expect(litresDrawnBetween(series, t(12), t(18))).toBe(13_600);
  });
  it('gives up when the sensor was silent', () => {
    expect(litresDrawnBetween(series, t(12), t(18), 60_000)).toBeNull();
    expect(litresDrawnBetween(series, t(31), t(40))).toBeNull();
  });
});
