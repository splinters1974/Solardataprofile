# Data Analyser Advanced: change log

Brief: Claude implementation brief, 13 October 2026. Gap analysis: `2026-10-gap-analysis.md`.
Deliverables: `standalone/Ameresco-Data-Analyser-Advanced.html` and `standalone/Ameresco-Data-Analyser-Advanced-User-Guide.pdf` (source `docs/user-guide/guide.html`).
The previous tool is kept as `standalone/Ameresco-Data-Analyser-Standard.html` with its original guide.

## 20 October 2026: files with more than a year (2.4)

- **Analysis period per site, defaulting to the last 12 calendar months** of the file (for example 1 Oct 2024 to 30 Sep 2025). The picker at the top of each site page also offers each earlier 12-month block, the whole file and custom dates. It shows prominently when a file holds more than a year.
- **On the main page:** a banner shows when any file holds more than a year, with "Last 12 months for all" and "Whole files for all" buttons.
- **The analysis period drives** headline figures, findings, ranking, scenarios, heatmap, charts, data quality, PDFs and Excel.
- **The whole file drives the trends:**
  - base load by month (months outside the period shown in grey)
  - the year-on-year base load change finding, which now compares the analysis period against the year before it rather than pairing every year in the file
  - compare periods, and before-and-after
- **Outputs.** PDFs state the analysis period and the file's dates. The Excel summary adds analysis period, file-from and file-to columns. Projects and customer editions keep the choice.
- **Tests:** period maths (calendar months, leap years, earlier blocks, custom dates) and the period/history split.
- **Week by week stays within the analysis period.** Switch to whole file to browse every week.

## 19 October 2026: charts borrowed from Orkestra, Standard rebuilt (2.3)

- **Standard is rebuilt on the Advanced engine.** One codebase is built twice (`npm run build:standard` and `npm run build:standalone`).
  - Standard shows Overview, Data review, Calendar, Heatmap, Capacity, Charts and Settings, and has no opportunity tracking or project files. It now gets the same numbers and charts as Advanced.
  - Standard's figures change where files have gaps: missing readings are no longer counted as zero, and annual figures need at least 180 valid days.
  - The old Standard guide is retired. One guide covers both versions.
- **Ameresco chart palette.** Charts use Ameresco blue and green, extended to a seven-colour set checked for colour-blind separation and contrast. Day types are blue, green and purple. Closed-hours excess is burnt orange. "Before" and closed hours are grey. The old teal, pink and amber colours are gone from the screens and the PDFs.
- **New charts (ideas borrowed from Push Power / Orkestra):**
  - **Daily load profile** (Charts tab, both versions):
    - every day as a faint line, plus the average and the highest value in each half hour
    - usually-closed hours shaded
    - filters by day type and month
    - in Advanced, a measured / with-scenarios switch
  - **Where the energy goes** donut (Overview, both versions, and the PDF appendix). Base load, open hours and closed-hours excess, which add up to the total.
  - **Week by week** (Heatmap tab, Advanced):
    - weekly kWh or £ bars
    - click a week to see its half hours, with closed hours shaded, scenarios as a line and the unit rate underneath
  - **Peak demand against capacity** (Capacity tab, both versions). A week of half-hour kVA bars with agreed capacity, usable capacity and the scenario D peak target. Bars over the line are orange.
  - **Carbon panel** (Overview, Advanced, once a factor is entered). tCO2e a year, the share from closed-hours excess, and the scenario reduction with a before/after bar.
- **Download button on every new chart.** It saves the chart as a PNG at twice screen resolution.
- **Not borrowed:** the energy flow diagram, battery state of charge, battery degradation, backup duration, solar self-consumption and cashflow/NPV charts. They need the asset register and the solar/battery modelling, a later phase. The "barrels of oil" and "trees" carbon equivalents are also left out, because they need a cited source for each conversion.

## 16 October 2026: Advanced 2.2 (feedback round)

1. **Carbon year and source can be typed at any time.** They were locked until a factor was entered.
2. **Suggested carbon factors.** One click fills the UK Government factor, year and source: 2026 is 0.13096 and 2025 is 0.177 kgCO2e/kWh (location-based Scope 2, generation only). It's still not a default. These figures come from secondary sources that agree with each other; the gov.uk spreadsheet couldn't be opened from the build environment, so check it before formal reporting.
3. **Bulk calendar setting is now a large Step 1 panel** above the totals, with a primary button. It shows how many sites are still unconfirmed.
4. **Low-activity window explained.** The calendar now says what it's for (24-hour sites only), what it changes (only the second base load reference and scenario A) and what it doesn't. It warns when a site has closed hours and the window isn't used.
5. **Before and after redesigned** as "Did a change make a difference?". It compares 2 to 12 weeks either side of a date instead of the whole record, which stops the seasons swamping the result. It shows average demand, base load and closed-hours demand, plus a one-line verdict with what the change would be worth over a year if it held.
6. **Compare periods explained.** It now has quick picks (4 weeks, 3 months, 6 months) and a plain-English sentence for each comparison.
7. **Scenario chart.**
   - The chart toggles between all days, days the site opens, and closed days.
   - It draws the reference as a dashed line.
   - It explains that scenario A takes closed-hours demand down to the reference, not to zero.
   - Every scenario has a one-line explanation, and results show how many days each one touches.
8. **Scenario D is now "Lower peak demand".** The default is "hold demand at or below X kW", with one-click 90%, 80% and 70% of the current peak. Trimming the top N half hours, or every half hour above a level, is still available. Results show the new peak and the number of days affected. The screen says the value of lower peaks lies mostly in capacity charges and headroom, not energy.

## 14 October 2026: Advanced 2.1

- **Two named versions.** This build is the **Advanced** version: a green ADVANCED badge sits next to the name in the header and on the customer password page. The file is called `Ameresco-Data-Analyser-Advanced.html`, and every PDF footer reads "Ameresco Data Analyser Advanced". The earlier tool was rebuilt unchanged apart from a grey STANDARD badge, footer and file name (source commit 51d6437 plus the label).
- **Tabs.** The tabs now sit in a solid bar, with the active tab filled blue and badges in colour. The bar stays pinned to the top of the window while scrolling. Shorter labels keep all ten site tabs on one row at laptop width; before this, Capacity, Charts and Settings dropped off the right-hand edge. The content area is wider.
- **Customer editions can change more.** The customer can now change:
  - opening hours, closures and holidays, and confirm the calendar
  - flat rates and time bands
  - the carbon factor
  - site name, building type and floor area
  - supply capacity and test loads
  - exclusions and held-back days
  - savings scenarios

  They still can't add sites, change opportunity statuses, owners or notes, change how the file was read or meter grouping, change the analysis method, or export half-hourly data.
- **Save my changes / Undo my changes.** Saving creates a new copy of the customer dashboard, locked with the same password. The browser warns before the customer closes the page with unsaved changes.
- **Reports made after a customer change say so.** Every PDF footer carries "includes changes made by [customer]", including PDFs from a saved copy.
- **Locked fields look locked** (grey and not clickable).

Note on the brief: section 9 asked for customer exports to be read-only for "site assumptions". This release relaxes that on purpose, at Martyn's request on 14 October. The PDF footer note is the safeguard.

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
3. **Customer changes aren't visible to Ameresco** unless the customer sends back their saved copy. There's no list of what they changed.
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
