import { topInvestigations, type SiteTab } from '../local/findings';
import { fmtDayMonYear } from '../local/dates';
import { newAction, type Action } from '../local/actions';
import type { SiteSummary } from '../local/localClient';
import FindingCard from './FindingCard';
import { VerdictChip } from './QualityPanel';
import { Card, Kind, Note, Tile } from './ui';
import { gbp, kw, kwh, num, pct } from './format';

/** Headline figures (observed and estimated side by side), the top three investigations, then every finding. */
export default function OverviewTab({ site, locked, showNotes, onAction, goTo }: {
  site: SiteSummary;
  locked: boolean;
  showNotes: boolean;
  onAction: (key: string, patch: Partial<Action>) => void;
  goTo: (tab: SiteTab, date?: string) => void;
}) {
  const m = site.metrics;
  const c = m.coverage;
  const top = topInvestigations(m);
  const rest = m.findings.filter((f) => !top.includes(f));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Electricity, observed period" tag="measured" value={kwh(m.observed.kwh)}
          hint={`${fmtDayMonYear(c.from)} to ${fmtDayMonYear(c.to)}, ${num(c.validDays)} valid days`} />
        <Tile label="Energy cost, observed period" tag="estimate" value={gbp(m.observed.cost)} hint={m.rate.description} />
        <Tile label="Electricity a year" tag="estimate" value={m.annual ? kwh(m.annual.kwh) : 'Not annualised'}
          tone={m.annual ? undefined : 'muted'}
          hint={m.annual ? `${m.annualisation.mode === 'full' ? 'Scaled' : 'Indicative, scaled'} from valid hours` : 'Under 180 days of valid readings'} />
        <Tile label="Energy cost a year" tag="estimate" value={m.annual ? gbp(m.annual.cost) : 'Not annualised'}
          tone={m.annual ? undefined : 'muted'}
          hint={m.annual?.tco2e != null ? `${num(m.annual.tco2e, 1)} tCO2e (entered factor)` : 'Excludes fixed charges'} />
        <Tile label="Highest half-hour average" tag="measured" value={kw(m.peak.kw)} hint={m.peak.when} />
        <Tile label="Base load reference" tag="measured" value={kw(m.baseAll.kw)} hint={`${m.baseAll.label.replace(/ \(.*/, '')}; lowest half hour ${kw(m.lowestKw)}`} />
        <Tile label="Use in closed hours" tag="measured" value={m.hasClosed ? pct(m.closed.share) : '24-7'}
          hint={m.excess ? `${gbp(m.excess.annual?.cost ?? m.excess.observed.cost)} ${m.excess.annual ? 'a year' : 'in period'} above the reference (associated cost)` : 'No closed hours in the calendar'} />
        <Tile label="Coverage" tag="measured" value={pct(c.share, 1)}
          hint={<span className="inline-flex items-center gap-1.5">{num(c.validReadings)} of {num(c.expectedReadings)} readings · <VerdictChip verdict={site.quality.verdict} /></span>} />
      </div>
      {m.annualisation.warning && <Note tone="warn">{m.annualisation.warning}</Note>}
      {m.rate.problems.length > 0 && <Note tone="bad">Time-band rates not used: {m.rate.problems.join(' ')} Costs use the flat rate until the bands cover every half hour exactly once.</Note>}
      {!site.settings.calendar.confirmed && (
        <Note tone="warn">
          Opening hours are a preset and not yet confirmed. Findings that depend on them carry lower confidence.{' '}
          {!locked && <button onClick={() => goTo('calendar')} className="underline font-medium">Check the calendar</button>}
        </Note>
      )}

      <Card title="Top investigations" subtitle="The three most useful things to look at first: highest impact, then best evidence. Impact and confidence are separate.">
        {top.length ? (
          <ul>{top.map((f) => (
            <FindingCard key={f.key} f={f} action={site.actions[f.key] ?? newAction()} onAction={(p) => onAction(f.key, p)}
              locked={locked} showNotes={showNotes} goTo={goTo} defaultOpen={false} />
          ))}</ul>
        ) : <p className="text-sm text-slate-500">Nothing above note level stands out.</p>}
      </Card>

      <Card
        title="All findings"
        subtitle={<>Associated costs are energy cost at the rates entered, not savings, and related findings overlap. <Kind kind="measured" /> figures come from valid readings; <Kind kind="estimate" /> figures are scaled or priced.</>}
      >
        {rest.length ? (
          <ul>{rest.map((f) => (
            <FindingCard key={f.key} f={f} action={site.actions[f.key] ?? newAction()} onAction={(p) => onAction(f.key, p)}
              locked={locked} showNotes={showNotes} goTo={goTo} />
          ))}</ul>
        ) : <p className="text-sm text-slate-500">No other findings.</p>}
        <p className="text-xs text-slate-400 mt-3">
          Whole-site half-hourly data shows when demand happens, not which equipment causes it. Checks are suggestions to confirm on site.
          Findings use the full record; the date filter on the Charts tab affects those charts only.
        </p>
      </Card>
    </div>
  );
}
