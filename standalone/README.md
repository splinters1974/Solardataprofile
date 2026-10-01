# HH Analyser: standalone file

`Energy-Usage-Analyser.html` is the Half Hourly Data Analyser in one file. There's nothing to install, no server, and no internet needed.

## Giving it to a colleague

1. Send them the `.html` file (email, Teams, SharePoint, USB stick).
2. They save it anywhere and double-click it. It opens in Chrome or Edge.
3. They drop their HH spreadsheet onto the page.

The file is read and analysed inside their browser. Their data never leaves their laptop, and the page makes no network calls at all.

It accepts `.xlsx`, `.xlsm`, `.xls` and `.csv`, with days down the side or across the top. "Download all charts (PDF)" produces the same report as the hosted site, using whatever date range and bank holiday setting is on screen.

Solar sizing is not in this file. It stays on the hosted site.

## Updating the file

After changing the app, rebuild from `frontend/`:

```
npm run build:standalone
```

That writes a fresh `standalone/Energy-Usage-Analyser.html`. Then send colleagues the new copy, because old copies don't update themselves.

`npm run test:local` checks the browser engine still gives the same answers as the Python backend. If you change the backend maths, regenerate the reference with `python frontend/tests/parity/generate.py`.
