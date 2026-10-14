# Data Analyser: Standard and Advanced

Two versions of the tool, each one self-contained HTML file. Nothing to install, no server, no internet. Data never leaves the laptop.

| File | What it is |
| --- | --- |
| `Ameresco-Data-Analyser-Advanced.html` | **Advanced** (green badge). Data review, calendars, opportunities tracking, base load, heatmap, unusual days, savings scenarios, capacity, time-band tariffs, carbon, project files, editable customer editions. Guide: `Ameresco-Data-Analyser-Advanced-User-Guide.pdf`. |
| `Ameresco-Data-Analyser-Standard.html` | **Standard** (grey badge). The original screening tool. Guide: `Ameresco-Data-Analyser-Standard-User-Guide.pdf`. |

The badge shows next to the name at the top of the screen, and every PDF footer names the version, so you can tell which one produced a report. Figures can differ between the two (Advanced treats missing readings as missing, not zero, and only annualises with enough data), so don't mix them in one piece of work.

What changed and what's still not done: `docs/changes/2026-10-change-log.md`.

Rebuild the Advanced version from `frontend/` with `npm run build:standalone`. The Standard version is commit 51d6437 with only its name labels changed.
