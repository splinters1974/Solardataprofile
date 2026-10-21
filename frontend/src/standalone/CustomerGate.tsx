import { useState } from 'react';
import { AMERESCO_LOGO } from '../local/brand';
import { readSealedEdition } from '../local/customerEdition';
import { openCustomerEdition } from '../local/localClient';
import StandaloneApp from './StandaloneApp';
import { ProductMark } from './ui';

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
    <div className="min-h-screen bg-white flex flex-col">
      <header className="bg-white border-b border-slate-300 px-6 py-2.5">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <img src={AMERESCO_LOGO} alt="Ameresco" className="h-10 w-auto" />
          <span className="h-9 w-px bg-slate-300" aria-hidden />
          <ProductMark />
        </div>
      </header>
      <main className="flex-1 bg-slate-100 px-6 py-12 md:py-20">
        <div className="max-w-6xl mx-auto grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] items-center">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Energy dashboard prepared by Ameresco{made ? `, ${made}` : ''}</p>
            <h1 className="text-4xl md:text-5xl leading-[1.05] font-extrabold tracking-tight text-slate-900 break-words">{sealed?.customer ?? 'Customer'}</h1>
            <p className="text-base text-slate-600 max-w-xl">
              When your sites use electricity, what runs while they are shut, and what it costs. You can adjust opening hours, rates and
              more, and download the reports.
            </p>
          </div>
          <form onSubmit={unlock} className="w-full bg-white rounded-xl shadow-md border border-slate-300 p-7 space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Open your dashboard</h2>
              <p className="text-sm text-slate-600 mt-1">Enter the password you were given.</p>
            </div>
            <div>
              <label htmlFor="pw" className="block text-xs font-semibold text-slate-800 mb-1">Password</label>
              <input
                id="pw"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#0065a5] focus:ring-2 focus:ring-[#0065a5]/20"
              />
            </div>
            {error && <p className="text-sm text-[#b42c2c]">{error}</p>}
            <button
              type="submit"
              disabled={busy || !password}
              className="w-full bg-[#0065a5] hover:bg-[#00528a] disabled:opacity-50 text-white font-semibold rounded-lg py-3 text-sm"
            >
              {busy ? 'Opening…' : 'Open dashboard'}
            </button>
            <p className="text-xs text-slate-500">
              Your data stays on this computer. Nothing is sent anywhere when you use this dashboard.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
