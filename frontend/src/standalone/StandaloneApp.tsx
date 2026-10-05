/**
 * The offline app: a portfolio of sites, one meter file each, ranked by
 * opportunity, with the full HH Analyser behind every site.
 */
import { useCallback, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import HHAnalyser, { type ReportFilters } from '../components/analyser/HHAnalyser';
import FullPeriodChart from './FullPeriodChart';
import { AMERESCO_LOGO } from '../local/brand';
import {
  clearAll, loadCustomerLogo, removeCustomerLogo, downloadAnalyserChartsZip, downloadExcel, downloadPortfolioReport, downloadSiteSummary, forgetSession, friendlyError, getDefaultRate,
  listSites, setDefaultRate, updateSiteSettings, uploadHHFile, type SiteSummary,
} from '../local/localClient';
import { SITE_TYPES } from '../local/findings';
import { rankSites } from '../local/pdf/portfolioReport';
import FindingsPanel from './FindingsPanel';
import { LEVEL_UI } from './levelUi';
import SiteSettingsPanel from './SiteSettingsPanel';
import CarpetPlot from './CarpetPlot';
import QualityPanel, { VerdictChip } from './QualityPanel';
import HeadroomPanel from './HeadroomPanel';
import EditionDialog from './EditionDialog';
import BulkSettingsPanel from './BulkSettingsPanel';
import { getCustomerLogo } from '../local/pdf/common';

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

/**
 * `internal` is the engineers' tool. `customer` is the locked edition a
 * customer unlocks with a password: their sites only, no uploads or
 * removals, site settings read-only except the unit rate, summary exports.
 */
export default function StandaloneApp({ mode = 'internal', customer = '' }: {
  mode?: 'internal' | 'customer';
  customer?: string;
}) {
  const isCustomer = mode === 'customer';
  const [sites, setSites] = useState<SiteSummary[]>(() => (isCustomer ? listSites() : []));
  const [showEdition, setShowEdition] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ file: string; message: string }[]>([]);
  const [rate, setRate] = useState(getDefaultRate());
  const [title, setTitle] = useState(customer);
  const [customerLogo, setCustomerLogo] = useState<string | null>(() => getCustomerLogo()?.dataUrl ?? null);
  const [exporting, setExporting] = useState<string | null>(null);

  const refresh = useCallback(() => setSites(listSites()), []);

  function startAgain() {
    const ok = window.confirm(
      'Clear all sites and settings and start again? Anything not exported will be lost.',
    );
    if (!ok) return;
    clearAll();
    setSites([]);
    setSelected(null);
    setErrors([]);
    setTitle('');
    setCustomerLogo(null);
    setRate(getDefaultRate());
  }

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

  const ranked = useMemo(() => rankSites(sites), [sites]);
  const site = sites.find((s) => s.id === selected) ?? null;
  // Must keep its identity between renders. The analyser treats a new one as
  // a new data source and re-fetches every chart (and resets its filters),
  // which is what made every keystroke on this page lag.
  const downloadSeparate = useCallback(
    (opts: ReportFilters) => downloadAnalyserChartsZip(selected ?? '', opts),
    [selected],
  );
  const runForSite = useCallback(
    <T,>(job: (id: string) => Promise<T>) => job(selected ?? ''),
    [selected],
  );
  const total = (f: (s: SiteSummary) => number) => ranked.reduce((a, s) => a + f(s), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-4">
            <img src={AMERESCO_LOGO} alt="Ameresco" className="h-10 w-auto" />
            <span className="h-9 w-px bg-slate-200" aria-hidden />
            <div>
              <p className="text-xl font-bold text-[#0065a5] leading-tight">Data Analyser</p>
              <p className="text-xs text-slate-500">{isCustomer ? `${customer} energy dashboard` : 'Half-hourly energy data'}</p>
            </div>
            {isCustomer && customerLogo && (
              <>
                <span className="h-9 w-px bg-slate-200" aria-hidden />
                <img src={customerLogo} alt={customer} className="h-10 max-w-40 object-contain" />
              </>
            )}
          </div>
          <div className="flex-1" />
          <span className="hidden sm:inline text-xs text-slate-500 bg-slate-100 rounded-full px-3 py-1">
            Offline · data stays on this computer
          </span>
          {isCustomer && (
            <button
              onClick={() => window.location.reload()}
              title="Close the dashboard; the password is needed to open it again"
              className="text-sm font-medium text-slate-600 border border-slate-300 hover:border-[#0065a5] rounded-lg px-4 py-1.5"
            >
              Lock
            </button>
          )}
          {!isCustomer && sites.length > 0 && (
            <button
              onClick={startAgain}
              className="text-sm font-medium text-slate-600 hover:text-red-700 border border-slate-300 hover:border-red-300 rounded-lg px-4 py-1.5 transition-colors"
            >
              Clear all data
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {site ? (
          <>
            <button onClick={() => setSelected(null)} className="text-sm text-[#0065a5] hover:text-[#00528a] font-medium">
              ← All sites
            </button>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">{site.settings.name}</h1>
                <p className="text-sm text-slate-500">
                  {site.filename} · {site.metrics.days} days · {SITE_TYPES[site.settings.type].label}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={!!exporting}
                  onClick={() => run('Summary', () => downloadSiteSummary(site.id))}
                  title="One page: costs, findings, data quality and the year at a glance"
                  className={`${btn} bg-[#0065a5] hover:bg-[#00528a] text-white`}
                >
                  {exporting === 'Summary' ? 'Building PDF…' : 'Site summary (PDF)'}
                </button>
                <button
                  disabled={!!exporting}
                  onClick={() => run('Excel', () => downloadExcel(site.settings.name, [site.id]))}
                  className={`${btn} bg-white border border-slate-300 text-slate-700 hover:border-blue-400`}
                >
                  {exporting === 'Excel' ? 'Building…' : 'Export to Excel'}
                </button>
              </div>
            </div>
            {site.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-800">
                {site.warnings.map((w, i) => <p key={i}>{w}</p>)}
              </div>
            )}
            <SiteSettingsPanel
              settings={site.settings}
              defaultRate={rate}
              locked={isCustomer}
              onChange={(s) => { updateSiteSettings(site.id, s); refresh(); }}
            />
            <QualityPanel report={site.quality} />
            <FindingsPanel metrics={site.metrics} />
            <HeadroomPanel
              settings={site.settings}
              headroom={site.headroom}
              locked={isCustomer}
              onChange={(s) => { updateSiteSettings(site.id, s); refresh(); }}
            />
            <CarpetPlot frame={site.frame} />
            <FullPeriodChart frame={site.frame} />
            <HHAnalyser
              key={site.id}
              sessionId={site.id}
              runWithSession={runForSite}
              onDownloadSeparate={downloadSeparate}
            />
          </>
        ) : (
          <>
            {!isCustomer && <Uploader onFiles={addFiles} busy={busy} />}

            {errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 space-y-1">
                {errors.map((e, i) => <p key={i}><strong>{e.file}:</strong> {e.message}</p>)}
              </div>
            )}

            {ranked.length > 0 && (
              <>
                <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex flex-wrap items-end gap-4">
                  <div className="flex-1 min-w-48">
                    <label className="block text-xs font-medium text-slate-600 mb-1">{isCustomer ? 'Customer' : 'Client or estate name'}</label>
                    {isCustomer ? (
                      <p className="text-sm font-semibold text-slate-800 py-1.5">{customer}</p>
                    ) : (
                      <input
                        value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Appears on the reports"
                        className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    )}
                  </div>
                  {!isCustomer && <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Customer logo (on every PDF)</label>
                    {customerLogo ? (
                      <div className="flex items-center gap-2 border border-slate-300 rounded-lg px-2 py-1 bg-white">
                        <img src={customerLogo} alt="Customer logo" className="h-6 max-w-28 object-contain" />
                        <button
                          onClick={() => { removeCustomerLogo(); setCustomerLogo(null); }}
                          className="text-xs text-slate-500 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <label className="inline-block cursor-pointer text-sm border border-dashed border-slate-300 hover:border-[#0065a5] rounded-lg px-3 py-1.5 text-slate-600">
                        Add logo…
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (!file) return;
                            try {
                              const logo = await loadCustomerLogo(file);
                              setCustomerLogo(logo.dataUrl);
                            } catch (err) {
                              setErrors([{ file: file.name, message: friendlyError(err, 'Could not read that logo.') }]);
                            }
                          }}
                        />
                      </label>
                    )}
                  </div>}
                  <div className="w-44">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Default rate (p/kWh)</label>
                    <input
                      type="number" min={0} step="any" value={rate}
                      onChange={(e) => { const v = Number(e.target.value); setRate(v); setDefaultRate(v); refresh(); }}
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <button
                    disabled={!!exporting}
                    onClick={() => run('Portfolio PDF', () => downloadPortfolioReport(title))}
                    className={`${btn} bg-[#0065a5] hover:bg-[#00528a] text-white`}
                  >
                    {exporting === 'Portfolio PDF' ? 'Building PDF…' : 'Portfolio report (PDF)'}
                  </button>
                  <button
                    disabled={!!exporting}
                    onClick={() => run('Excel', () => downloadExcel(title))}
                    className={`${btn} bg-white border border-slate-300 text-slate-700 hover:border-blue-400`}
                  >
                    {exporting === 'Excel' ? 'Building…' : isCustomer ? 'Summary to Excel' : 'Export to Excel'}
                  </button>
                  {!isCustomer && (
                    <button
                      onClick={() => setShowEdition(true)}
                      title="A locked, password-protected copy of this dashboard for the customer"
                      className={`${btn} bg-white border border-[#008540] text-[#008540] hover:bg-green-50`}
                    >
                      Customer edition…
                    </button>
                  )}
                </div>
                {showEdition && (
                  <EditionDialog
                    initialCustomer={title}
                    siteCount={ranked.length}
                    onClose={() => setShowEdition(false)}
                  />
                )}

                {!isCustomer && (
                  <BulkSettingsPanel
                    siteCount={ranked.length}
                    onApply={({ type, hours }) => {
                      for (const x of sites) updateSiteSettings(x.id, { ...x.settings, type, hours: structuredClone(hours) });
                      refresh();
                    }}
                  />
                )}

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
                      closed, usually the cheapest to remove. Click a site to
                      {isCustomer ? ' see its full analysis and download its reports.' : ' set its type and hours and see the full analysis.'}
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
                        <th className="px-3 py-2 font-medium text-right">Headroom kW</th>
                        <th className="px-3 py-2 font-medium">Data</th>
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
                            <td className="px-3 py-3 text-right tabular-nums">
                              {s.headroom ? (
                                <span className={s.headroom.firmHeadroomKw < 0 ? 'text-[#b42c2c] font-semibold' : ''}>
                                  {Math.round(s.headroom.firmHeadroomKw).toLocaleString('en-GB')}
                                </span>
                              ) : <span className="text-slate-300" title="Enter the supply capacity on the site page">-</span>}
                            </td>
                            <td className="px-3 py-3"><VerdictChip verdict={s.quality.verdict} /></td>
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
                              {!isCustomer && <button
                                onClick={(e) => { e.stopPropagation(); void forgetSession(s.id).then(refresh); }}
                                className="text-xs text-slate-400 hover:text-red-600"
                                aria-label={`Remove ${s.settings.name}`}
                              >
                                Remove
                              </button>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-400">
                  {isCustomer
                    ? 'Prepared by Ameresco. Costs use the unit rate shown and are what each pattern costs now, not a guaranteed saving.'
                    : 'All sites start as Office / commercial at the default rate. Open each one to set its building type and opening hours, or the out-of-hours figures will be wrong for schools, hospitals and leisure sites.'}
                </p>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
