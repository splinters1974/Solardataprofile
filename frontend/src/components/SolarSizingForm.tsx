import { useState } from 'react';

interface Props {
  onSubmit: (values: {
    postcode: string;
    target_sc_min: number;
    target_sc_max: number;
    roof_tilt: number;
    roof_aspect: number;
  }) => void;
  loading: boolean;
}

const ASPECT_OPTIONS = [
  { label: 'South', value: 0 },
  { label: 'South-East', value: -45 },
  { label: 'South-West', value: 45 },
  { label: 'East', value: -90 },
  { label: 'West', value: 90 },
];

export default function SolarSizingForm({ onSubmit, loading }: Props) {
  const [postcode, setPostcode] = useState('');
  const [tilt, setTilt] = useState(35);
  const [aspect, setAspect] = useState(0);
  const [scMin, setScMin] = useState(80);
  const [scMax, setScMax] = useState(90);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!postcode.trim()) return;
    onSubmit({
      postcode: postcode.trim(),
      target_sc_min: scMin / 100,
      target_sc_max: scMax / 100,
      roof_tilt: tilt,
      roof_aspect: aspect,
    });
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Solar System Sizing</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Site Postcode
          </label>
          <input
            type="text"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value.toUpperCase())}
            placeholder="e.g. SW1A 1AA"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Roof Tilt (°)
            </label>
            <input
              type="number"
              value={tilt}
              min={0}
              max={90}
              onChange={(e) => setTilt(Number(e.target.value))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Roof Orientation
            </label>
            <select
              value={aspect}
              onChange={(e) => setAspect(Number(e.target.value))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              {ASPECT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Self-Consumption Target: {scMin}%–{scMax}%
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-slate-400 mb-1 block">Minimum %</span>
              <input
                type="range"
                min={50}
                max={95}
                value={scMin}
                onChange={(e) => setScMin(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>
            <div>
              <span className="text-xs text-slate-400 mb-1 block">Maximum %</span>
              <input
                type="range"
                min={55}
                max={100}
                value={scMax}
                onChange={(e) => setScMax(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !postcode.trim()}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
        >
          {loading ? 'Sizing system…' : 'Size Solar System'}
        </button>
      </form>
    </div>
  );
}
