import { useCallback, useEffect, useState } from 'react';
import {
  getAnalyserOverview, getDayProfile, getLoadDuration, getDayNight,
  getWeek, getScatter, friendlyError, downloadAnalyserReport,
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
  /**
   * Runs a session-bound request, re-uploading behind the scenes if the
   * server has forgotten the session. Supplied by App so there is exactly
   * one recovery path across the whole app.
   */
  runWithSession: <T>(run: (id: string) => Promise<T>) => Promise<T>;
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

export default function HHAnalyser({ sessionId, runWithSession }: Props) {
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
  const [reloadKey, setReloadKey] = useState(0);
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      // Same filters the charts are showing, so the PDF and the page agree.
      await runWithSession((id) =>
        downloadAnalyserReport(id, overview?.site_name || overview?.filename || '', {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          exclude_holidays: excludeHolidays,
          night_end_slot: nightEndSlot,
          week_a: weekAKey,
          week_b: weekBKey,
        }),
      );
    } catch (e) {
      setError(friendlyError(e, 'Could not build the report.'));
    } finally {
      setDownloading(false);
    }
  }

  // First load: fetch the overview, then seed the filters and the two week
  // pickers from it so the charts open on something meaningful.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const o = await runWithSession(getAnalyserOverview);
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
  }, [sessionId, runWithSession, reloadKey]);

  const reload = useCallback(async () => {
    if (!overview) return;
    setError(null);
    try {
      const from = dateFrom || undefined;
      const to = dateTo || undefined;
      // One recovery attempt for the batch rather than four racing ones:
      // the overview settles the session first, so these follow a known-good id.
      const [p, l, dn, s] = await runWithSession((id) => Promise.all([
        getDayProfile(id, from, to, excludeHolidays),
        getLoadDuration(id, from, to),
        getDayNight(id, from, to, 0, nightEndSlot),
        getScatter(id, excludeHolidays),
      ]));
      setProfile(p); setLdc(l); setDayNight(dn); setScatter(s);
    } catch (e) {
      setError(friendlyError(e, 'Could not load the analysis.'));
    }
  }, [runWithSession, overview, dateFrom, dateTo, excludeHolidays, nightEndSlot]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!weekAKey) return;
    runWithSession((id) => getWeek(id, weekAKey)).then(setWeekA).catch(() => {});
  }, [runWithSession, weekAKey]);

  useEffect(() => {
    if (!weekBKey) return;
    runWithSession((id) => getWeek(id, weekBKey)).then(setWeekB).catch(() => {});
  }, [runWithSession, weekBKey]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500">
        Analysing half-hourly data…
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="bg-white rounded-xl border border-red-200 p-8 text-center">
        <p className="text-sm text-red-700 font-medium">{error}</p>
        <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
          The server may have restarted and dropped the upload. Drop the file
          on the box above again, or retry.
        </p>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="mt-4 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold px-5 py-2 rounded-lg"
        >
          Retry
        </button>
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
          className="text-sm text-slate-600 hover:text-slate-900 underline pb-1.5"
        >
          Reset dates
        </button>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="ml-auto bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
        >
          {downloading ? 'Building PDF…' : 'Download all charts (PDF)'}
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
