/**
 * Where the 1 kWp generation profile comes from in the standalone build.
 *
 * First choice is PVGIS, exactly as the server used it. PVGIS may refuse a
 * call made straight from a browser (it is built for servers), and a laptop
 * may be offline, so there is a built-in fallback: a solar-geometry model
 * calibrated to typical UK irradiance. Anything produced from the fallback
 * is labelled as an estimate on screen and in the PDF.
 */
import { addDays, iso, parts } from './dates';
import type { GenProfile } from './sizing';

export const DEFAULT_SYSTEM_LOSS = 14;
export const PVGIS_WEATHER_YEAR = 2020;
const PVGIS_URL = 'https://re.jrc.ec.europa.eu/api/v5_2/seriescalc';

export type IrradianceSource = 'pvgis' | 'estimate';

export interface Generation {
  profile: GenProfile;
  source: IrradianceSource;
  /** Plain-English description for the results panel and the report. */
  label: string;
  /** Why the estimate was used, when it was. */
  fallbackReason?: string;
}

// --- Location -------------------------------------------------------------

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Postcode to latitude and longitude. Also accepts "51.5, -0.12" typed into
 * the postcode box, so the tool still works with no internet at all.
 */
export async function locate(postcode: string): Promise<{ lat: number; lon: number }> {
  const coords = postcode.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (coords) {
    const lat = Number(coords[1]);
    const lon = Number(coords[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  }

  const clean = postcode.trim().toUpperCase().replace(/\s+/g, '');
  try {
    const data = await getJson(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`, 10_000) as
      { result?: { latitude: number; longitude: number } };
    if (data.result) return { lat: data.result.latitude, lon: data.result.longitude };
  } catch {
    // Fall through to the second lookup.
  }
  try {
    const data = await getJson(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(`${clean}, UK`)}`,
      10_000,
    ) as { lat: string; lon: string }[];
    if (data.length) return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
  } catch {
    // Fall through to the error.
  }
  throw new Error(
    `Could not resolve postcode: ${postcode}. If this computer is offline, type the site's `
    + 'latitude and longitude into the postcode box instead, e.g. 51.50, -0.12',
  );
}

// --- PVGIS ----------------------------------------------------------------

const MIN_PLAUSIBLE_YIELD = 50;
const MAX_PLAUSIBLE_YIELD = 3000;

function totalYield(p: GenProfile) {
  return p.rows.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0);
}

function plausible(p: GenProfile): boolean {
  if (!p.rows.length || p.rows.some((r) => r.some((v) => Number.isNaN(v)))) return false;
  const t = totalYield(p);
  return t >= MIN_PLAUSIBLE_YIELD && t <= MAX_PLAUSIBLE_YIELD;
}

/** Hourly W for 1 kWp to a (365 x 48) table of kWh per half hour. */
function hourlyToProfile(hourly: { time: string; P?: number }[]): GenProfile {
  const byDay = new Map<string, number[]>();
  for (const e of hourly) {
    // Never default a missing power to zero: that turns a bad request into a
    // plausible-looking profile of all zeros.
    if (typeof e.P !== 'number') {
      throw new Error('PVGIS response has no PV power field.');
    }
    const t = e.time; // "20200101:0010"
    const day = iso(Number(t.slice(0, 4)), Number(t.slice(4, 6)), Number(t.slice(6, 8)));
    const hour = Number(t.slice(9, 11));
    if (!byDay.has(day)) byDay.set(day, new Array(48).fill(0));
    const kwhPerSlot = Math.max(0, e.P / 1000 / 2);
    const row = byDay.get(day)!;
    row[hour * 2] = kwhPerSlot;
    row[hour * 2 + 1] = kwhPerSlot;
  }
  const dates = [...byDay.keys()].sort().slice(0, 365); // 2020 is a leap year
  return { dates, rows: dates.map((d) => byDay.get(d)!) };
}

async function fetchPvgis(
  lat: number, lon: number, tilt: number, aspect: number, db: string,
): Promise<GenProfile> {
  const params = new URLSearchParams({
    lat: lat.toFixed(4), lon: lon.toFixed(4), raddatabase: db, browser: '0',
    outputformat: 'json', usehorizon: '1', pvcalculation: '1', peakpower: '1',
    pvtechnology: 'crystSi', mountingplace: 'building', loss: String(DEFAULT_SYSTEM_LOSS),
    angle: String(tilt), aspect: String(aspect),
    startyear: String(PVGIS_WEATHER_YEAR), endyear: String(PVGIS_WEATHER_YEAR), components: '0',
  });
  const data = await getJson(`${PVGIS_URL}?${params}`, 60_000) as
    { outputs?: { hourly?: { time: string; P?: number }[] } };
  const hourly = data.outputs?.hourly;
  if (!hourly?.length) throw new Error('PVGIS returned no hourly rows.');
  return hourlyToProfile(hourly);
}

const cacheKey = (lat: number, lon: number, tilt: number, aspect: number) =>
  `sdp-pvgis:${lat.toFixed(3)}_${lon.toFixed(3)}_${tilt}_${aspect}_${DEFAULT_SYSTEM_LOSS}`;

function readCache(key: string): GenProfile | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as GenProfile;
    return plausible(p) ? p : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, p: GenProfile) {
  try {
    const compact = { dates: p.dates, rows: p.rows.map((r) => r.map((v) => Math.round(v * 1e5) / 1e5)) };
    localStorage.setItem(key, JSON.stringify(compact));
  } catch {
    // Storage full or disabled: the next run just fetches again.
  }
}

// --- Built-in estimate ----------------------------------------------------

/**
 * Monthly clearness index (share of the sun's energy above the atmosphere
 * that reaches the ground), calibrated so London lands on typical PVGIS
 * horizontal irradiation. Latitude is then handled by the geometry.
 */
const MONTHLY_KT = [0.37, 0.39, 0.41, 0.43, 0.45, 0.44, 0.45, 0.45, 0.42, 0.40, 0.36, 0.34];

/** Performance ratio standing in for PVGIS' 14% system loss plus heat. */
const PERFORMANCE_RATIO = 0.87;
const ALBEDO = 0.2;
const RAD = Math.PI / 180;

/** Small seeded generator, so the same site gives the same answer every run. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function erbsDiffuseFraction(kt: number): number {
  if (kt <= 0.22) return 1 - 0.09 * kt;
  if (kt <= 0.8) return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4;
  return 0.165;
}

/**
 * A typical year of half-hourly output for 1 kWp.
 *
 * Sun position every half hour, a daily clearness that varies from day to
 * day around the monthly norm (so there are dull days and bright ones, as
 * in real weather), split into direct and diffuse light and tilted onto
 * the roof. Accurate to roughly ten per cent on annual yield against PVGIS
 * for UK sites; it cannot know about local shading or horizon.
 */
export function estimateProfile(lat: number, lon: number, tilt: number, aspect: number): GenProfile {
  const phi = lat * RAD;
  const beta = tilt * RAD;
  const gamma = aspect * RAD;
  const rand = mulberry32(2020);
  const normal = () => {
    const u = Math.max(rand(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };

  const dates: string[] = [];
  const daily: { kt: number; month: number; ext: number[] }[] = [];
  for (let n = 1; n <= 365; n++) {
    const date = addDays('2020-01-01', n - 1);
    const month = parts(date).m;
    const decl = 23.45 * RAD * Math.sin(2 * Math.PI * (284 + n) / 365);
    const b = 2 * Math.PI * (n - 81) / 364;
    const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b); // minutes
    const i0 = 1367 * (1 + 0.033 * Math.cos(2 * Math.PI * n / 365));

    // Extraterrestrial irradiance on the horizontal and on the roof, per slot.
    const ext: number[] = [];
    for (let s = 0; s < 48; s++) {
      const clock = s * 0.5 + 0.25; // middle of the half hour, GMT
      const solar = clock + (4 * lon + eot) / 60;
      const omega = 15 * (solar - 12) * RAD;
      const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(omega);
      ext.push(cosZ > 0 ? i0 * cosZ : 0);
    }
    dates.push(date);
    // Day-to-day weather: lognormal spread around the monthly norm.
    const kt = Math.min(0.75, Math.max(0.05, MONTHLY_KT[month - 1] * Math.exp(0.42 * normal() - 0.088)));
    daily.push({ kt, month, ext });
  }

  // Rescale each month so its mean clearness is exactly the calibrated one.
  for (let m = 1; m <= 12; m++) {
    const days = daily.filter((d) => d.month === m);
    const extTotal = days.reduce((s, d) => s + d.ext.reduce((a, v) => a + v, 0), 0);
    const got = days.reduce((s, d) => s + d.kt * d.ext.reduce((a, v) => a + v, 0), 0);
    const factor = got > 0 ? (MONTHLY_KT[m - 1] * extTotal) / got : 1;
    for (const d of days) d.kt = Math.min(0.8, d.kt * factor);
  }

  const rows = daily.map(({ kt, ext }, idx) => {
    const n = idx + 1;
    const decl = 23.45 * RAD * Math.sin(2 * Math.PI * (284 + n) / 365);
    const b = 2 * Math.PI * (n - 81) / 364;
    const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
    const fd = erbsDiffuseFraction(kt);
    return ext.map((e, s) => {
      if (e <= 0) return 0;
      const solar = s * 0.5 + 0.25 + (4 * lon + eot) / 60;
      const omega = 15 * (solar - 12) * RAD;
      const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(omega);
      const sinZ = Math.sqrt(Math.max(0, 1 - cosZ * cosZ));
      const ghi = kt * e;
      const dhi = ghi * fd;
      const bhi = ghi - dhi;
      // Solar azimuth from south, west positive.
      const cosAz = sinZ > 1e-6 ? (cosZ * Math.sin(phi) - Math.sin(decl)) / (sinZ * Math.cos(phi)) : 1;
      const az = Math.sign(omega) * Math.acos(Math.max(-1, Math.min(1, cosAz)));
      const cosTheta = cosZ * Math.cos(beta) + sinZ * Math.sin(beta) * Math.cos(az - gamma);
      const beam = cosZ > 0.05 ? bhi * Math.max(0, cosTheta) / cosZ : 0;
      const diffuse = dhi * (1 + Math.cos(beta)) / 2;
      const ground = ghi * ALBEDO * (1 - Math.cos(beta)) / 2;
      const poa = beam + diffuse + ground; // W/m2 on the roof
      return (poa / 1000) * PERFORMANCE_RATIO * 0.5; // kWh in the half hour, 1 kWp
    });
  });

  return { dates, rows };
}

// --- Entry point ----------------------------------------------------------

export async function getGeneration(
  lat: number, lon: number, tilt: number, aspect: number,
): Promise<Generation> {
  const pvgisLabel = `PVGIS, ${PVGIS_WEATHER_YEAR} weather year, ${DEFAULT_SYSTEM_LOSS}% system loss`;
  const key = cacheKey(lat, lon, tilt, aspect);
  const cached = readCache(key);
  if (cached) return { profile: cached, source: 'pvgis', label: pvgisLabel };

  const failures: string[] = [];
  for (const db of ['PVGIS-SARAH2', 'ERA5']) {
    try {
      const p = await fetchPvgis(lat, lon, tilt, aspect, db);
      if (!plausible(p)) {
        failures.push(`${db}: implausible yield ${Math.round(totalYield(p))} kWh/kWp`);
        continue;
      }
      writeCache(key, p);
      return { profile: p, source: 'pvgis', label: pvgisLabel };
    } catch (e) {
      failures.push(`${db}: ${(e as Error).message || 'blocked'}`);
      // A refused browser call fails the same way for both databases, so
      // there is no point waiting on the second.
      if (e instanceof TypeError) break;
    }
  }

  return {
    profile: estimateProfile(lat, lon, tilt, aspect),
    source: 'estimate',
    label: 'Built-in typical-year estimate (PVGIS unreachable), '
      + `${DEFAULT_SYSTEM_LOSS}% system loss equivalent`,
    fallbackReason: failures.join(' | '),
  };
}
