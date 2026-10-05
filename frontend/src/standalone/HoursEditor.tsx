import { slotLabel, type DayHours, type OpeningHours } from '../local/findings';

const SLOTS = Array.from({ length: 49 }, (_, i) => i);

function DayRow({ label, value, onChange }: {
  label: string; value: DayHours; onChange: (v: DayHours) => void;
}) {
  const open = value !== null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-20 text-slate-600">{label}</span>
      <label className="flex items-center gap-1.5 text-slate-600 w-24">
        <input
          type="checkbox"
          checked={open}
          onChange={(e) => onChange(e.target.checked ? { open: 16, close: 36 } : null)}
          className="accent-blue-700"
        />
        Open
      </label>
      {open && (
        <>
          <select className="border border-slate-300 rounded-md px-2 py-1 text-sm" value={value.open}
            onChange={(e) => onChange({ ...value, open: Math.min(Number(e.target.value), value.close) })}>
            {SLOTS.slice(0, 48).map((s) => <option key={s} value={s}>{slotLabel(s)}</option>)}
          </select>
          <span className="text-slate-400">to</span>
          <select className="border border-slate-300 rounded-md px-2 py-1 text-sm" value={value.close}
            onChange={(e) => onChange({ ...value, close: Math.max(Number(e.target.value), value.open) })}>
            {SLOTS.slice(1).map((s) => <option key={s} value={s}>{slotLabel(s)}</option>)}
          </select>
        </>
      )}
    </div>
  );
}

/** Weekday, Saturday and Sunday hours plus the bank holiday rule. */
export default function HoursEditor({ hours, onChange }: {
  hours: OpeningHours;
  onChange: (patch: Partial<OpeningHours>) => void;
}) {
  return (
    <div className="space-y-2">
      <DayRow label="Weekdays" value={hours.weekday} onChange={(v) => onChange({ weekday: v })} />
      <DayRow label="Saturday" value={hours.saturday} onChange={(v) => onChange({ saturday: v })} />
      <DayRow label="Sunday" value={hours.sunday} onChange={(v) => onChange({ sunday: v })} />
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={hours.holidaysLikeSunday}
          onChange={(e) => onChange({ holidaysLikeSunday: e.target.checked })}
          className="accent-blue-700"
        />
        Treat bank holidays like Sunday
      </label>
    </div>
  );
}
