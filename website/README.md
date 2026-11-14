# Half Hourly Insights

Public website for the free half-hourly electricity analyser. Same design
language as uksolarcalculator.co.uk; not Ameresco or E.ON branded.

## What's here

| Path | What it is |
| --- | --- |
| `site/` | The published website (Netlify publishes this folder, see `netlify.toml`). Plain HTML and CSS, no build step on the server. |
| `site/analyser/index.html` | The analyser itself: a single self-contained page that runs entirely in the visitor's browser. Built from the analyser engine (see below). |
| `site/samples/example-office.csv` | A made-up year of half-hourly data for visitors to try. |
| `tools/build_pages.py` | Builds every page in `site/` from one layout (head, navigation, footer). Edit the page text there, then run `python3 tools/build_pages.py`. |

## Updating the analyser

The analyser is the same engine as the Ameresco and E.ON Data Analyser builds,
built with the Half Hourly Insights brand. From the analyser's `frontend/`
folder: `npm run build:hhi`, then copy the result to `site/analyser/index.html`.

## Before going live

- **Domain:** add canonical URLs, absolute Open Graph image URLs and a sitemap once the domain is fixed.
- **Enquiry form:** uses Netlify Forms (no third-party script). In Netlify, set form notifications to send to the inbox that should receive leads.
- **Privacy notice:** fill in who the data controller is and how long enquiries are kept (marked in `privacy.html`).
- **Footer:** add the operating company's name and contact details.
