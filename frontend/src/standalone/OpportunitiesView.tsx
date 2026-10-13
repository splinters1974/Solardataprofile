import { useMemo, useState } from 'react';
import { listOpportunities, updateAction, type SiteSummary } from '../local/localClient';
import { sortOpportunities, STATUS_LABEL, STATUS_ORDER, type ActionStatus, type OppSort } from '../local/actions';
import type { Confidence, Level, SiteTab } from '../local/findings';
import FindingCard from './FindingCard';
import { Card } from './ui';
import { gbp, smallInput } from './format';

/** Every finding on every site as an investigation record, sortable and filterable, with status and owner. */
export default function OpportunitiesView({ sites, locked, showNotes, refresh, openSite }: {
  sites: SiteSummary[]; locked: boolean; showNotes: boolean; refresh: () => void; openSite: (id: string, tab?: SiteTab, date?: string) => void;
}) {
  const [sort, setSort] = useState<OppSort>('impact');
  const [impact, setImpact] = useState<Level | 'any'>('any');
  const [conf, setConf] = useState<Confidence | 'any'>('any');
  const [status, setStatus] = useState<ActionStatus | 'open' | 'any'>('open');
  const [site, setSite] = useState<string>('any');
  const [notes, setNotes] = useState(false);
  const all = useMemo(() => listOpportunities(sites), [sites]);
  const shown = sortOpportunities(all.filter((o) => (impact === 'any' ? o.finding.level !== 'info' : o.finding.level === impact)
    && (conf === 'any' || o.finding.confidence === conf)
    && (status === 'any' || (status === 'open' ? !['implemented', 'closed'].includes(o.action.status) : o.action.status === status))
    && (site === 'any' || o.siteId === site)), sort);
  const total = shown.reduce((a, o) => a + (o.finding.cost?.annual ?? 0), 0);

  return (
    <Card
      title="Energy opportunities across the estate"
      subtitle="Findings as investigation records. Impact (how much it could matter) and confidence (how good the evidence is) are separate; there is no combined score. Associated costs are not savings, and findings on one site overlap."
    >
      <div className="flex flex-wrap items-end gap-3 mb-3 text-sm">
        <label className="text-xs text-slate-500">Sort by<br />
          <select className={smallInput} value={sort} onChange={(e) => setSort(e.target.value as OppSort)}>
            <option value="impact">Impact</option><option value="confidence">Confidence</option>
            <option value="cost">Associated cost</option><option value="status">Status</option><option value="site">Site</option>
          </select></label>
        <label className="text-xs text-slate-500">Impact<br />
          <select className={smallInput} value={impact} onChange={(e) => setImpact(e.target.value as Level | 'any')}>
            <option value="any">High, medium, low</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="info">Notes</option>
          </select></label>
        <label className="text-xs text-slate-500">Confidence<br />
          <select className={smallInput} value={conf} onChange={(e) => setConf(e.target.value as Confidence | 'any')}>
            <option value="any">Any</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select></label>
        <label className="text-xs text-slate-500">Status<br />
          <select className={smallInput} value={status} onChange={(e) => setStatus(e.target.value as ActionStatus | 'open' | 'any')}>
            <option value="open">Not yet implemented or closed</option><option value="any">Any</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select></label>
        <label className="text-xs text-slate-500">Site<br />
          <select className={smallInput} value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="any">All sites</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.settings.name}</option>)}
          </select></label>
        {!locked && <label className="flex items-center gap-1.5 text-xs text-slate-600 pb-1"><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} /> Expand all</label>}
        <p className="ml-auto text-xs text-slate-500 pb-1">{shown.length} shown{total ? ` · ${gbp(total)} a year associated (overlaps, not additive)` : ''}</p>
      </div>
      {shown.length ? (
        <ul>
          {shown.map((o) => (
            <FindingCard key={`${o.siteId}-${o.finding.key}-${notes}`} f={o.finding} action={o.action} siteName={o.siteName}
              locked={locked} showNotes={showNotes} defaultOpen={notes}
              onAction={(p) => { updateAction(o.siteId, o.finding.key, p); refresh(); }}
              goTo={(t, d) => openSite(o.siteId, t, d)} />
          ))}
        </ul>
      ) : <p className="text-sm text-slate-500">Nothing matches these filters.</p>}
    </Card>
  );
}
