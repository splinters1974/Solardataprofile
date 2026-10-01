import type { Level } from '../local/findings';

/** Status colours are fixed and always paired with a text label. */
export const LEVEL_UI: Record<Level, { label: string; bar: string; text: string; chip: string }> = {
  high: { label: 'High', bar: 'bg-[#d03b3b]', text: 'text-[#b42c2c]', chip: 'bg-red-50 border-red-200' },
  medium: { label: 'Medium', bar: 'bg-[#ec835a]', text: 'text-[#b4532c]', chip: 'bg-orange-50 border-orange-200' },
  low: { label: 'Low', bar: 'bg-[#fab219]', text: 'text-[#8a6100]', chip: 'bg-amber-50 border-amber-200' },
  info: { label: 'Note', bar: 'bg-slate-400', text: 'text-slate-600', chip: 'bg-slate-50 border-slate-200' },
};
