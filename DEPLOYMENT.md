# Deployment notes

Two things need setting by hand. Neither is optional if you want the site to
behave properly in front of a client.

## 1. Keep the backend awake

Render's free tier spins a service down after about 15 minutes idle, and the
cold start costs the first visitor 30 to 60 seconds.

`.github/workflows/keep-backend-warm.yml` pings the health endpoint every 10
minutes on weekdays. It does nothing until you set the URL:

**GitHub → Settings → Secrets and variables → Actions → Variables → New variable**

| Name | Value |
| --- | --- |
| `BACKEND_URL` | `https://your-app.onrender.com` (no trailing slash) |

Render has been known to throttle keep-alive traffic on free services, so
treat this as a mitigation rather than a fix. Render Starter is $7/month and
removes the problem outright. For anything client-facing, pay it.

## 2. Give sessions somewhere durable to live

Uploaded data is written to disk so it survives a worker restart. By default
that is the system temp directory, which on Render's free tier is **wiped
when the instance spins down**.

| Variable | Default | What it does |
| --- | --- | --- |
| `SESSION_STORE_DIR` | system temp | Where uploads are persisted |
| `SESSION_TTL_SECONDS` | `86400` | How long a session survives (24 hours) |
| `SESSION_CACHE_SIZE` | `16` | Sessions held in memory before falling back to disk |
| `PVGIS_CACHE_DIR` | system temp | Cached PVGIS generation profiles |

Point `SESSION_STORE_DIR` and `PVGIS_CACHE_DIR` at a Render persistent disk
(paid plans only) and the server side becomes genuinely durable.

Until then the browser covers the gap: after an upload the file is kept in
IndexedDB, and if the server has forgotten the session the app silently
re-uploads and retries. The user sees a slightly slower request rather than
"session not found". This works regardless of what the server does, but it
does depend on the same browser, so it will not help someone who sends a
colleague a link.

If you outgrow that, the fix is Redis or S3 behind `SessionStore` in
`backend/app/services/session_store.py`. The interface is four methods
(`save`, `get`, `delete`, `purge_expired`) and nothing else touches storage.

## Frontend build

The GitHub Pages workflow needs `VITE_API_URL` set as a repository **secret**
pointing at the backend base URL, e.g. `https://your-app.onrender.com`.

## The two areas

One upload feeds both areas, so a file is parsed once and analysed twice.

**Ameresco HH Analyser** (`/api/analyser/*`) — demand profile by day of week,
load duration curve, monthly day/night split, week comparison, and a
half-hourly scatter. Bank holidays are computed for England and Wales rather
than tabulated, so the calendar never goes stale.

**Solar Sizing** (`/api/solar/*`, `/api/report/*`) — economics-led array
sizing and the client PDF.

The night window for the day/night split defaults to a contiguous 00:00-07:00
and is selectable in the UI. The source spreadsheet used 00:30-07:00 and
counted the midnight half hour as day, which splits the night block either
side of midnight; that looked like an off-by-one rather than a tariff, so it
was not carried across.

## Running the tests

```
cd backend
pip install -r requirements.txt
python -m pytest
```

54 tests. They stub the postcode lookup and PVGIS, so they run offline and
without hitting either service.
