# HH Analyser: standalone file

`Energy-Usage-Analyser.html` is the Half Hourly Data Analyser in one file. There's nothing to install, no server, and no internet needed. Data never leaves the laptop it runs on.

## Using it

1. Double-click the file. It opens in Chrome or Edge.
2. Drop in meter files, **one file per meter**. Each becomes a site. Add as many as you like.
3. Open each site and set its **building type** and **opening hours**. Every site starts as Office / commercial, so a school, hospital or leisure centre will show the wrong out-of-hours figures until you change it.
4. Enter the **agreed supply capacity** (kVA, from the bill) for any site where you want the headroom check.
5. Set the **default rate** (25p/kWh fully delivered unless changed). Any site can override it.

## What you get

- **Where to start:** sites ranked by what out-of-hours use above base load costs each year.
- **Findings for each site,** priced at the unit rate: out-of-hours use, base load, weekend running, bank holidays that look like working days, base load creep year on year, unusual days and supply headroom (if you enter the agreed kVA).
- **Data quality check** on every file, graded Good, Check or Poor: missing days, zero days, dropouts, negative readings, stuck or copied (estimated) data and spikes. Each item says how it affects the numbers. Shown in the league table too.
- **Electrification headroom,** once you enter the agreed supply capacity (kVA): peak demand by month against capacity, the worst case at each time of day, and the load that can be added at any time. **Test a new load** (a heat pump's electrical input, EV charging) with its hours and season to see whether it fits, and if not, when and by how much. A safety margin (10% by default) is held back from capacity.
- **The year at a glance:** a heatmap of every half hour, with hover read-outs.
- **The existing analyser charts:** day-of-week profiles, load duration, day/night split, week comparison and scatter.

## Outputs

| Output | What it is | Audience |
| --- | --- | --- |
| Download all charts (PDF), on a site | Findings, heatmap, every chart and table | Client-ready |
| Portfolio report (PDF) | Ranked table, then one page per site | Client-ready |
| Export to Excel | Summary, findings, monthly figures, profiles and the raw half-hourly data | Internal |

Headroom uses the peak demand in the data supplied. A colder winter than the one in the file, or a fault that inflated the peak, moves the answer, so check the data quality verdict first and treat it as a screening result, not a connection study.

Costs are what each pattern costs now, at the rate entered. They aren't savings promises: how much of it can be removed is an engineering judgement on site. The PDFs say this.

## Files it will refuse

A file with several meters stacked one after another (common in supplier portal exports) is refused with a message, rather than having different meters spliced into one profile. Split it into one file per MPAN.

## Updating the file

After changing the app, rebuild from `frontend/`:

```
npm run build:standalone
```

That writes a fresh `standalone/Energy-Usage-Analyser.html`. Then send colleagues the new copy, because old copies don't update themselves.

`npm run test:local` runs the browser engine's tests, including a check that it still gives the same answers as the Python backend. If you change the backend maths, regenerate that reference with `python frontend/tests/parity/generate.py`.
