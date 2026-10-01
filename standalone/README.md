# Energy Usage Analyser: standalone file

`Energy-Usage-Analyser.html` is the whole app in one file. There's nothing to install and no server.

## Giving it to a colleague

1. Send them the `.html` file (email, Teams, SharePoint, USB stick).
2. They save it anywhere and double-click it. It opens in Chrome or Edge.
3. They drop their HH spreadsheet onto the page.

Their data never leaves their laptop. The file is read and analysed inside the browser.

## What needs the internet

Only the Solar Sizing area, and only for two lookups:

| Lookup | Offline fallback |
| --- | --- |
| Postcode to location (postcodes.io) | Type latitude and longitude into the postcode box, e.g. `51.50, -0.12` |
| Solar generation for the site (PVGIS) | Built-in typical-year solar model, flagged on screen and in the PDF as an estimate (roughly 10% on annual yield) |

The HH Analyser works fully offline.

If PVGIS is reached once for a site, the result is remembered in that browser, so re-running the same site later works offline at full accuracy.

## Updating the file

After changing the app, rebuild from `frontend/`:

```
npm run build:standalone
```

That writes a fresh `standalone/Energy-Usage-Analyser.html`. Then send colleagues the new copy, because old copies don't update themselves.

`npm run test:local` checks the browser engine still gives the same answers as the Python backend. If you change the backend maths, regenerate the reference with `python frontend/tests/parity/generate.py`.
