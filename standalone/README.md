# Data Analyser: standalone file

`Ameresco-Data-Analyser.html` is the Ameresco Data Analyser in one file (version 2, October 2026). There's nothing to install, no server and no internet needed. Data never leaves the laptop it runs on.

The full guide is `Ameresco-Data-Analyser-User-Guide.pdf`. What changed in version 2, and what's still not done, is in `docs/changes/2026-10-change-log.md`.

## In short

1. Double-click the file to open it in Chrome or Edge.
2. Drop in meter files, one per meter. Day-per-row, day-per-column and timestamped layouts are read, including 46/50-period clock-change days.
3. On each site, check the **Data review** tab and confirm the **Calendar** (presets start unconfirmed).
4. Set rates (flat or time bands) and, optionally, a carbon factor.
5. Read **Where to start**, **Opportunities** and each site's tabs: Overview, Base load, Heatmap, Unusual days, Savings scenarios and Capacity.
6. **Save project** keeps everything to reopen later. Export PDFs or Excel, or make a password-protected **customer edition**.

Costs are associated costs at the rates entered, not savings. Scenarios are what-ifs. Whole-site HH data shows when demand happens, not which equipment causes it.

## Rebuilding

From `frontend/`: `npm run build:standalone`.
