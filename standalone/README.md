# HH Analyser: standalone file

`Ameresco-Data-Analyser.html` is the Ameresco Data Analyser in one file. There's nothing to install, no server, and no internet needed. Data never leaves the laptop it runs on.

## Using it

1. Double-click the file. It opens in Chrome or Edge.
2. Drop in meter files, **one file per meter**. Each becomes a site. Add as many as you like.
3. Set each site's **building type** and **opening hours**. Every site starts as Office / commercial, so a school, hospital or leisure centre will show the wrong out-of-hours figures until you change it. With several sites, **Set building type and opening hours for all sites at once** (above the site tiles) does them in one go; change any single site afterwards.
4. Enter the **agreed supply capacity** (kVA, from the bill) for any site where you want the headroom check.
5. Optionally add the **customer's logo** (PNG, JPG or SVG). It prints beside the Ameresco logo on every page of every PDF until you remove it or clear all data, and goes into any customer edition you make.
6. Set the **default rate** (25p/kWh fully delivered unless changed). Any site can override it.

## What you get

- **Where to start:** sites ranked by what out-of-hours use above base load costs each year.
- **Findings for each site,** priced at the unit rate: out-of-hours use, base load, weekend running, bank holidays that look like working days, base load creep year on year, unusual days and supply headroom (if you enter the agreed kVA).
- **Data quality check** on every file, graded Good, Check or Poor: missing days, zero days, dropouts, negative readings, stuck or copied (estimated) data and spikes. Each item says how it affects the numbers. Shown in the league table too.
- **Electrification headroom,** once you enter the agreed supply capacity (kVA): peak demand by month against capacity, the worst case at each time of day, and the load that can be added at any time. **Test a new load** (a heat pump's electrical input, EV charging) with its hours and season to see whether it fits, and if not, when and by how much. A safety margin (10% by default) is held back from capacity.
- **The year at a glance:** a heatmap of every half hour, with hover read-outs.
- **Every half hour, whole period:** every reading in date order (or daily totals), kWh up the side and a tick per day along the bottom. Missing days show as gaps.
- **The existing analyser charts:** day-of-week profiles, load duration, day/night split, week comparison and scatter.

## Outputs

| Output | What it is | Audience |
| --- | --- | --- |
| Site summary (PDF), on a site | One page: costs, findings, data quality and the year at a glance | Client-ready |
| Download all charts (PDF), on a site | Findings, headroom, heatmap, every chart and table | Client-ready |
| Charts as separate PDFs (zip), on a site | The same report, one PDF per chart, numbered in report order, in one zip | Client-ready, for proposals |
| Portfolio report (PDF) | Ranked table, then one page per site | Client-ready |
| Export to Excel | Summary, findings, monthly figures, profiles and the raw half-hourly data | Internal |
| Customer edition | A locked, password-protected copy of the dashboard for one customer | Customer |

Headroom uses the peak demand in the data supplied. A colder winter than the one in the file, or a fault that inflated the peak, moves the answer, so check the data quality verdict first and treat it as a screening result, not a connection study.

Costs are what each pattern costs now, at the rate entered. They aren't savings promises: how much of it can be removed is an engineering judgement on site. The PDFs say this.

## Customer editions

**Customer edition…** (on the main page, once sites are loaded) makes a locked, password-protected copy of the dashboard for one customer, holding the sites loaded now with their settings and logo.

- **Password:** by default the customer name in lower case (letters and digits only) plus the year, e.g. `compleatfoods2026`. It can be changed in the dialog.
- **What the customer can do:** explore every chart and table, change dates and filters, try a different unit rate, and download the site summary, full report, separate chart PDFs, portfolio report and a **summary** spreadsheet.
- **What they can't do:** add or remove sites, change site settings, opening hours or headroom settings, change the logo, or export the half-hourly readings to a spreadsheet. Their logo shows in the dashboard header.
- **Security:** the data is compressed and encrypted with AES-256-GCM, with the key derived from the password (PBKDF2-SHA-256, 310,000 rounds). Without the password the file holds nothing readable. Anyone who can view the charts can still read the numbers on screen; the password protects the file, not what an authorised viewer sees.

Before sending:
1. Open the file yourself with the password to check it.
2. Send the file and the password **separately** (for example the file by email, the password by phone or text).
3. Remember the standard pattern is guessable by anyone who knows it. For wider use, add a random part to the password in the dialog.

A customer edition is a snapshot: it can't be updated or withdrawn once sent. To refresh it, make a new one.

## Part-recorded days

A day with half or more of its readings blank (often the last day in an export) is left out with a note, rather than counted as zero use. Otherwise it would pull base load and the bottom of the load duration curve down to zero.

## Files it will refuse

A file with several meters stacked one after another (common in supplier portal exports) is refused with a message, rather than having different meters spliced into one profile. Split it into one file per MPAN.

## Updating the file

After changing the app, rebuild from `frontend/`:

```
npm run build:standalone
```

That writes a fresh `standalone/Ameresco-Data-Analyser.html`. Then send colleagues the new copy, because old copies don't update themselves.

`npm run test:local` runs the browser engine's tests, including a check that it still gives the same answers as the Python backend. If you change the backend maths, regenerate that reference with `python frontend/tests/parity/generate.py`.
