/**
 * The offline app: a portfolio of meters, one file each, ranked by the cost
 * associated with closed-hours use, with an estate-wide opportunities list,
 * like-for-like comparisons, and the full analysis behind every site.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { AMERESCO_LOGO } from '../local/brand';
import {
  clearAll, countedInTotals, downloadExcel, downloadPortfolioReport, downloadSitesTable, editionShowsNotes, forgetSession,
  friendlyError, getDefaultRate, getTitle, listSites, loadCustomerLogo, openProject, removeCustomerLogo, saveProject,
  setDefaultRate, setTitle as storeTitle, hasUnsavedCustomerChanges, editionEditedAt, resetCustomerEdition, saveCustomerEditionCopy, updateSiteSettings, uploadHHFile, type SiteSummary,
} from '../local/localClient';
import { SITE_TYPES } from '../local/site';
import type { SiteTab } from '../local/findings';
import { rankSites } from '../local/pdf/portfolioReport';
import { getCustomerLogo } from '../local/pdf/common';
import { firstDir, SITE_COLUMNS, sortSites, type ColumnKey, type SortState } from '../local/siteTable';
import { overlapWarnings } from '../local/estate';
import { LEVEL_UI } from './levelUi';
import { VerdictChip } from './QualityPanel';
import EditionDialog from './EditionDialog';
import CarbonFields from './CarbonFields';
import { isMultiYear } from '../local/period';
import { IS_STANDARD, PRODUCT_FULL } from '../local/edition';
import { fmtDayMonYear } from '../local/dates';
import BulkSettingsPanel from './BulkSettingsPanel';
import { mergeCalendar } from '../local/calendar';
import SiteView from './SiteView';
import OpportunitiesView from './OpportunitiesView';
import EstateView from './EstateView';
import { Hero, Note, ProductMark, StatPanel, Tabs } from './ui';
import { btn, btnPrimary, btnSecondary, gbp, num } from './format';

function Uploader({ onFiles, busy, compact = false }: { onFiles: (f: File[]) => void; busy: string | null; compact?: boolean }) {
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
      className={`border-2 border-dashed rounded-xl text-center cursor-pointer transition-colors ${compact ? 'px-5 py-3' : 'px-6 py-8'} ${
        isDragActive ? 'border-[#0065a5] bg-[#e6f0f7]' : 'border-slate-300 hover:border-[#0065a5] bg-white'
      } ${busy ? 'opacity-60 cursor-wait' : ''}`}
    >
      <input {...getInputProps()} />
      <p className={`text-slate-900 font-semibold ${compact ? 'text-sm' : ''}`}>
        {busy ?? (isDragActive ? 'Drop the meter files here' : compact ? '+ Add more meter files (drag and drop or click)' : 'Drag and drop HH meter files here')}
      </p>
      {!compact && <p className="text-slate-500 text-sm mt-1">
        or click to browse. One file per meter. Day-per-row, day-per-column or timestamped: .xlsx, .xls, .csv
      </p>}
    </div>
  );
}

type View = 'sites' | 'opportunities' | 'estate';

/**
 * `internal` is the engineers' tool. `customer` is the locked edition a
 * customer unlocks with a password: their sites only, no uploads or
 * removals, summary exports only. The customer can change what they know
 * best (hours, closures, rates, capacity, carbon, exclusions, scenarios) and
 * save that as a new copy; action tracking and the analysis method stay
 * as Ameresco set them, and reports then say they include customer changes.
 */
export default function StandaloneApp({ mode = 'internal', customer = '' }: {
  mode?: 'internal' | 'customer';
  customer?: string;
}) {
  const isCustomer = mode === 'customer';
  const [sites, setSites] = useState<SiteSummary[]>(() => (isCustomer ? listSites() : []));
  const [showEdition, setShowEdition] = useState(false);
  const [selected, setSelected] = useState<{ id: string; tab?: SiteTab; date?: string; nav: number } | null>(null);
  const [view, setView] = useState<View>('sites');
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ file: string; message: string }[]>([]);
  const [rate, setRate] = useState(getDefaultRate());
  const [title, setTitleState] = useState(isCustomer ? customer : getTitle());
  // Bumped when the carbon factor changes from outside the fields (project opened, undo, clear).
  const [carbonKey, setCarbonKey] = useState(0);
  const [customerLogo, setCustomerLogo] = useState<string | null>(() => getCustomerLogo()?.dataUrl ?? null);
  const [exporting, setExporting] = useState<string | null>(null);

  const refresh = useCallback(() => setSites(listSites()), []);
  const unsaved = isCustomer && hasUnsavedCustomerChanges();
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  function undoCustomerChanges() {
    if (!window.confirm('Undo every change made since this file was opened?')) return;
    resetCustomerEdition();
    setSelected(null);
    setRate(getDefaultRate());
    setCarbonKey((k) => k + 1);
    refresh();
  }
  const setTitle = (t: string) => { setTitleState(t); storeTitle(t); };

  function startAgain() {
    const ok = window.confirm('Clear all sites and settings and start again? Anything not saved as a project or exported will be lost.');
    if (!ok) return;
    clearAll();
    setSites([]);
    setSelected(null);
    setErrors([]);
    setTitleState('');
    setCustomerLogo(null);
    setCarbonKey((k) => k + 1);
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

  async function openProjectFile(file: File) {
    if (sites.length && !window.confirm('Opening a project replaces everything loaded now. Continue?')) return;
    setBusy(`Opening ${file.name}…`);
    try {
      const p = await openProject(file);
      setTitleState(p.title);
      setRate(getDefaultRate());
      setCarbonKey((k) => k + 1);
      setCustomerLogo(getCustomerLogo()?.dataUrl ?? null);
      setSelected(null);
      setErrors([]);
    } catch (e) {
      setErrors([{ file: file.name, message: friendlyError(e, 'Could not open that project.') }]);
    } finally {
      setBusy(null);
      refresh();
    }
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
  const [sort, setSort] = useState<SortState | null>(null);
  const shown = useMemo(() => {
    let r = 0;
    return sortSites(ranked.map((s) => ({ ...s, rank: s.metrics.rankValue === null ? null : ++r })), sort);
  }, [ranked, sort]);
  function sortBy(key: ColumnKey) {
    const col = SITE_COLUMNS.find((c) => c.key === key)!;
    setSort((cur) => (cur?.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDir(col) }));
  }
  const openSite = useCallback((id: string, tab?: SiteTab, date?: string) => {
    setSelected((cur) => ({ id, tab, date, nav: (cur?.nav ?? 0) + 1 }));
    window.scrollTo({ top: 0 });
  }, []);
  const site = sites.find((s) => s.id === selected?.id) ?? null;
  const counted = sites.filter(countedInTotals);
  const annualised = counted.filter((s) => s.metrics.annual);
  const sum = (list: SiteSummary[], f: (s: SiteSummary) => number) => list.reduce((a, s) => a + f(s), 0);
  const warnings = useMemo(() => overlapWarnings(sites), [sites]);
  const multiYear = sites.filter((x) => isMultiYear(x.period.fileFrom, x.period.fileTo));
  const allLast12 = multiYear.every((x) => (x.settings.period?.mode ?? 'last12') === 'last12');
  const allFrom = sites.map((s) => s.frame.dates[0]).filter(Boolean).sort()[0] ?? '';
  const allTo = sites.map((s) => s.frame.dates[s.frame.dates.length - 1]).filter(Boolean).sort().reverse()[0] ?? '';

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="sticky top-0 z-40 bg-white border-b border-slate-300 px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-4">
            <img src={AMERESCO_LOGO} alt="Ameresco" className="h-10 w-auto" />
            <span className="h-9 w-px bg-slate-300" aria-hidden />
            <div>
              <ProductMark />
              <p className="text-xs text-slate-500">{isCustomer ? `${customer} energy dashboard` : 'Half-hourly energy data'}</p>
            </div>
            {isCustomer && customerLogo && (
              <>
                <span className="h-9 w-px bg-slate-300" aria-hidden />
                <img src={customerLogo} alt={customer} className="h-10 max-w-40 object-contain" />
              </>
            )}
          </div>
          <div className="flex-1" />
          <span className="hidden 2xl:inline-flex items-center gap-1.5 text-xs font-semibold text-[#008540] bg-[#ebf6ef] rounded-full px-3 py-1"><span className="w-1.5 h-1.5 rounded-full bg-[#008540]" aria-hidden />Offline · data stays on this computer</span>
          {!isCustomer && !IS_STANDARD && (
            <>
              <label className={`${btnSecondary} cursor-pointer !py-1.5`} title="Open a saved project file (.adproject)">
                Open project
                <input type="file" accept=".adproject" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openProjectFile(f); }} />
              </label>
              {sites.length > 0 && (
                <button disabled={!!exporting} onClick={() => run('Project', saveProject)} className={`${btnSecondary} !py-1.5`}
                  title="Save everything (readings, settings, calendars, reviews, actions, scenarios) to carry on later">
                  {exporting === 'Project' ? 'Saving…' : 'Save project'}
                </button>
              )}
            </>
          )}
          {isCustomer && (
            <button onClick={() => { if (!unsaved || window.confirm('Lock without saving your changes? They will be lost.')) window.location.reload(); }} title="Close the dashboard; the password is needed to open it again"
              className="text-sm font-semibold text-slate-900 border border-slate-300 hover:border-slate-900 rounded-lg px-4 py-2">Lock</button>
          )}
          {!isCustomer && sites.length > 0 && (
            <button onClick={startAgain} className="text-sm font-semibold text-slate-700 hover:text-red-700 border border-slate-300 hover:border-red-300 rounded-lg px-4 py-2 transition-colors">
              Clear all data
            </button>
          )}
        </div>
      </header>

      {isCustomer && (
        <div className={`border-b px-6 py-2.5 ${unsaved ? 'bg-[#fdf6e7] border-[#e8c77a]' : 'bg-[#e6f0f7] border-[#b9d3ef]'}`}>
          <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-64 text-sm text-slate-700">
              <p className="font-semibold text-slate-800">
                {unsaved ? 'You have changed this dashboard' : editionEditedAt() ? 'This copy includes your saved changes' : 'You can adjust this dashboard'}
              </p>
              <p className="text-slate-600">
                Change opening hours and closures, rates and time bands, carbon factor, supply capacity, excluded readings and savings scenarios.
                Downloads use your figures and say they include your changes. {unsaved ? 'Save them to keep them; closing the page loses them.' : ''}
              </p>
            </div>
            <button disabled={!!exporting || !unsaved} onClick={() => run('Save', async () => { await saveCustomerEditionCopy(); refresh(); })}
              className={`${btnPrimary} disabled:opacity-40`} title="Download a new copy of this dashboard with your changes, locked with the same password">
              {exporting === 'Save' ? 'Saving…' : 'Save my changes'}
            </button>
            <button disabled={!unsaved} onClick={undoCustomerChanges} className={`${btnSecondary} disabled:opacity-40`}>Undo my changes</button>
          </div>
        </div>
      )}
      <main className="w-full max-w-7xl mx-auto px-6 py-8 space-y-6 flex-1">
        {errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 space-y-1">
            {errors.map((e, i) => <p key={i}><strong>{e.file}:</strong> {e.message}</p>)}
          </div>
        )}
        {site && selected ? (
          <SiteView
            key={`${site.id}-${selected.nav}`}
            site={site} rate={rate} locked={isCustomer} showNotes={!isCustomer || editionShowsNotes()}
            refresh={refresh} onBack={() => setSelected(null)} run={run}
            initial={{ tab: selected.tab, date: selected.date }}
          />
        ) : (
          <>
            {ranked.length === 0 && !isCustomer && (
              <Hero
                eyebrow="Ameresco UK · Half-hourly electricity · Works offline"
                title={<>Where is this site's<br className="hidden md:block" /> energy going?</>}
                sub="Drop in half-hourly meter files. You get when each site uses power, what runs when it should be shut, the costs that go with it, and reports you can hand to the customer."
                aside={<div className="rounded-xl bg-white border border-slate-300 p-6 shadow-md space-y-3">
                  <p className="text-lg font-bold text-slate-900">Start with your meter files</p>
                  <Uploader onFiles={addFiles} busy={busy} />
                  <p className="text-xs text-slate-500">One file per meter. Several at once is fine. Nothing leaves this computer.</p>
                </div>}
              >
                <div className="grid sm:grid-cols-3 gap-5 border-t border-slate-300 pt-5 mt-6 max-w-2xl">
                  {[
                    ['Findings first', 'Ranked by cost, with the evidence behind each one'],
                    ['Ready to share', 'Site and portfolio PDFs, Excel and a customer edition'],
                    ['Stays on this laptop', 'No server, no login, no internet needed'],
                  ].map(([h, t]) => (
                    <div key={h}><p className="text-sm font-bold text-slate-900">{h}</p><p className="text-xs text-slate-600 mt-1">{t}</p></div>
                  ))}
                </div>
              </Hero>
            )}

            {ranked.length > 0 && (
              <>
                <Hero
                  eyebrow={isCustomer ? 'Energy dashboard prepared by Ameresco' : 'Portfolio'}
                  title={title || (isCustomer ? customer : 'All sites')}
                  sub={`${sites.length} meter${sites.length === 1 ? '' : 's'}${allFrom ? ` · data from ${fmtDayMonYear(allFrom)} to ${fmtDayMonYear(allTo)}` : ''}. Ranked by the cost of energy used when buildings should be shut.`}
                  aside={(
                    <StatPanel
                      lead={{
                        label: 'Closed-hours excess a year',
                        value: annualised.length ? gbp(sum(annualised, (s) => s.metrics.excess?.annual?.cost ?? 0)) : 'n/a',
                        hint: 'Associated energy cost, not a guaranteed saving; overlaps other findings.',
                      }}
                      items={[
                        { label: 'Energy cost a year', value: annualised.length ? gbp(sum(annualised, (s) => s.metrics.annual!.cost)) : 'n/a' },
                        { label: 'Observed', value: `${num(sum(counted, (s) => s.metrics.observed.kwh) / 1000, 0)} MWh` },
                        { label: 'Meters', value: `${counted.length}${counted.length < sites.length ? ` of ${sites.length}` : ''}` },
                      ]}
                      note={`${annualised.length} of ${counted.length} meters annualised${counted.length < sites.length ? '; submeters left out of totals' : ''}.`}
                    />
                  )}
                >
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button disabled={!!exporting} onClick={() => run('Portfolio PDF', () => downloadPortfolioReport(title))} className={btnPrimary}>
                      {exporting === 'Portfolio PDF' ? 'Building PDF…' : 'Portfolio report (PDF)'}
                    </button>
                    <button disabled={!!exporting} onClick={() => run('Excel', () => downloadExcel(title))} className={btnSecondary}>
                      {exporting === 'Excel' ? 'Building…' : isCustomer ? 'Summary to Excel' : 'Export to Excel'}
                    </button>
                    {!isCustomer && (
                      <button onClick={() => setShowEdition(true)} title="A locked, password-protected copy of this dashboard for the customer"
                        className={`${btn} bg-white border border-[#008540] text-[#008540] hover:bg-[#ebf6ef]`}>Customer edition…</button>
                    )}
                  </div>
                </Hero>
                {!isCustomer && <Uploader onFiles={addFiles} busy={busy} compact />}
                {showEdition && <EditionDialog initialCustomer={title} siteCount={ranked.length} onClose={() => setShowEdition(false)} />}

                {!isCustomer && (
                  <BulkSettingsPanel
                    siteCount={ranked.length} dataFrom={allFrom} dataTo={allTo}
                    unconfirmed={sites.filter((x) => !x.settings.calendar.confirmed).length}
                    onApply={({ type, calendar }) => {
                      for (const x of sites) updateSiteSettings(x.id, { ...x.settings, type, calendar: mergeCalendar(x.settings.calendar, calendar) });
                      refresh();
                    }}
                  />
                )}

                <div className="bg-white rounded-xl border border-slate-300 px-6 py-5 space-y-4">
                  <h2 className="text-lg font-bold text-slate-900">Report details</h2>
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="flex-1 min-w-48">
                      <label className="block text-xs font-medium text-slate-600 mb-1">{isCustomer ? 'Customer' : 'Client or estate name'}</label>
                      {isCustomer ? <p className="text-sm font-semibold text-slate-800 py-1.5">{customer}</p> : (
                        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Appears on the reports"
                          className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      )}
                    </div>
                    {!isCustomer && <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Customer logo (on every PDF)</label>
                      {customerLogo ? (
                        <div className="flex items-center gap-2 border border-slate-300 rounded-lg px-2 py-1 bg-white">
                          <img src={customerLogo} alt="Customer logo" className="h-6 max-w-28 object-contain" />
                          <button onClick={() => { removeCustomerLogo(); setCustomerLogo(null); }} className="text-xs text-slate-500 hover:text-red-700">Remove</button>
                        </div>
                      ) : (
                        <label className="inline-block cursor-pointer text-sm border border-dashed border-slate-300 hover:border-[#0065a5] rounded-lg px-3 py-1.5 text-slate-600">
                          Add logo…
                          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (!file) return;
                              try { setCustomerLogo((await loadCustomerLogo(file)).dataUrl); } catch (err) {
                                setErrors([{ file: file.name, message: friendlyError(err, 'Could not read that logo.') }]);
                              }
                            }} />
                        </label>
                      )}
                    </div>}
                    <div className="w-40">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Default flat rate (p/kWh)</label>
                      <input type="number" min={0} step="any" value={rate}
                        onChange={(e) => { const v = Number(e.target.value); setRate(v); setDefaultRate(v); refresh(); }}
                        className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    </div>
                  </div>
                  <CarbonFields key={carbonKey} onChange={refresh} />
                </div>
                {warnings.length > 0 && <Note tone="warn">{warnings.map((w, i) => <p key={i}>{w}</p>)}</Note>}
                {multiYear.length > 0 && (
                  <div className="rounded-xl border border-[#b9d3ef] bg-[#e6f0f7] px-5 py-3.5 flex flex-wrap items-center gap-3 text-sm text-slate-700">
                    <p className="flex-1 min-w-64">
                      <strong>{multiYear.length} file{multiYear.length > 1 ? 's hold' : ' holds'} more than a year of data.</strong>{' '}
                      Each site is analysed over its own chosen period ({allLast12 ? 'the last 12 months of its file' : 'periods differ'}); change one site at the top of its page.
                      Trends over time still use the whole file.
                    </p>
                    {!isCustomer && (
                      <span className="flex gap-2">
                        <button type="button" className={btnSecondary} onClick={() => { for (const x of sites) updateSiteSettings(x.id, { ...x.settings, period: { mode: 'last12' } }); refresh(); }}>Last 12 months for all</button>
                        <button type="button" className={btnSecondary} onClick={() => { for (const x of sites) updateSiteSettings(x.id, { ...x.settings, period: { mode: 'all' } }); refresh(); }}>Whole files for all</button>
                      </span>
                    )}
                  </div>
                )}

                {!IS_STANDARD && <Tabs<View>
                  sticky label="Portfolio views"
                  tabs={[
                    { key: 'sites', label: 'Where to start' },
                    { key: 'opportunities', label: 'Opportunities', badge: sites.reduce((a, s) => a + s.metrics.findings.filter((f) => f.level === 'high').length, 0) },
                    { key: 'estate', label: 'Estate comparison' },
                  ]}
                  value={view} onChange={setView}
                />}

                {view === 'opportunities' && (
                  <OpportunitiesView sites={sites} locked={isCustomer} showNotes={!isCustomer || editionShowsNotes()} refresh={refresh} openSite={openSite} />
                )}
                {view === 'estate' && <EstateView sites={sites} openSite={(id) => openSite(id)} />}
                {view === 'sites' && (
                  <div className="bg-white rounded-xl border border-slate-300 overflow-x-auto">
                    <div className="px-6 pt-5 pb-2 flex flex-wrap items-start justify-between gap-3">
                      <div className="max-w-3xl">
                        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Where to start</h2>
                        <p className="text-sm text-slate-600 mt-1">
                          Ranked by the estimated annual cost associated with closed-hours use above the reference: energy used when the
                          building should be closed, beyond what never switches off. An associated cost, not a guaranteed saving. Meters
                          with too little data to annualise are listed after, unranked. Click a heading to sort, or # to go back to the ranking.
                        </p>
                      </div>
                      <button disabled={!!exporting} onClick={() => run('Table', () => downloadSitesTable(title, shown))} className={btnSecondary}>
                        {exporting === 'Table' ? 'Building…' : 'Table to Excel'}
                      </button>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-slate-600 border-y border-slate-300 bg-slate-50">
                          {SITE_COLUMNS.filter((c) => c.key !== 'type').map((c) => {
                            const active = sort?.key === c.key || (!sort && c.key === 'rank');
                            const arrow = !active ? '' : !sort ? ' ▲' : sort.dir === 'asc' ? ' ▲' : ' ▼';
                            const right = c.numeric && c.key !== 'findings';
                            return (
                              <th key={c.key} aria-sort={active && sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                                className={`py-2.5 font-semibold ${c.key === 'rank' ? 'pl-5 pr-1' : 'px-1.5'} ${right ? 'text-right' : ''}`}>
                                <button onClick={() => sortBy(c.key)} title={c.key === 'rank' ? 'Back to the ranking' : `Sort by ${c.label}`}
                                  className={`whitespace-nowrap hover:text-slate-800 ${active ? 'text-slate-800 font-semibold' : ''}`}>
                                  {c.short ?? c.label}{arrow}
                                </button>
                              </th>
                            );
                          })}
                          <th className="px-1.5 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((s) => {
                          const m = s.metrics;
                          const counts = (['high', 'medium', 'low'] as const)
                            .map((l) => [l, m.findings.filter((f) => f.level === l).length] as const).filter(([, c]) => c > 0);
                          return (
                            <tr key={s.id} onClick={() => openSite(s.id)} className="border-b border-slate-200 last:border-0 hover:bg-[#e6f0f7]/60 cursor-pointer">
                              <td className="pl-5 pr-1 py-3 text-right tabular-nums text-slate-400">{s.rank ?? '-'}</td>
                              <td className="px-1.5 py-3 min-w-44">
                                <p className="font-bold text-slate-900">{s.settings.name}</p>
                                <p className="text-xs text-slate-500">
                                  {[SITE_TYPES[s.settings.type].label, s.settings.meterId, s.settings.role === 'sub' ? 'submeter' : '',
                                    s.settings.group, s.settings.calendar.confirmed ? '' : 'hours unconfirmed'].filter(Boolean).join(' · ')}
                                </p>
                              </td>
                              <td className="px-1.5 py-3 text-right tabular-nums" title={`${m.coverage.from} to ${m.coverage.to}, ${(m.coverage.share * 100).toFixed(0)}% coverage`}>
                                {num(m.coverage.validDays)}<p className="text-[10px] text-slate-400">{(m.coverage.share * 100).toFixed(0)}% cover</p>
                              </td>
                              <td className="px-1.5 py-3 text-right tabular-nums">{num(m.observed.kwh)}</td>
                              <td className="px-1.5 py-3 text-right tabular-nums">{m.annual ? num(m.annual.kwh) : <span className="text-slate-300" title="Under 180 valid days">-</span>}</td>
                              <td className="px-1.5 py-3 text-right tabular-nums">{m.annual ? gbp(m.annual.cost) : <span className="text-slate-300">-</span>}</td>
                              <td className="px-1.5 py-3 text-right tabular-nums">{num(m.baseAll.kw, 1)}</td>
                              <td className="px-1.5 py-3 text-right tabular-nums">{m.hasClosed ? `${Math.round(m.closed.share * 100)}%` : '24-7'}</td>
                              <td className="px-1.5 py-3 text-right tabular-nums font-bold text-[#008540]">
                                {m.excess?.annual ? gbp(m.excess.annual.cost) : m.excess ? <span className="text-slate-400 font-normal" title="Observed period, not annualised">{gbp(m.excess.observed.cost)}*</span> : '-'}
                              </td>
                              <td className="px-1.5 py-3 text-right tabular-nums">
                                {s.headroom ? <span className={s.headroom.firmHeadroomKw < 0 ? 'text-[#b42c2c] font-semibold' : ''}>{num(s.headroom.firmHeadroomKw)}</span>
                                  : <span className="text-slate-300" title="Enter the supply capacity on the site's Capacity tab">-</span>}
                              </td>
                              <td className="px-1.5 py-3"><VerdictChip verdict={s.quality.verdict} /></td>
                              <td className="px-1.5 py-3">
                                <div className="flex gap-1">
                                  {counts.length ? counts.map(([l, c]) => (
                                    <span key={l} className={`whitespace-nowrap text-[11px] font-semibold border rounded px-1.5 py-0.5 ${LEVEL_UI[l].chip} ${LEVEL_UI[l].text}`}>{c} {LEVEL_UI[l].label}</span>
                                  )) : <span className="text-xs text-slate-400">None</span>}
                                </div>
                              </td>
                              <td className="px-1.5 py-3 text-right whitespace-nowrap">
                                {!isCustomer && <button onClick={(e) => { e.stopPropagation(); void forgetSession(s.id).then(refresh); }}
                                  className="text-xs text-slate-400 hover:text-red-600" aria-label={`Remove ${s.settings.name}`}>Remove</button>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="text-xs text-slate-400 px-6 py-3">
                      * Observed period only (not enough data to annualise). Observed kWh covers each meter's own period, so periods differ.
                      Base kW is the all-period 5th-percentile reference.
                    </p>
                  </div>
                )}
                <p className="text-xs text-slate-500">
                  {isCustomer
                    ? 'Prepared by Ameresco. Costs are estimated energy cost at the rates shown, associated with patterns of use, not guaranteed savings. Figures change with any settings you adjust.'
                    : 'Every site starts as Office / commercial with unconfirmed preset hours. Check each calendar (or set them all at once above) before relying on closed-hours figures.'}
                </p>
              </>
            )}
          </>
        )}
      </main>
      <footer className="bg-slate-950 text-white/80 mt-10">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-wrap gap-x-10 gap-y-4 items-start text-sm">
          <div className="min-w-56">
            <p className="font-extrabold text-white text-base">{PRODUCT_FULL}</p>
            <p className="text-xs text-white/60 mt-1">By Ameresco UK. Half-hourly electricity analysis.</p>
          </div>
          <p className="flex-1 min-w-64 text-xs text-white/70 leading-relaxed">
            Works offline: files are read on this computer and never uploaded. Costs are energy cost at the rates entered, associated with
            patterns of use, not guaranteed savings. Whole-site data shows when demand happens, not which equipment causes it.
          </p>
        </div>
      </footer>
    </div>
  );
}
