# Data Analyser: Standard and Advanced

Two versions of the tool, each one self-contained HTML file. Nothing to install, no server, no internet. Data never leaves the laptop.

Both are built from the same engine, so the same file gives the same numbers in both.

| File | What it is |
| --- | --- |
| `Ameresco-Data-Analyser-Standard.html` | **Standard** (grey badge). Quick screening: Overview, Data review, Calendar, Heatmap, Capacity, Charts and Settings, with findings, PDFs, Excel and customer editions. |
| `Ameresco-Data-Analyser-Advanced.html` | **Advanced** (green badge). Everything in Standard, plus Base load, Unusual days, Savings scenarios, the Opportunities and Estate comparison views, opportunity tracking, project files, the week-by-week explorer and the carbon panel. |

One guide covers both: `Ameresco-Data-Analyser-User-Guide.pdf`. The badge shows next to the name, on the customer password page and in every PDF footer.

What changed and what's still not done: `docs/changes/2026-10-change-log.md`.

To rebuild, run these from `frontend/`:

- `npm run build:standalone` builds Advanced.
- `npm run build:standard` builds Standard.
