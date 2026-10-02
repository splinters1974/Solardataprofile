import { useState } from 'react';
import { defaultPassword } from '../local/customerEdition';
import { downloadCustomerEdition, friendlyError } from '../local/localClient';

const input = 'w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0065a5]';

/**
 * Make a locked, password-protected copy of this app holding the sites
 * loaded now, for one customer to explore and download their own reports.
 */
export default function EditionDialog({ initialCustomer, siteCount, onClose }: {
  initialCustomer: string;
  siteCount: number;
  onClose: () => void;
}) {
  const [customer, setCustomer] = useState(initialCustomer);
  const [year, setYear] = useState(new Date().getFullYear());
  const [custom, setCustom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const password = custom ?? defaultPassword(customer, year);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await downloadCustomerEdition(customer, password);
      setDone(true);
    } catch (e) {
      setError(friendlyError(e, 'Could not create the file.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Create customer edition</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            A locked copy of this dashboard holding the {siteCount} site{siteCount === 1 ? '' : 's'} loaded now,
            with their current settings and logo. The customer can explore every chart, try a different unit
            rate and download PDFs and a summary spreadsheet. They cannot change site settings or get the
            half-hourly data out as a spreadsheet.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Customer name</label>
            <input className={input} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="e.g. Compleat Foods" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Year</label>
            <input className={input} type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
          <div className="flex gap-2">
            <input className={`${input} font-mono`} value={password} onChange={(e) => setCustom(e.target.value)} />
            {custom !== null && (
              <button onClick={() => setCustom(null)} className="text-xs text-slate-500 hover:text-slate-800 whitespace-nowrap">
                Use standard
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Standard is the customer name in lower case plus the year. Send the password separately from the
            file (by phone or a separate message), never in the same email.
          </p>
        </div>

        {error && <p className="text-sm text-[#b42c2c]">{error}</p>}
        {done && (
          <p className="text-sm text-[#08780a] bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            Created. Check your downloads for the file, then open it yourself with the password before sending it.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-sm font-medium text-slate-600 px-4 py-2 rounded-lg hover:bg-slate-100">
            {done ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={create}
            disabled={busy || !customer.trim()}
            className="text-sm font-semibold bg-[#0065a5] hover:bg-[#00528a] disabled:opacity-50 text-white px-4 py-2 rounded-lg"
          >
            {busy ? 'Encrypting…' : 'Create file'}
          </button>
        </div>
      </div>
    </div>
  );
}
