/** Formatting helpers and shared class names for the offline app's screens. */
export const inputCls = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#0065a5] focus:ring-2 focus:ring-[#0065a5]/20 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed';
export const smallInput = 'bg-white border border-slate-300 rounded-md px-2 py-1 text-sm text-slate-900 focus:outline-none focus:border-[#0065a5] focus:ring-2 focus:ring-[#0065a5]/20 disabled:bg-slate-100 disabled:cursor-not-allowed';
export const btn = 'text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50';
export const btnPrimary = `${btn} bg-[#0065a5] hover:bg-[#00528a] text-white`;
export const btnSecondary = `${btn} bg-white border border-slate-300 text-slate-900 hover:border-slate-900`;
export const linkBtn = 'text-sm text-[#0065a5] hover:text-[#00528a] underline';

export const gbp = (v: number) => `£${Math.round(v).toLocaleString('en-GB')}`;
export const num = (v: number, dp = 0) => v.toLocaleString('en-GB', { maximumFractionDigits: dp, minimumFractionDigits: 0 });
export const kwh = (v: number) => `${num(v)} kWh`;
export const kw = (v: number) => `${num(v, 1)} kW`;
export const pct = (v: number, dp = 0) => `${(v * 100).toFixed(dp)}%`;
