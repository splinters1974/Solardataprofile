import type { HeatmapData } from '../types';

interface Props {
  data: HeatmapData;
}

function interpolateColor(value: number, min: number, max: number): string {
  const t = max > min ? (value - min) / (max - min) : 0;
  // Green (low) → Amber → Red (high)
  const r = Math.round(t < 0.5 ? t * 2 * 255 : 255);
  const g = Math.round(t < 0.5 ? 180 : (1 - (t - 0.5) * 2) * 180);
  const b = 0;
  return `rgb(${r},${g},${b})`;
}

export default function UsageHeatmap({ data }: Props) {
  const allValues = data.matrix.flat();
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);

  // Show every 4th HH label (every 2 hours)
  const xLabels = data.hh_labels.filter((_, i) => i % 4 === 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Usage Heatmap</h2>
        <p className="text-sm text-slate-500">Average kWh by day-of-week and time-of-day</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderSpacing: 2, borderCollapse: 'separate' }}>
          <thead>
            <tr>
              <th className="w-12" />
              {data.hh_labels.map((label, i) => (
                i % 4 === 0 ? (
                  <th
                    key={i}
                    colSpan={4}
                    className="text-xs text-slate-400 font-normal text-center pb-1"
                  >
                    {label}
                  </th>
                ) : null
              ))}
            </tr>
          </thead>
          <tbody>
            {data.matrix.map((row, dowIdx) => (
              <tr key={dowIdx}>
                <td className="text-xs text-slate-500 pr-2 text-right font-medium w-12">
                  {data.dow_labels[dowIdx]}
                </td>
                {row.map((val, slotIdx) => (
                  <td
                    key={slotIdx}
                    title={`${data.dow_labels[dowIdx]} ${data.hh_labels[slotIdx]}: ${val.toFixed(2)} kWh`}
                    style={{
                      backgroundColor: val > 0 ? interpolateColor(val, minVal, maxVal) : '#f1f5f9',
                      opacity: val > 0 ? 0.7 + 0.3 * ((val - minVal) / (maxVal - minVal || 1)) : 1,
                      width: 8,
                      height: 20,
                      borderRadius: 2,
                    }}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <span className="text-xs text-slate-400">Low</span>
        <div className="flex-1 h-2 rounded" style={{
          background: 'linear-gradient(to right, rgb(0,180,0), rgb(255,180,0), rgb(255,0,0))'
        }} />
        <span className="text-xs text-slate-400">High</span>
      </div>
    </div>
  );
}
