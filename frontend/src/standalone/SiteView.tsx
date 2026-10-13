import { useCallback, useMemo, useState } from 'react';
import HHAnalyser, { type ReportFilters } from '../components/analyser/HHAnalyser';
import {
  downloadAnalyserChartsZip, downloadExcel, downloadSiteSummary, scenarioRunFor, updateAction, updateScenarios,
  updateSiteSettings, type SiteSummary,
} from '../local/localClient';
import { SITE_TYPES, type SiteSettings } from '../local/site';
import type { SiteTab } from '../local/findings';
import type { Action } from '../local/actions';
import type { Scenario } from '../local/scenarios';
import { fmtDayMonYear } from '../local/dates';
import FullPeriodChart from './FullPeriodChart';
import OverviewTab from './OverviewTab';
import ReviewTab from './ReviewTab';
import SiteSettingsPanel from './SiteSettingsPanel';
import BaseloadTab from './BaseloadTab';
import HeatmapTab from './HeatmapTab';
import AnomaliesTab from './AnomaliesTab';
import ScenariosTab from './ScenariosTab';
import CapacityTab from './CapacityTab';
import { VerdictChip } from './QualityPanel';
import { Note, Tabs } from './ui';
import { btnPrimary, btnSecondary, num } from './format';

/** One meter: header, report buttons and the tabs of analysis behind it. */
export default function SiteView({ site, rate, locked, showNotes, refresh, onBack, run, initial }: {
  site: SiteSummary;
  initial?: { tab?: SiteTab; date?: string };
  rate: number;
  locked: boolean;
  showNotes: boolean;
  refresh: () => void;
  onBack: () => void;
  run: (label: string, job: () => Promise<void>) => void;
}) {
  const [tab, setTab] = useState<SiteTab>(initial?.tab ?? 'overview');
  const [date, setDate] = useState<string | null>(initial?.date ?? null);
  const [exporting, setExporting] = useState<string | null>(null);
  const goTo = useCallback((t: SiteTab, d?: string) => {
    setTab(t);
    if (d) setDate(d);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const onSettings = (s: SiteSettings) => { updateSiteSettings(site.id, s); refresh(); };
  const onAction = (key: string, patch: Partial<Action>) => { updateAction(site.id, key, patch); refresh(); };
  const onScenarios = (s: Scenario[]) => { updateScenarios(site.id, s); refresh(); };
  const scenarioRun = useMemo(() => (tab === 'scenarios' ? scenarioRunFor(site.id) : null),
    [tab, site]);
  // Stable identities, so the explorer does not reload on every keystroke elsewhere.
  const downloadSeparate = useCallback((opts: ReportFilters) => downloadAnalyserChartsZip(site.id, opts), [site.id]);
  const runForSite = useCallback(<T,>(job: (id: string) => Promise<T>) => job(site.id), [site.id]);
  const m = site.metrics;
  const doRun = (label: string, job: () => Promise<void>) => {
    setExporting(label);
    run(label, async () => { try { await job(); } finally { setExporting(null); } });
  };

  const tabs: { key: SiteTab; label: string; badge?: string | number }[] = [
    { key: 'overview', label: 'Overview', badge: m.findings.filter((f) => f.level === 'high').length || '' },
    { key: 'review', label: 'Data review', badge: site.quality.verdict === 'good' ? '' : site.quality.verdict },
    { key: 'calendar', label: 'Calendar', badge: site.settings.calendar.confirmed ? '' : 'unconfirmed' },
    { key: 'baseload', label: 'Base load and closed hours' },
    { key: 'heatmap', label: 'Heatmap and days' },
    { key: 'anomalies', label: 'Unusual days', badge: m.anomalies.events.length + m.anomalies.changes.length },
    { key: 'scenarios', label: 'Savings scenarios', badge: site.scenarios.filter((s) => s.enabled).length },
    { key: 'capacity', label: 'Capacity' },
    { key: 'charts', label: 'Charts' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-[#0065a5] hover:text-[#00528a] font-medium">← All sites</button>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{site.settings.name}</h1>
          <p className="text-sm text-slate-500 flex flex-wrap items-center gap-x-2">
            <span>{site.filename}</span>
            {site.settings.meterId && <span>· meter {site.settings.meterId}</span>}
            <span>· {fmtDayMonYear(m.coverage.from)} to {fmtDayMonYear(m.coverage.to)}</span>
            <span>· {num(m.coverage.validDays)} valid days ({(m.coverage.share * 100).toFixed(0)}% coverage)</span>
            <span>· {SITE_TYPES[site.settings.type].label}</span>
            {site.settings.role === 'sub' && <span>· submeter</span>}
            <VerdictChip verdict={site.quality.verdict} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={!!exporting} onClick={() => doRun('Summary', () => downloadSiteSummary(site.id))}
            title="Page 1: headline figures and top investigations. Then the opportunities appendix." className={btnPrimary}>
            {exporting === 'Summary' ? 'Building PDF…' : 'Site summary (PDF)'}
          </button>
          <button disabled={!!exporting} onClick={() => doRun('Excel', () => downloadExcel(site.settings.name, [site.id]))} className={btnSecondary}>
            {exporting === 'Excel' ? 'Building…' : locked ? 'Summary to Excel' : 'Export to Excel'}
          </button>
        </div>
      </div>
      {site.warnings.length > 0 && tab !== 'review' && (
        <Note tone="warn">
          This file has {site.warnings.length} data note{site.warnings.length > 1 ? 's' : ''}.{' '}
          <button onClick={() => setTab('review')} className="underline font-medium">See the data review</button>
        </Note>
      )}

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' && <OverviewTab site={site} locked={locked} showNotes={showNotes} onAction={onAction} goTo={goTo} />}
      {tab === 'review' && <ReviewTab site={site} onChange={onSettings} locked={locked} goTo={goTo} />}
      {tab === 'calendar' && <SiteSettingsPanel site={site} defaultRate={rate} onChange={onSettings} locked={locked} section="calendar" />}
      {tab === 'baseload' && <BaseloadTab site={site} onChange={onSettings} locked={locked} />}
      {tab === 'heatmap' && <HeatmapTab site={site} date={date} onDate={setDate} />}
      {tab === 'anomalies' && <AnomaliesTab site={site} goTo={goTo} />}
      {tab === 'scenarios' && scenarioRun && <ScenariosTab site={site} run={scenarioRun} onChange={onScenarios} locked={locked} />}
      {tab === 'capacity' && <CapacityTab site={site} onChange={onSettings} locked={locked} goTo={goTo} />}
      {tab === 'charts' && (
        <div className="space-y-4">
          <Note>
            These charts have their own date filter, for exploring. Findings, costs, scenarios and headroom always use the full record,
            so they do not change when you filter here. The PDF from this section says which dates it covers.
          </Note>
          <FullPeriodChart frame={site.frame} />
          <HHAnalyser key={`${site.id}-${site.frameKey}`} sessionId={site.id} runWithSession={runForSite} onDownloadSeparate={downloadSeparate} />
        </div>
      )}
      {tab === 'settings' && <SiteSettingsPanel site={site} defaultRate={rate} onChange={onSettings} locked={locked} section="settings" />}
    </div>
  );
}
