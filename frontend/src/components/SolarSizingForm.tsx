import { useState } from 'react';
import type { EconomicAssumptions, SizingValues } from '../types';

interface Props {
  onSubmit: (values: SizingValues) => void;
  loading: boolean;
}

const ASPECT_OPTIONS = [
  { label: 'South', value: 0 },
  { label: 'South-East', value: -45 },
  { label: 'South-West', value: 45 },
  { label: 'East', value: -90 },
  { label: 'West', value: 90 },
];

export const DEFAULT_ASSUMPTIONS: EconomicAssumptions = {
  import_price_p_kwh: 25,
  export_price_p_kwh: 5,
  capex_per_kwp: 800,
  opex_per_kwp_year: 10,
  import_price_inflation: 0.02,
  export_price_inflation: 0,
  opex_inflation: 0.03,
  discount_rate: 0.035,
  system_life_years: 25,
  degradation_rate: 0.005,
  carbon_factor: 0.196,
};

const inputClass =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function SolarSizingForm({ onSubmit, loading }: Props) {
  const [postcode, setPostcode] = useState('');
  const [siteName, setSiteName] = useState('');
  const [tilt, setTilt] = useState(35);
  const [aspect, setAspect] = useState(0);
  const [scMin, setScMin] = useState(70);
  const [scMax, setScMax] = useState(90);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [a, setA] = useState<EconomicAssumptions>(DEFAULT_ASSUMPTIONS);

  const bandInvalid = scMin > scMax;

  function set<K extends keyof EconomicAssumptions>(key: K, value: EconomicAssumptions[K]) {
    setA((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!postcode.trim() || bandInvalid) return;
    onSubmit({
      postcode: postcode.trim(),
      site_name: siteName.trim(),
      target_sc_min: scMin / 100,
      target_sc_max: scMax / 100,
      roof_tilt: tilt,
      roof_aspect: aspect,
      assumptions: a,
    });
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <h2 className="text-lg font-semibold text-slate-800">Solar System Sizing</h2>
      <p className="text-sm text-slate-500 mb-4">
        Sized on shortest payback, constrained to your self-consumption band.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Site Name" hint="Appears on the client report">
            <input
              type="text"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="e.g. Whinfell Leisure Centre"
              className={inputClass}
            />
          </Field>
          <Field label="Site Postcode">
            <input
              type="text"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value.toUpperCase())}
              placeholder="e.g. SW1A 1AA"
              className={inputClass}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Roof Tilt (°)">
            <input
              type="number"
              value={tilt}
              min={0}
              max={90}
              onChange={(e) => setTilt(Number(e.target.value))}
              className={inputClass}
            />
          </Field>
          <Field label="Roof Orientation">
            <select
              value={aspect}
              onChange={(e) => setAspect(Number(e.target.value))}
              className={inputClass}
            >
              {ASPECT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Self-Consumption Band: {scMin}%–{scMax}%
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-slate-400 mb-1 block">Minimum {scMin}%</span>
              <input
                type="range"
                min={40}
                max={95}
                value={scMin}
                onChange={(e) => setScMin(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>
            <div>
              <span className="text-xs text-slate-400 mb-1 block">Maximum {scMax}%</span>
              <input
                type="range"
                min={45}
                max={100}
                value={scMax}
                onChange={(e) => setScMax(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>
          </div>
          {bandInvalid && (
            <p className="text-xs text-red-600 mt-1">
              Minimum cannot be above the maximum.
            </p>
          )}
        </div>

        {/* Tariffs — the numbers that actually move the answer */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
          <Field label="Import Price (p/kWh)" hint="What the site pays now">
            <input
              type="number"
              step="0.1"
              min={0.1}
              value={a.import_price_p_kwh}
              onChange={(e) => set('import_price_p_kwh', Number(e.target.value))}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Export Price (p/kWh)" hint="Zero if export is not permitted">
            <input
              type="number"
              step="0.1"
              min={0}
              value={a.export_price_p_kwh}
              onChange={(e) => set('export_price_p_kwh', Number(e.target.value))}
              className={inputClass}
              required
            />
          </Field>
        </div>

        <button
          type="button"
          onClick={() => setShowAssumptions((v) => !v)}
          className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
        >
          {showAssumptions ? '− Hide' : '+ Show'} cost and appraisal assumptions
        </button>

        {showAssumptions && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
            <p className="text-xs text-slate-500">
              Defaults are indicative only. Replace them with your own pricing
              before the numbers go to a client.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Installed Cost (£/kWp)" hint="Rooftop, inclusive of margin">
                <input
                  type="number"
                  step="10"
                  min={1}
                  value={a.capex_per_kwp}
                  onChange={(e) => set('capex_per_kwp', Number(e.target.value))}
                  className={inputClass}
                />
              </Field>
              <Field label="O&M (£/kWp/year)">
                <input
                  type="number"
                  step="1"
                  min={0}
                  value={a.opex_per_kwp_year}
                  onChange={(e) => set('opex_per_kwp_year', Number(e.target.value))}
                  className={inputClass}
                />
              </Field>
              <Field
                label="Import Price Inflation (%/yr)"
                hint="Grows the saving year on year"
              >
                <input
                  type="number"
                  step="0.1"
                  value={(a.import_price_inflation * 100).toFixed(1)}
                  onChange={(e) =>
                    set('import_price_inflation', Number(e.target.value) / 100)}
                  className={inputClass}
                />
              </Field>
              <Field label="Export Price Inflation (%/yr)" hint="Flat by default">
                <input
                  type="number"
                  step="0.1"
                  value={(a.export_price_inflation * 100).toFixed(1)}
                  onChange={(e) =>
                    set('export_price_inflation', Number(e.target.value) / 100)}
                  className={inputClass}
                />
              </Field>
              <Field label="O&M Inflation (%/yr)">
                <input
                  type="number"
                  step="0.1"
                  value={(a.opex_inflation * 100).toFixed(1)}
                  onChange={(e) => set('opex_inflation', Number(e.target.value) / 100)}
                  className={inputClass}
                />
              </Field>
              <Field label="Discount Rate (%)" hint="Green Book default is 3.5%">
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  value={(a.discount_rate * 100).toFixed(1)}
                  onChange={(e) => set('discount_rate', Number(e.target.value) / 100)}
                  className={inputClass}
                />
              </Field>
              <Field label="System Life (years)">
                <input
                  type="number"
                  min={5}
                  max={40}
                  value={a.system_life_years}
                  onChange={(e) => set('system_life_years', Number(e.target.value))}
                  className={inputClass}
                />
              </Field>
              <Field label="Degradation (%/year)">
                <input
                  type="number"
                  step="0.05"
                  min={0}
                  value={(a.degradation_rate * 100).toFixed(2)}
                  onChange={(e) => set('degradation_rate', Number(e.target.value) / 100)}
                  className={inputClass}
                />
              </Field>
              <Field
                label="Grid Carbon (kgCO2e/kWh)"
                hint="Check the current DESNZ factor"
              >
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  value={a.carbon_factor}
                  onChange={(e) => set('carbon_factor', Number(e.target.value))}
                  className={inputClass}
                />
              </Field>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setA(DEFAULT_ASSUMPTIONS)}
                  className="text-sm text-slate-500 hover:text-slate-700 underline pb-2"
                >
                  Reset to defaults
                </button>
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !postcode.trim() || bandInvalid}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
        >
          {loading ? 'Sizing system…' : 'Size Solar System'}
        </button>
      </form>
    </div>
  );
}
