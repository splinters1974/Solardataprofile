import { exampleBands, type Tariff, type TariffBand } from '../local/tariff';
import { slotTime } from '../local/calendar';
import { smallInput } from './format';

const SLOTS = Array.from({ length: 49 }, (_, i) => i);
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

/** Recurring time-band rates. Every half hour must match exactly one band. */
export default function TariffEditor({ tariff, flatP, onChange, problems, locked }: {
  tariff: Tariff | null;
  flatP: number;
  onChange: (t: Tariff | null) => void;
  problems: string[];
  locked: boolean;
}) {
  const t: Tariff = tariff ?? { mode: 'flat', bands: [], holidaysAsSunday: false };
  const banded = t.mode === 'bands';
  const setBand = (id: string, patch: Partial<TariffBand>) => onChange({ ...t, bands: t.bands.map((b) => (b.id === id ? { ...b, ...patch } : b)) });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" disabled={locked} checked={!banded} onChange={() => onChange({ ...t, mode: 'flat' })} /> One flat rate ({flatP}p/kWh)
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" disabled={locked} checked={banded} onChange={() => onChange({ ...t, mode: 'bands', bands: t.bands.length ? t.bands : exampleBands(flatP) })} /> Time bands
        </label>
      </div>
      {banded && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1 pr-2 font-medium">Band</th><th className="py-1 pr-2 font-medium">p/kWh</th>
                  <th className="py-1 pr-2 font-medium">Days</th><th className="py-1 pr-2 font-medium">From</th>
                  <th className="py-1 pr-2 font-medium">Until</th><th className="py-1 pr-2 font-medium">Effective dates (optional)</th><th />
                </tr>
              </thead>
              <tbody>
                {t.bands.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="py-1 pr-2"><input disabled={locked} className={`${smallInput} w-28`} value={b.name} onChange={(e) => setBand(b.id, { name: e.target.value })} /></td>
                    <td className="py-1 pr-2"><input disabled={locked} type="number" step="any" min={0} className={`${smallInput} w-20`} value={b.rateP} onChange={(e) => setBand(b.id, { rateP: Number(e.target.value) })} /></td>
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {DAYS.map((d, k) => (
                        <label key={k} className="inline-flex flex-col items-center text-[10px] text-slate-500 mr-0.5">
                          {d}<input disabled={locked} type="checkbox" checked={b.days[k]} onChange={(e) => setBand(b.id, { days: b.days.map((x, j) => (j === k ? e.target.checked : x)) })} />
                        </label>
                      ))}
                    </td>
                    <td className="py-1 pr-2"><select disabled={locked} className={smallInput} value={b.start} onChange={(e) => setBand(b.id, { start: Number(e.target.value) })}>{SLOTS.slice(0, 48).map((s) => <option key={s} value={s}>{slotTime(s)}</option>)}</select></td>
                    <td className="py-1 pr-2"><select disabled={locked} className={smallInput} value={b.end} onChange={(e) => setBand(b.id, { end: Number(e.target.value) })}>{SLOTS.map((s) => <option key={s} value={s}>{s === b.start ? `${slotTime(s)} (all day)` : slotTime(s)}</option>)}</select></td>
                    <td className="py-1 pr-2 whitespace-nowrap">
                      <input disabled={locked} type="date" className={smallInput} value={b.from ?? ''} onChange={(e) => setBand(b.id, { from: e.target.value || undefined })} aria-label="From" />
                      <input disabled={locked} type="date" className={`${smallInput} ml-1`} value={b.to ?? ''} onChange={(e) => setBand(b.id, { to: e.target.value || undefined })} aria-label="To" />
                    </td>
                    <td className="py-1 text-right">{!locked && <button className="text-xs text-slate-400 hover:text-red-600" onClick={() => onChange({ ...t, bands: t.bands.filter((x) => x.id !== b.id) })}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!locked && (
            <div className="flex flex-wrap items-center gap-4">
              <button className="text-xs text-[#0065a5] hover:underline" onClick={() => onChange({ ...t, bands: [...t.bands, { id: newId(), name: 'Band', rateP: flatP, days: [true, true, true, true, true, true, true], start: 0, end: 0 }] })}>+ add band</button>
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" checked={t.holidaysAsSunday} onChange={(e) => onChange({ ...t, holidaysAsSunday: e.target.checked })} />
                Bank holidays use Sunday's bands
              </label>
            </div>
          )}
          {problems.length ? (
            <p className="text-sm text-[#b42c2c] bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              Not applied: {problems.join(' ')} Every half hour with a reading needs exactly one band. The flat rate is used until it does.
            </p>
          ) : <p className="text-xs text-[#08780a]">Every half hour matches exactly one band.</p>}
          <p className="text-xs text-slate-400">A window that ends at or before it starts runs past midnight. Rates are energy only: standing, capacity and other fixed charges are not included.</p>
        </>
      )}
    </div>
  );
}
