import { useCallback, useEffect, useState } from 'react';
import {
  getAnalyserOverview, getDayProfile, getLoadDuration, getDayNight,
  getWeek, getScatter, friendlyError,
} from '../../api/client';
import type {
  AnalyserOverview, DayProfileResponse, LoadDurationResponse,
  DayNightResponse, WeekResponse, ScatterResponse,
} from '../../types';
import DayProfileChart from './DayProfileChart';
import LoadDurationChart from './LoadDurationChart';
import DayNightChart from './DayNightChart';
import WeekChart from './WeekChart';
import LoadScatterChart from './LoadScatterChart';

interface Props {
  sessionId: string;
}

function SummaryTile({ label, value, hint }: {
  label: string; value: string; hint?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <p className="text-xl font-bold text-slate-800">{value}</p>
      <p className="text-xs font-medium text-slate-600 mt-0.5">{label}</p>
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

export default function HHAnalyser({ sessionId }: Props) {
  const [overview, setOverview] = useState<AnalyserOverview | null>(null);
  const [profile, setProfile] = useState<DayProfileResponse | null>(null);
  const [ldc, setLdc] = useState<LoadDurationResponse | null>(null);
  const [dayNight, setDayNight] = useState<DayNightResponse | null>(null);
  const [weekA, setWeekA] = useState<WeekResponse | null>(null);
  const [weekB, setWeekB] = useState<WeekResponse | null>(null);
  const [scatter, setScatter] = useState<ScatterResponse | null>(null);

  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [excludeHolidays, setExcludeHolidays] = useState(true);
  const [nightEndSlot, setNightEndSlot] = useState(14);
  const [weekAKey, setWeekAKey] = useState<string | undefined>();
  const [weekBKey, setWeekBKey] = useState<string | undefined>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // First load: fetch the overview, then seed the filters and the two week
  // pickers from it so the charts open on something meaningful.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const o = await getAnalyserOverview(sessionId);
        if (cancelled) return;
        setOverview(o);
        setDateFrom(o.date_from ?? '');
        setDateTo(o.date_to ?? '');
        if (o.weeks.length) {
          setWeekAKey(o.weeks[0].value);
          // Default the comparison to roughly six months on, so the first
          // thing anyone sees is summer against winter.
          setWeekBKey(o.weeks[Math.min(o.weeks.length - 1, 26)].value);
        }
      } catch (e) {
        if (!cancelled) {
          setError(friendlyError(e, 'Could not load the analysis.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const reload = useCallback(async () => {
    if (!overview) return;
    setError(null);
    try {
      const from = dateFrom || undefined;
      const to = dateTo || undefined;
      const [p, l, dn, s] = await Promise.all([
        getDayProfile(sessionId, from, to, excludeHolidays),
        getLoadDuration(sessionId, from, to),
        getDayNight(sessionId, from, to, 0, nightEndSlot),
        getScatter(sessionId, excludeHolidays),
      ]);
      setProfile(p); setLdc(l); setDayNight(dn); setScatter(s);
    } catch (e) {
      setError(friendlyError(e, 'Could not load the analysis.'));
    }
  }, [sessionId, overview, dateFrom, dateTo, excludeHolidays, nightEndSlot]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (weekAKey) getWeek(sessionId, weekAKey).then(setWeekA).catch(() => {});
  }, [sessionId, weekAKey]);

  useEffect(() => {
    if (weekBKey) getWeek(sessionId, weekBKey).then(setWeekB).catch(() => {});
  }, [sessionId, weekBKey]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500">
        Analysing half-hourly data…
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-sm text-red-700">
        {error}
      </div>
    );
  }

  const s = overview?.summary;

  return (
    <div className="space-y-4">
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryTile
            label="Peak demand"
            value={`${s.peak_kw.toLocaleString()} kW`}
            hint={s.peak_when}
          />
          <SummaryTile
            label="Average demand"
            value={`${s.average_kw.toLocaleString()} kW`}
            hint={`${s.average_day_kwh.toLocaleString()} kWh/day`}
          />
          <SummaryTile
            label="Load factor"
            value={`${(s.load_factor * 100).toFixed(0)}%`}
            hint="average ÷ peak"
          />
          <SummaryTile
            label="Total consumption"
            value={`${Math.round(s.total_kwh).toLocaleString()} kWh`}
            hint={`over ${s.days} days`}
          />
        </div>
      )}

      {/* Filters shared by every chart below */}
      <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            min={overview?.date_from ?? undefined}
            max={dateTo || (overview?.date_to ?? undefined)}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || (overview?.date_from ?? undefined)}
            max={overview?.date_to ?? undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 pb-1.5">
          <input
            type="checkbox"
            checked={excludeHolidays}
            onChange={(e) => setExcludeHolidays(e.target.checked)}
            className="accent-emerald-600 w-4 h-4"
          />
          Separate bank holidays
        </label>
        <button
          onClick={() => {
            setDateFrom(overview?.date_from ?? '');
            setDateTo(overview?.date_to ?? '');
          }}
          className="ml-auto text-sm text-slate-600 hover:text-slate-900 underline pb-1.5"
        >
          Reset dates
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {profile && <DayProfileChart data={profile} />}
      {ldc && <LoadDurationChart data={ldc} />}
      {dayNight && (
        <DayNightChart
          data={dayNight}
          nightEndSlot={nightEndSlot}
          onNightEndChange={setNightEndSlot}
        />
      )}
      {overview && weekA && (
        <WeekChart
          title="Week profile"
          data={weekA}
          weeks={overview.weeks}
          selected={weekAKey}
          onSelect={setWeekAKey}
        />
      )}
      {overview && weekB && (
        <WeekChart
          title="Compare with another week"
          data={weekB}
          weeks={overview.weeks}
          selected={weekBKey}
          onSelect={setWeekBKey}
        />
      )}
      {scatter && <LoadScatterChart data={scatter} />}
    </div>
  );
}
