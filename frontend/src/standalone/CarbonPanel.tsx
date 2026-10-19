import type { CarbonFactor, SiteMetrics } from '../local/findings';
import type { ScenarioRun } from '../local/scenarios';
import { CHART } from '../local/chartColours';
import { ChartCard } from './ChartCard';
import { chartFileName } from './chartDownload';
import { num, pct } from './format';

/**
 * Carbon in big numbers: the site's emissions at the entered factor, the
 * share tied to closed-hours excess, and what active savings scenarios would
 * remove, with a before-and-after bar. Only shown when a factor is entered.
 */
export default function CarbonPanel({ metrics: m, carbon, run, siteName }: {
  metrics: SiteMetrics; carbon: CarbonFactor; run: ScenarioRun | null; siteName: string;
}) {
  const t = (kwh: number) => (kwh * carbon.kgPerKwh) / 1000;
  const yearly = m.annual !== null;
  const total = yearly ? t(m.annual!.kwh) : t(m.observed.kwh);
  const excess = m.excess ? t(yearly && m.excess.annual ? m.excess.annual.kwh : m.excess.observed.kwh) : null;
  const saved = run && run.total.kwh > 0 ? t(yearly && run.total.annualKwh !== null ? run.total.annualKwh : run.total.kwh) : null;
  const unit = yearly ? 'tCO2e a year' : 'tCO2e in the period';
  const after = saved !== null ? Math.max(0, total - saved) : null;
  return (
    <ChartCard
      title="Carbon"
      subtitle={`At ${carbon.kgPerKwh} kgCO2e/kWh${carbon.year ? ` (${carbon.year})` : ''}${carbon.source ? `, ${carbon.source}` : ''}`}
      file={chartFileName(siteName, 'carbon')}
      footer={`kWh x one annual factor${yearly ? ', scaled to a year with the site\'s annual estimate' : ' for the observed period'}. Not time-of-day grid carbon, so moving load in time shows no benefit here.`}
    >
      <div className="grid gap-5 md:grid-cols-[1fr_1.2fr] items-center">
        <dl className="space-y-3">
          <Big value={num(total, 1)} label={unit} />
          {excess !== null && <Big value={num(excess, 1)} label={`from closed-hours excess (${pct(total > 0 ? excess / total : 0)})`} />}
          {saved !== null && <Big value={num(saved, 1)} label={`less with the active savings scenarios (${pct(total > 0 ? saved / total : 0)})`} tone="green" />}
        </dl>
        {after !== null && (
          <svg viewBox="0 0 320 170" className="w-full h-auto" role="img" aria-label={`Before ${num(total, 1)}, after ${num(after, 1)} ${unit}`}>
            {[[0, 'Now', total, CHART.grey], [1, 'With scenarios', after, CHART.green]].map(([k, label, v, colour]) => {
              const h = total > 0 ? ((v as number) / total) * 120 : 0;
              const x = 60 + (k as number) * 130;
              return (
                <g key={label as string}>
                  <rect x={x} y={140 - h} width="80" height={h} rx="4" fill={colour as string} />
                  <text x={x + 40} y={134 - h} textAnchor="middle" fontSize="13" fontWeight="700" fill="#0f172a">{num(v as number, 1)}</text>
                  <text x={x + 40} y={158} textAnchor="middle" fontSize="12" fill="#475569">{label as string}</text>
                </g>
              );
            })}
            <line x1="40" x2="300" y1="140" y2="140" stroke="#cbd5e1" />
          </svg>
        )}
      </div>
    </ChartCard>
  );
}

function Big({ value, label, tone }: { value: string; label: string; tone?: 'green' }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className={`text-3xl font-bold tabular-nums ${tone === 'green' ? 'text-[#008540]' : 'text-[#0065a5]'}`}>{value}</dt>
      <dd className="text-sm text-slate-600">{label}</dd>
    </div>
  );
}
