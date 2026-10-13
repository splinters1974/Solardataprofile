# Data Analyser version 2: change log

Brief: Claude implementation brief, 13 October 2026. Gap analysis: `2026-10-gap-analysis.md`.
Deliverables: `standalone/Ameresco-Data-Analyser.html`, `standalone/Ameresco-Data-Analyser-User-Guide.pdf` (source `docs/user-guide/guide.html`).

## What changed

**1. Calculation integrity**
- One frame per meter with a flag per half hour (valid, blank, text, clock-change gap, unsafe clock-change day, duplicate, excluded). Raw readings are kept; all figures derive from the reviewed frame.
- Missing readings are missing, not zero. Text cells, blanks and absent days are left out; the heatmap shows them hatched.
- kW = kWh ÷ 0.5 h. Files in kW are detected and converted. Peak is labelled "highest half-hour average".
- The all-period 5th percentile and the lowest half hour are shown and labelled separately.
- Observed kWh and cost are shown apart from annual estimates. Annualisation = observed × 8,766 ÷ valid hours: full at 330+ valid days, indicative from 180, off below 180 unless forced (with a warning).
- Spring 46-period and autumn 50-period days are mapped exactly. A clock-change day with 48 readings is held back for review. Timestamped (long) files are read, 15-minute data aggregated, UTC converted to UK time, hourly data refused.
- Interval start or end labelling is detected and editable.
- Identical duplicate rows count once. Conflicting duplicates are held back with both versions visible. The same file can't be loaded twice.
- Negative readings are judged by meter type (import, export, net).
- Data review tab: how the file was read, held-back days, and an exclusions table with reasons. Quality checks can exclude, keep or inspect their dates.

**2. Opportunities**
- Findings are structured records: site, meter, period, evidence, calculation, kWh/kW, associated cost, suggested check, impact, confidence with reasons, related findings, links to charts.
- Each finding is tracked as an opportunity with status (seven stages), owner, target date and notes.
- Each site shows its top three investigations. The estate-wide Opportunities view sorts by impact, confidence, cost or status. There is no composite score.
- Where to start keeps the ranking by closed-hours excess, relabelled as associated cost.
- Wording names possible explanations only, never equipment as the cause.

**3. Calendars and visual investigation**
- Per-day hours, several periods per day, overnight shifts, dated closures (with paste), exceptional periods, a holiday nation (E&W, Scotland, NI), editable holiday dates, and a low-activity window for 24-7 sites.
- Presets are unconfirmed until ticked; calendar-dependent findings are capped at Medium confidence until then. School terms are never inferred.
- The heatmap shows the full period with gaps, missing, excluded and open/close overlays. It also has a week grid (days by half hours, shared scale), click-to-inspect, and keyboard-accessible cells.
- The day inspector shows the reference profile: median of the previous 8 comparable days, with the count and date range.
- Period comparison against the previous equal period and the same weeks a year earlier, on matched complete days, with coverage.

**4. Base load and closed hours**
- All-period and closed-hours references are shown side by side with their methods. Settings choose which one drives the ranking; it never switches silently.
- Open and closed use is split by weekday, Saturday, Sunday, holiday, closure and exception.
- Monthly base load with sample and excluded counts. Before and after comparison for a chosen date.

**5. Anomalies**
- Actual weekday plus calendar class. Baseline is the previous 8 comparable days (minimum 6). Flagged at >25% and >4 × scaled MAD, high and low. Poor days are kept out of the baseline, and "cannot apply" counts are shown.
- Persistent change: ≥15% on 5 of 7 eligible days. All thresholds are editable in Settings.

**6. Savings scenarios**
- A to D, applied in order to one copy of the profile. Each has a retained floor and never goes negative. Peaks can be removed or shifted, and shifted energy reappears in the receiving window. Defaults are zero.
- Results show period kWh and £, a separate annual projection, tCO2e, a before/after profile and the half hours changed.
- Acceptance check (10 kW × 12 h × 100 days = 12,000 kWh = £3,000) is an automated test.

**7. Tariffs, carbon, estate**
- Time bands with days, windows crossing midnight and effective dates. Every half hour is validated to exactly one band; if not, the problems are listed and the flat rate is used.
- Carbon factor with year and source. No default.
- Floor area, kWh/m² and kWh per open hour. Same-type comparison over 90+ shared complete days, with no best or worst label.
- Meter groups by physical site with main, sub and separate roles. Submeters are never summed. Overlap warnings are shown.

**8. Capacity**
- Top ten half-hour peaks (one per day), kW and kVA at the assumed power factor, and recurrence within 10% of the peak.
- Wording changed to "no exceedance in the analysed half hours under the entered assumptions".

**9. Persistence and exports**
- Save and open a project (`.adproject`, gzip JSON, schema version 1). It holds raw data, review decisions, settings, statuses, scenarios, title, logo and carbon.
- PDFs gain an opportunities appendix covering observed vs annual, top three, calculations, data review, and calendar and tariff.
- Excel gains Opportunities, Scenarios, Scenario intervals, Data review, and Calendar and tariff sheets. Half-hour sheets leave missing cells blank and add a flag column.
- Customer editions show statuses and scenarios read-only. Owners and notes are excluded unless ticked. The flat-rate what-if is kept.

## Checks (all automated, 43 tests passing)

The 18 brief checks are in `frontend/tests/brief-checks.test.ts`, alongside the existing parity, part-day, quality and edition tests. An end-to-end browser run covered:
- loading all sample formats
- duplicate refusal
- calendar confirm and closure paste
- scenarios, time bands and statuses
- every PDF and Excel export
- project save and reopen
- customer edition open, read-only and no notes

## Unmet or partly met

1. **Hosted web app and Python backend not updated.** All changes are in the offline standalone build. The hosted `HHAnalyser` charts still use the old maths. Parity tests confirm the shared core maths matches.
2. **Fixed and capacity charges** have no input. They're excluded and every cost says so. Capacity-charge savings aren't modelled.
3. **Customer editions** offer the existing flat-rate what-if only. The client can't edit time bands.
4. **Timestamped files:** after a project is saved and reopened, cells that held text show as blank instead of "text". They're still missing, so no figure changes.
5. **Baseline file on Drive** (`Ameresco HH Analyser Tool.html`) wasn't opened separately. The review used the repo source at the commit delivered on 6 October. Diff it against the Drive copy if anything was changed outside the repo.
6. **No weather normalisation, equipment diagnosis, live monitoring or verified savings.** These are out of scope by design, and the UI and reports say so.
7. **Open-source licence notices** (flagged in the earlier GDPR review) still aren't bundled in the HTML. Add them before wider distribution.
8. **Scenario B** applies to all months. There's no seasonal filter.
9. **Date inputs** follow the browser's locale, so a US-locale browser shows mm/dd/yyyy.

## Expect different numbers from version 1

- Sites with gaps or text cells show higher averages and lower totals, because missing is no longer zero.
- Sites under 180 days lose their annual figures.
- Unusual-day counts change under the new baseline rule.
- Clock-change days with 48 readings are left out until reviewed.
