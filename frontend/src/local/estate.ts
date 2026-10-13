/**
 * Estate comparisons and multi-meter sites.
 *
 * Sites are only compared like with like: the same building type, over a
 * matched date range they all cover, per square metre where a floor area
 * has been entered. Raw consumption alone says nothing about which site is
 * better run, so there is no "best" or "worst" label.
 *
 * Meters sharing a physical site are combined only where the hierarchy has
 * been confirmed (main, submeter or separate supply) and only over days
 * where every combined meter has complete readings. A submeter is never
 * added to its main meter.
 */
import { dayKwh, isCompleteDay, type Frame } from './frame';
import { planDays } from './calendar';
import { INTERVAL_HOURS, isValid, SLOTS } from './frame';
import type { SiteSettings, SiteType } from './site';
import type { SiteMetrics } from './findings';

export interface EstateSite { id: string; settings: SiteSettings; frame: Frame; metrics: SiteMetrics }

export interface TypeComparison {
  type: SiteType;
  from: string | null;
  to: string | null;
  days: number;
  note: string;
  rows: {
    id: string; name: string; floorAreaM2: number | null; matchedKwh: number | null; completeDays: number;
    kwhPerM2: number | null; kwhPerOpenHour: number | null; closedShare: number | null; annualKwhPerM2: number | null;
  }[];
}

/** Like-for-like comparison of sites of one building type over the dates they all cover. */
export function compareType(sites: EstateSite[], type: SiteType): TypeComparison {
  const list = sites.filter((s) => s.settings.type === type && s.settings.role !== 'sub' && s.frame.dates.length);
  const from = list.length ? list.map((s) => s.frame.dates[0]).sort().reverse()[0] : null;
  const to = list.length ? list.map((s) => s.frame.dates[s.frame.dates.length - 1]).sort()[0] : null;
  const days = from && to && from <= to ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 : 0;
  const ok = days >= 90;
  const rows = list.map((s) => {
    const f = s.frame;
    const plans = planDays(s.settings.calendar, f.dates);
    let kwh = 0; let complete = 0; let open = 0; let closed = 0;
    if (ok) {
      f.dates.forEach((d, i) => {
        if (d < from! || d > to!) return;
        if (isCompleteDay(f, i)) complete++;
        kwh += dayKwh(f, i);
        for (let k = 0; k < SLOTS; k++) {
          if (!isValid(f, i, k)) continue;
          if (plans[i].open[k]) open += INTERVAL_HOURS; else closed += f.rows[i][k];
        }
      });
    }
    const area = s.settings.floorAreaM2;
    return {
      id: s.id, name: s.settings.name, floorAreaM2: area,
      matchedKwh: ok ? kwh : null, completeDays: complete,
      kwhPerM2: ok && area ? kwh / area : null,
      kwhPerOpenHour: ok && open ? kwh / open : null,
      closedShare: ok && kwh ? closed / kwh : null,
      annualKwhPerM2: s.metrics.intensity?.kwhPerM2Annual ?? null,
    };
  });
  return {
    type, from, to, days,
    note: !list.length ? '' : list.length < 2 ? 'Only one site of this type: nothing to compare with.'
      : !ok ? `The sites share only ${Math.max(0, days)} days of data, too few (under 90) for a like-for-like comparison.`
        : `Compared over ${days} days that every site covers (${from} to ${to}). Check each site's complete days: a gap makes its figure low.`,
    rows,
  };
}

export interface MeterGroup {
  name: string;
  members: { id: string; name: string; meterId: string; role: SiteSettings['role']; from: string; to: string }[];
  combinedFrom: string | null;
  combinedTo: string | null;
  combinedDays: number;
  combinedKwh: number;
  warnings: string[];
}

/** Meters grouped by physical site, combined over the days every main or separate meter has complete readings. */
export function meterGroups(sites: EstateSite[]): MeterGroup[] {
  const byName = new Map<string, EstateSite[]>();
  for (const s of sites) {
    const g = s.settings.group.trim();
    if (!g) continue;
    byName.set(g, [...(byName.get(g) ?? []), s]);
  }
  return [...byName.entries()].map(([name, list]) => {
    const warnings: string[] = [];
    const add = list.filter((s) => s.settings.role !== 'sub');
    const subs = list.filter((s) => s.settings.role === 'sub');
    const mains = list.filter((s) => s.settings.role === 'main');
    if (mains.length > 1) warnings.push(`${mains.length} meters are marked as the main meter. If one feeds the other, mark it as a submeter; if they are separate supplies, mark them so.`);
    if (subs.length && !mains.length) warnings.push('Submeters with no main meter in this site: they are left out of totals.');
    if (subs.length) warnings.push(`${subs.length} submeter${subs.length > 1 ? 's are' : ' is'} not added to the site total (already inside the main meter).`);
    const ids = list.map((s) => s.settings.meterId).filter(Boolean);
    if (new Set(ids).size < ids.length) warnings.push('Two meters share a meter reference. Check they are not the same meter loaded twice.');
    // Days where every combined meter has complete readings.
    const sets = add.map((s) => new Map(s.frame.dates.flatMap((d, i) => (isCompleteDay(s.frame, i) ? [[d, dayKwh(s.frame, i)] as const] : []))));
    let combinedKwh = 0;
    const common: string[] = [];
    if (sets.length) {
      for (const [d] of sets[0]) {
        if (sets.every((m) => m.has(d))) { common.push(d); combinedKwh += sets.reduce((a, m) => a + m.get(d)!, 0); }
      }
    }
    common.sort();
    const periods = add.map((s) => `${s.frame.dates[0]}..${s.frame.dates[s.frame.dates.length - 1]}`);
    if (new Set(periods).size > 1) warnings.push('The combined meters cover different periods; the site total uses only days complete on all of them.');
    return {
      name,
      members: list.map((s) => ({ id: s.id, name: s.settings.name, meterId: s.settings.meterId, role: s.settings.role,
        from: s.frame.dates[0], to: s.frame.dates[s.frame.dates.length - 1] })),
      combinedFrom: common[0] ?? null,
      combinedTo: common[common.length - 1] ?? null,
      combinedDays: common.length,
      combinedKwh,
      warnings,
    };
  });
}

/** Portfolio-level warnings about meters that may double count. */
export function overlapWarnings(sites: EstateSite[]): string[] {
  const out: string[] = [];
  const byMeter = new Map<string, EstateSite[]>();
  for (const s of sites) if (s.settings.meterId) byMeter.set(s.settings.meterId, [...(byMeter.get(s.settings.meterId) ?? []), s]);
  for (const [id, list] of byMeter) {
    if (list.length > 1) out.push(`Meter ${id} appears in ${list.length} files (${list.map((s) => s.settings.name).join(', ')}). Totals count each; remove duplicates or mark submeters.`);
  }
  const subs = sites.filter((s) => s.settings.role === 'sub');
  if (subs.length) out.push(`${subs.length} submeter${subs.length > 1 ? 's are' : ' is'} left out of portfolio totals.`);
  return out;
}
