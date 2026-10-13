/** Formatting helpers and shared class names for the offline app's screens. */
export const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-slate-50 disabled:text-slate-500';
export const smallInput = 'border border-slate-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-slate-50';
export const btn = 'text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50';
export const btnPrimary = `${btn} bg-[#0065a5] hover:bg-[#00528a] text-white`;
export const btnSecondary = `${btn} bg-white border border-slate-300 text-slate-700 hover:border-blue-400`;
export const linkBtn = 'text-sm text-[#0065a5] hover:text-[#00528a] underline';

export const gbp = (v: number) => `£${Math.round(v).toLocaleString('en-GB')}`;
export const num = (v: number, dp = 0) => v.toLocaleString('en-GB', { maximumFractionDigits: dp, minimumFractionDigits: 0 });
export const kwh = (v: number) => `${num(v)} kWh`;
export const kw = (v: number) => `${num(v, 1)} kW`;
export const pct = (v: number, dp = 0) => `${(v * 100).toFixed(dp)}%`;
