import type { Level } from '../local/findings';
import type { Verdict } from '../local/dataQuality';

/** Status colours are fixed and always paired with a text label. */
export const LEVEL_UI: Record<Level, { label: string; bar: string; text: string; chip: string }> = {
  high: { label: 'High', bar: 'bg-[#d03b3b]', text: 'text-[#b42c2c]', chip: 'bg-red-50 border-red-200' },
  medium: { label: 'Medium', bar: 'bg-[#ec835a]', text: 'text-[#b4532c]', chip: 'bg-orange-50 border-orange-200' },
  low: { label: 'Low', bar: 'bg-[#fab219]', text: 'text-[#8a6100]', chip: 'bg-amber-50 border-amber-200' },
  info: { label: 'Note', bar: 'bg-slate-400', text: 'text-slate-600', chip: 'bg-slate-50 border-slate-200' },
};

/** Fixed status colours, always with a word beside them. */
export const VERDICT_UI: Record<Verdict, { chip: string; text: string; dot: string }> = {
  good: { chip: 'bg-green-50 border-green-200', text: 'text-[#08780a]', dot: 'bg-[#0ca30c]' },
  check: { chip: 'bg-amber-50 border-amber-200', text: 'text-[#8a6100]', dot: 'bg-[#fab219]' },
  poor: { chip: 'bg-red-50 border-red-200', text: 'text-[#b42c2c]', dot: 'bg-[#d03b3b]' },
};
