# User guide source

`guide.html` is the source of `standalone/Ameresco-Data-Analyser-User-Guide.pdf`. Screenshots are in `img/`, taken from the app with synthetic sample data.

To rebuild after editing: replace `{{LOGO}}` in `guide.html` with the contents of `logo.txt`, save as `guide-built.html`, then run `node render.mjs "$PWD"` (needs Playwright and Chromium) and move the PDF to `standalone/`. The render keeps each sub-section (a heading and what follows it) on one page. Fonts: Schibsted Grotesk, SIL Open Font License (`fonts/OFL.txt`).
