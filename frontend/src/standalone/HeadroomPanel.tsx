import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import type { HeadroomResult, TestLoad } from '../local/headroom';
import { inWindow } from '../local/headroom';
import type { SiteSettings } from '../local/findings';
import { slotLabel } from '../local/findings';

const input = 'w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const fmt = (v: number, dp = 0) => v.toLocaleString('en-GB', { maximumFractionDigits: dp });
const SLOTS = Array.from({ length: 48 }, (_, i) => i);
const BLUE = '#2a78d6';
const ORANGE = '#e07b1a';

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'bad' }) {
  return (
    <div className="bg-slate-50 rounded-lg px-4 py-3">
      <p className={`text-xl font-bold tabular-nums ${tone === 'bad' ? 'text-[#b42c2c]' : 'text-slate-800'}`}>{value}</p>
      <p className="text-xs font-medium text-slate-600 mt-0.5">{label}</p>
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

const DEFAULT_TEST: TestLoad = { kw: 50, start: 12, end: 44, months: 'heating' };

/** How much load can be added before the supply runs out. */
export default function HeadroomPanel({ settings, headroom: h, onChange }: {
  settings: SiteSettings;
  headroom: HeadroomResult | null;
  onChange: (s: SiteSettings) => void;
}) {
  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => onChange({ ...settings, [k]: v });
  const t = settings.testLoad;
  const setTest = (patch: Partial<TestLoad>) => set('testLoad', { ...(t ?? DEFAULT_TEST), ...patch });

  const header = (
    <div>
      <h3 className="text-base font-semibold text-slate-800">Electrification headroom</h3>
      <p className="text-sm text-slate-500 mt-0.5">
        How much load (heat pumps, EV charging, new plant) the site can add before it outgrows its supply.
      </p>
    </div>
  );

  if (!h) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-3">
        {header}
        <div className="flex flex-wrap items-end gap-3 bg-slate-50 rounded-lg p-4">
          <div className="w-48">
            <label className="block text-xs font-medium text-slate-600 mb-1">Agreed supply capacity (kVA)</label>
            <input
              type="number" min={0} className={input} placeholder="e.g. 200"
              value={settings.capacityKva ?? ''}
              onChange={(e) => set('capacityKva', e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
          <p className="text-sm text-slate-500 flex-1 min-w-60">
            Enter the agreed capacity from the bill or connection agreement (often called the
            Authorised or Agreed Supply Capacity) to see the headroom.
          </p>
        </div>
      </div>
    );
  }

  const pf = settings.powerFactor || 0.95;
  const addKva = t && t.kw > 0 ? t.kw / pf : 0;
  const profile = h.worstByTime.map((p, i) => ({
    time: slotLabel(p.slot),
    'Worst case, whole year': p.kva,
    'Worst case, Dec to Feb': h.worstWinterByTime[i].kva,
    ...(t && t.kw > 0 ? {
      // The new load in its own window, on top of the season it runs in.
      'With the new load': round1((t.months === 'heating' ? h.worstWinterByTime[i].kva : p.kva)
        + (inWindow(p.slot, t.start, t.end) ? addKva : 0)),
    } : {}),
  }));
  const yMax = Math.max(h.capacityKva, ...profile.map((p) => Math.max(p['Worst case, whole year'], p['With the new load'] ?? 0))) * 1.08;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
      {header}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Agreed capacity" value={`${fmt(h.capacityKva)} kVA`} hint={`${fmt(h.usableKva)} kVA usable after ${settings.headroomMarginPct}% margin`} />
        <Tile label="Peak demand" value={`${fmt(h.peakKva)} kVA`} hint={h.peakWhen} />
        <Tile
          label="Firm headroom"
          value={`${fmt(h.firmHeadroomKw)} kW`}
          hint={h.firmHeadroomKw >= 0 ? 'can be added at any time of year' : 'already over usable capacity'}
          tone={h.firmHeadroomKw < 0 ? 'bad' : undefined}
        />
        <Tile label="Capacity used at peak" value={`${Math.round((h.peakKva / h.capacityKva) * 100)}%`} hint={`power factor ${pf}`} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <p className="text-sm font-medium text-slate-700 mb-1">Peak demand by month (kVA)</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={h.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} angle={-35} textAnchor="end" height={44} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} domain={[0, Math.ceil(yMax)]} />
              <Tooltip formatter={(v) => [`${fmt(Number(v), 1)} kVA`, 'Peak']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <ReferenceLine y={h.capacityKva} stroke="#334155" strokeDasharray="4 3" label={{ value: 'Capacity', position: 'insideTopLeft', fontSize: 11, fill: '#334155' }} />
              <ReferenceLine y={h.usableKva} stroke="#d03b3b" strokeDasharray="2 2" label={{ value: 'Usable', position: 'insideBottomRight', fontSize: 11, fill: '#b42c2c' }} />
              <Bar dataKey="peakKva" fill={BLUE} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700 mb-1">Highest demand at each time of day (kVA)</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={profile} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} interval={5} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} domain={[0, Math.ceil(yMax)]} />
              <Tooltip formatter={(v, n) => [`${fmt(Number(v), 1)} kVA`, n]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
              <ReferenceLine y={h.usableKva} stroke="#d03b3b" strokeDasharray="2 2" />
              <Line dataKey="Worst case, whole year" stroke="#94a3b8" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line dataKey="Worst case, Dec to Feb" stroke={BLUE} dot={false} strokeWidth={2} isAnimationActive={false} />
              {t && t.kw > 0 && (
                <Line dataKey="With the new load" stroke={ORANGE} dot={false} strokeWidth={2} isAnimationActive={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
          <p className="text-xs text-slate-400">Red dashed line: usable capacity.</p>
        </div>
      </div>

      <div className="bg-slate-50 rounded-lg p-4 space-y-3">
        <p className="text-sm font-semibold text-slate-700">Test a new load</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Load (kW)</label>
            <input type="number" min={0} className={input} placeholder="e.g. 50"
              value={t?.kw ?? ''}
              onChange={(e) => (e.target.value === '' ? set('testLoad', null) : setTest({ kw: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Runs from</label>
            <select className={input} value={(t ?? DEFAULT_TEST).start} onChange={(e) => setTest({ start: Number(e.target.value) })}>
              {SLOTS.map((s) => <option key={s} value={s}>{slotLabel(s)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Until</label>
            <select className={input} value={(t ?? DEFAULT_TEST).end} onChange={(e) => setTest({ end: Number(e.target.value) })}>
              {SLOTS.map((s) => <option key={s} value={s}>{slotLabel(s)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Months</label>
            <select className={input} value={(t ?? DEFAULT_TEST).months} onChange={(e) => setTest({ months: e.target.value as TestLoad['months'] })}>
              <option value="heating">Oct to Apr</option>
              <option value="all">All year</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Safety margin (%)</label>
            <input type="number" min={0} max={50} className={input}
              value={settings.headroomMarginPct}
              onChange={(e) => set('headroomMarginPct', Math.max(0, Math.min(50, Number(e.target.value) || 0)))} />
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Heat pump: its electrical input, not its heat output (a 150 kW heat output unit at a COP of 3 draws
          about 50 kW). Overnight EV charging: e.g. 22:00 until 06:00. Same start and end means all day.
        </p>
        {h.test ? (
          <div className={`rounded-lg border px-4 py-3 text-sm ${h.test.fits ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <p className={`font-semibold ${h.test.fits ? 'text-[#08780a]' : 'text-[#b42c2c]'}`}>
              {h.test.fits ? 'Fits within usable capacity' : 'Does not fit'}
            </p>
            <p className="text-slate-700 mt-0.5">{h.test.summary}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Enter a load in kW to test it against the site's capacity.</p>
        )}
      </div>
    </div>
  );
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}
