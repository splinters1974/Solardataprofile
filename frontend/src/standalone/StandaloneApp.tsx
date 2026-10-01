/**
 * The offline app: a portfolio of sites, one meter file each, ranked by
 * opportunity, with the full HH Analyser behind every site.
 */
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import BrandHeader from '../components/BrandHeader';
import HHAnalyser from '../components/analyser/HHAnalyser';
import {
  downloadExcel, downloadPortfolioReport, forgetSession, friendlyError, getDefaultRate,
  listSites, setDefaultRate, updateSiteSettings, uploadHHFile, type SiteSummary,
} from '../local/localClient';
import { SITE_TYPES } from '../local/findings';
import { rankSites } from '../local/pdf/portfolioReport';
import FindingsPanel from './FindingsPanel';
import { LEVEL_UI } from './levelUi';
import SiteSettingsPanel from './SiteSettingsPanel';
import CarpetPlot from './CarpetPlot';

const gbp = (v: number) => `£${Math.round(v).toLocaleString('en-GB')}`;
const btn = 'text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50';

function Uploader({ onFiles, busy }: { onFiles: (f: File[]) => void; busy: string | null }) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onFiles,
    multiple: true,
    disabled: !!busy,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
      'text/plain': ['.txt'],
    },
  });
  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-xl px-6 py-7 text-center cursor-pointer transition-colors ${
        isDragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400 bg-white'
      } ${busy ? 'opacity-60 cursor-wait' : ''}`}
    >
      <input {...getInputProps()} />
      <p className="text-slate-700 font-medium">
        {busy ?? (isDragActive ? 'Drop the meter files here' : 'Drag and drop HH meter files here, one file per meter')}
      </p>
      <p className="text-slate-400 text-sm mt-1">
        or click to browse. Add as many as you like; each becomes a site. .xlsx, .xls, .csv
      </p>
    </div>
  );
}

export default function StandaloneApp() {
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ file: string; message: string }[]>([]);
  const [rate, setRate] = useState(getDefaultRate());
  const [title, setTitle] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);

  const refresh = useCallback(() => setSites(listSites()), []);

  async function addFiles(files: File[]) {
    const failed: { file: string; message: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      setBusy(`Reading ${files[i].name} (${i + 1} of ${files.length})…`);
      try {
        await uploadHHFile(files[i]);
      } catch (e) {
        failed.push({ file: files[i].name, message: friendlyError(e, 'Could not read this file.') });
      }
    }
    setErrors(failed);
    setBusy(null);
    refresh();
  }

  async function run(label: string, job: () => Promise<void>) {
    setExporting(label);
    try {
      await job();
    } catch (e) {
      setErrors([{ file: label, message: friendlyError(e, 'Export failed.') }]);
    } finally {
      setExporting(null);
    }
  }

  const ranked = rankSites(sites);
  const site = sites.find((s) => s.id === selected) ?? null;
  const total = (f: (s: SiteSummary) => number) => ranked.reduce((a, s) => a + f(s), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <BrandHeader />
          <div className="flex-1" />
          <span className="text-xs text-slate-500 bg-slate-100 rounded-full px-3 py-1">
            Offline · data stays on this computer
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {site ? (
          <>
            <button onClick={() => setSelected(null)} className="text-sm text-blue-700 hover:text-blue-900 font-medium">
              ← All sites
            </button>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">{site.settings.name}</h1>
                <p className="text-sm text-slate-500">
                  {site.filename} · {site.metrics.days} days · {SITE_TYPES[site.settings.type].label}
                </p>
              </div>
              <button
                disabled={!!exporting}
                onClick={() => run('Excel', () => downloadExcel(site.settings.name, [site.id]))}
                className={`${btn} bg-white border border-slate-300 text-slate-700 hover:border-blue-400`}
              >
                {exporting === 'Excel' ? 'Building…' : 'Export to Excel'}
              </button>
            </div>
            {site.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-800">
                {site.warnings.map((w, i) => <p key={i}>{w}</p>)}
              </div>
            )}
            <SiteSettingsPanel
              settings={site.settings}
              defaultRate={rate}
              onChange={(s) => { updateSiteSettings(site.id, s); refresh(); }}
            />
            <FindingsPanel metrics={site.metrics} />
            <CarpetPlot frame={site.frame} />
            <HHAnalyser key={site.id} sessionId={site.id} runWithSession={(job) => job(site.id)} />
          </>
        ) : (
          <>
            <Uploader onFiles={addFiles} busy={busy} />

            {errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 space-y-1">
                {errors.map((e, i) => <p key={i}><strong>{e.file}:</strong> {e.message}</p>)}
              </div>
            )}

            {ranked.length > 0 && (
              <>
                <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex flex-wrap items-end gap-4">
                  <div className="flex-1 min-w-48">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Client or estate name</label>
                    <input
                      value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Appears on the reports"
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div className="w-44">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Default rate (p/kWh)</label>
                    <input
                      type="number" min={0} step={0.1} value={rate}
                      onChange={(e) => { const v = Number(e.target.value); setRate(v); setDefaultRate(v); refresh(); }}
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <button
                    disabled={!!exporting}
                    onClick={() => run('Portfolio PDF', () => downloadPortfolioReport(title))}
                    className={`${btn} bg-blue-700 hover:bg-blue-800 text-white`}
                  >
                    {exporting === 'Portfolio PDF' ? 'Building PDF…' : 'Portfolio report (PDF)'}
                  </button>
                  <button
                    disabled={!!exporting}
                    onClick={() => run('Excel', () => downloadExcel(title))}
                    className={`${btn} bg-white border border-slate-300 text-slate-700 hover:border-blue-400`}
                  >
                    {exporting === 'Excel' ? 'Building…' : 'Export to Excel'}
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    ['Sites', String(ranked.length)],
                    ['Annual consumption', `${Math.round(total((s) => s.metrics.annualKwh)).toLocaleString('en-GB')} kWh`],
                    ['Annual cost', gbp(total((s) => s.metrics.annualCost))],
                    ['Out of hours above base', `${gbp(total((s) => s.metrics.oohExcessCost))} a year`],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                      <p className="text-xl font-bold text-slate-800 tabular-nums">{value}</p>
                      <p className="text-xs font-medium text-slate-600 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
                  <div className="px-6 pt-5 pb-2">
                    <h2 className="text-base font-semibold text-slate-800">Where to start</h2>
                    <p className="text-sm text-slate-500">
                      Ranked by out-of-hours use above base load: energy used when the building should be
                      closed, usually the cheapest to remove. Click a site to set its type and hours and see
                      the full analysis.
                    </p>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                        <th className="px-6 py-2 font-medium">Site</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium text-right">kWh a year</th>
                        <th className="px-3 py-2 font-medium text-right">Annual cost</th>
                        <th className="px-3 py-2 font-medium text-right">Base kW</th>
                        <th className="px-3 py-2 font-medium text-right">Out of hours</th>
                        <th className="px-3 py-2 font-medium text-right">Above base £/yr</th>
                        <th className="px-3 py-2 font-medium">Findings</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {ranked.map((s) => {
                        const m = s.metrics;
                        const counts = (['high', 'medium', 'low'] as const)
                          .map((l) => [l, m.findings.filter((f) => f.level === l).length] as const)
                          .filter(([, c]) => c > 0);
                        return (
                          <tr
                            key={s.id}
                            onClick={() => setSelected(s.id)}
                            className="border-b border-slate-100 last:border-0 hover:bg-blue-50/50 cursor-pointer"
                          >
                            <td className="px-6 py-3">
                              <p className="font-semibold text-slate-800">{s.settings.name}</p>
                              <p className="text-xs text-slate-400">{m.days} days{s.warnings.length ? ' · has data notes' : ''}</p>
                            </td>
                            <td className="px-3 py-3 text-slate-600">{SITE_TYPES[s.settings.type].label}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{m.annualKwh.toLocaleString('en-GB')}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{gbp(m.annualCost)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{m.baseKw.toLocaleString('en-GB')}</td>
                            <td className="px-3 py-3 text-right tabular-nums">
                              {m.hasOutOfHours ? `${Math.round(m.oohShare * 100)}%` : '24-7'}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums font-semibold text-slate-800">
                              {m.hasOutOfHours ? gbp(m.oohExcessCost) : '-'}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex gap-1">
                                {counts.length ? counts.map(([l, c]) => (
                                  <span key={l} className={`whitespace-nowrap text-[11px] font-semibold border rounded px-1.5 py-0.5 ${LEVEL_UI[l].chip} ${LEVEL_UI[l].text}`}>
                                    {c} {LEVEL_UI[l].label}
                                  </span>
                                )) : <span className="text-xs text-slate-400">None</span>}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right whitespace-nowrap">
                              <button
                                onClick={(e) => { e.stopPropagation(); void forgetSession(s.id).then(refresh); }}
                                className="text-xs text-slate-400 hover:text-red-600"
                                aria-label={`Remove ${s.settings.name}`}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-400">
                  All sites start as Office / commercial at the default rate. Open each one to set its building
                  type and opening hours, or the out-of-hours figures will be wrong for schools, hospitals and
                  leisure sites.
                </p>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
