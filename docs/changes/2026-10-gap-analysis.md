# HH Analyser improvement brief (13 Oct 2026): existing versus missing

Source inspected: `frontend/src/local/*`, `frontend/src/standalone/*` at commit 51d6437 (the build delivered on 6 Oct 2026).

| Brief item | Existing | Missing or wrong |
| --- | --- | --- |
| 1. One calculation layer | `localClient` caches metrics per settings object; site screen, portfolio, PDFs and Excel all call `analyseSite` | Explorer charts (HHAnalyser) use the date filter, findings use the full record, and nothing says so |
| 1. Raw data retained | Values and blanks kept per file | Non-numeric cells become 0; no meter ID, unit, flag codes or exclusion reasons; no reviewed exclusions |
| 1. Baseload labels | 5th percentile in findings | Load duration "Base" is the lowest reading under the same name |
| 1. Observed vs annualised | Annualises everything by 365.25 / days | No observed figures shown; no coverage or valid hours; annualises any length of data |
| 1. kW conversion | kWh x 2 for half-hour data | No handling of files already in kW; peak not labelled as a half-hour average |
| 1. Missing vs zero | Blank cells kept out of base load and LDC | Non-numeric cells counted as zero; averages divide by all slots; heatmap hides missing days |
| 1. Negative readings | Always "fail" | No meter type (import, export, net) |
| 1. Timestamps and DST | Day rows with 48 columns; 50-period files use the first 48 | No start/end convention; clock-change days not mapped; no long (timestamp, value) format |
| 1. Duplicates | First date kept, many repeats refused | Conflicting duplicate days not shown; same file can be loaded twice and doubles totals |
| 2. Opportunities view | Findings list per site with level and £ | No structured records, confidence, status, owner, evidence links, estate-wide list, top three |
| 3. Calendars | Weekday / Saturday / Sunday hours, bank holidays like Sunday (England and Wales) | Per-day schedules, several periods, overnight shifts, dated closures and exceptions, Scotland and NI holidays, editable holidays, confirmed flag |
| 3. Heatmap | Full-period carpet, hover only | Missing days not shown, no weekly view, no overlays, no click to inspect, no reference profile, no period comparison |
| 4. Baseload and OOH | All-period 5th percentile; OOH excess above it | Closed-hours reference, breakdown by day class, monthly sample counts, before/after |
| 5. Anomalies | Weekday/Saturday/Sunday groups, robust test | Actual weekday, matched previous 8 days, low events, persistent change, settings |
| 6. Scenarios | None | All of it |
| 7. Tariffs, carbon, estate | Flat default and site rate | Time bands, carbon factor, floor area, matched-period comparison, meter groups |
| 8. Capacity | Headroom, monthly peaks, test load | Top ten peaks, recurrence, "fits" wording |
| 9. Persistence and exports | PDFs, Excel, customer edition | Project file, action statuses, new content in exports |
