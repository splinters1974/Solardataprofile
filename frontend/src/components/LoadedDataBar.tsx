import type { UploadResponse } from '../types';

interface Props {
  upload: UploadResponse;
  onClear: () => void;
  clearing: boolean;
}

function formatRange(from?: string | null, to?: string | null): string | null {
  if (!from || !to) return null;
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  return `${fmt(from)} to ${fmt(to)}`;
}

/**
 * Says which file is on screen right now.
 *
 * Without this the page looks identical whichever site's data is loaded, so
 * a failed upload or a stale session is invisible until the numbers look
 * wrong — by which point they have already been read as correct.
 */
export default function LoadedDataBar({ upload, onClear, clearing }: Props) {
  const range = formatRange(upload.date_from, upload.date_to);

  return (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">
            {upload.filename || 'Uploaded data'}
          </p>
          <p className="text-xs text-slate-500">
            {upload.days_parsed.toLocaleString()} days
            {range ? ` · ${range}` : ''} ·{' '}
            {Math.round(upload.annual_kwh).toLocaleString()} kWh
          </p>
        </div>
      </div>

      <button
        onClick={onClear}
        disabled={clearing}
        className="ml-auto shrink-0 text-sm font-medium text-slate-600 hover:text-red-700 disabled:text-slate-300 border border-slate-300 hover:border-red-300 rounded-lg px-4 py-1.5 transition-colors"
      >
        {clearing ? 'Clearing…' : 'Clear data'}
      </button>
    </div>
  );
}
