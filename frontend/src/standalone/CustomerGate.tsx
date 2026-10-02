import { useState } from 'react';
import { AMERESCO_LOGO } from '../local/brand';
import { readSealedEdition } from '../local/customerEdition';
import { openCustomerEdition } from '../local/localClient';
import StandaloneApp from './StandaloneApp';

/** A customer edition opens here: password first, then the locked dashboard. */
export default function CustomerGate() {
  const sealed = readSealedEdition();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customer, setCustomer] = useState<string | null>(null);

  if (customer) return <StandaloneApp mode="customer" customer={customer} />;

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await openCustomerEdition(password);
      setCustomer(data.customer);
    } catch (err) {
      setError((err as Error).message || 'Could not open this file.');
    } finally {
      setBusy(false);
    }
  }

  const made = sealed?.createdAt
    ? new Date(`${sealed.createdAt}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <form onSubmit={unlock} className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-5">
        <div className="flex items-center gap-4">
          <img src={AMERESCO_LOGO} alt="Ameresco" className="h-10 w-auto" />
          <span className="h-9 w-px bg-slate-200" aria-hidden />
          <p className="text-xl font-bold text-[#0065a5]">Data Analyser</p>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-800">{sealed?.customer ?? 'Customer'} energy dashboard</h1>
          <p className="text-sm text-slate-500">
            Prepared by Ameresco{made ? `, ${made}` : ''}. Enter the password you were given to open it.
          </p>
        </div>
        <div>
          <label htmlFor="pw" className="block text-xs font-medium text-slate-600 mb-1">Password</label>
          <input
            id="pw"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0065a5]"
          />
        </div>
        {error && <p className="text-sm text-[#b42c2c]">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full bg-[#0065a5] hover:bg-[#00528a] disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm"
        >
          {busy ? 'Opening…' : 'Open dashboard'}
        </button>
        <p className="text-xs text-slate-400">
          Your data stays on this computer. Nothing is sent anywhere when you use this dashboard.
        </p>
      </form>
    </div>
  );
}
