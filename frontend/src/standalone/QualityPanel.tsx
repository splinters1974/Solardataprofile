import { useState } from 'react';
import { VERDICT_TEXT, type CheckStatus, type QualityReport, type Verdict } from '../local/dataQuality';
import { VERDICT_UI } from './levelUi';

const STATUS: Record<CheckStatus, { label: string; text: string; bar: string }> = {
  fail: { label: 'Fail', text: 'text-[#b42c2c]', bar: 'bg-[#d03b3b]' },
  warn: { label: 'Check', text: 'text-[#8a6100]', bar: 'bg-[#fab219]' },
  ok: { label: 'OK', text: 'text-[#08780a]', bar: 'bg-[#0ca30c]' },
};

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const ui = VERDICT_UI[verdict];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold border rounded px-1.5 py-0.5 ${ui.chip} ${ui.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ui.dot}`} aria-hidden />
      {VERDICT_TEXT[verdict].label}
    </span>
  );
}

export default function QualityPanel({ report }: { report: QualityReport }) {
  const [showPassed, setShowPassed] = useState(false);
  const flagged = report.checks.filter((c) => c.status !== 'ok');
  const passed = report.checks.filter((c) => c.status === 'ok');
  const ui = VERDICT_UI[report.verdict];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold text-slate-800">Data quality</h3>
        <VerdictChip verdict={report.verdict} />
      </div>
      <p className={`text-sm mt-1 ${ui.text}`}>{VERDICT_TEXT[report.verdict].summary}</p>

      {flagged.length > 0 && (
        <ul className="mt-2">
          {flagged.map((c) => (
            <li key={c.key} className="flex gap-3 py-2.5 border-b border-slate-100 last:border-0">
              <span className={`w-1 rounded-full shrink-0 ${STATUS[c.status].bar}`} aria-hidden />
              <div>
                <p className="text-sm">
                  <span className={`text-[11px] font-bold uppercase tracking-wide mr-2 ${STATUS[c.status].text}`}>
                    {STATUS[c.status].label}
                  </span>
                  <span className="font-semibold text-slate-800">{c.title}</span>
                </p>
                <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={() => setShowPassed((v) => !v)}
        className="mt-2 text-xs text-slate-500 hover:text-slate-800 underline"
      >
        {showPassed ? 'Hide' : 'Show'} {passed.length} check{passed.length === 1 ? '' : 's'} passed
      </button>
      {showPassed && (
        <ul className="mt-1 text-sm text-slate-600 space-y-0.5">
          {passed.map((c) => (
            <li key={c.key}><span className={`font-semibold ${STATUS.ok.text}`}>OK</span> {c.title}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
