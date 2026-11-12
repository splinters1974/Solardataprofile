# User guide source

`guide.html` is the source of `standalone/Ameresco-Data-Analyser-User-Guide.pdf`. Screenshots are in `img/`, taken from the app with synthetic sample data.

To rebuild after editing: replace `{{LOGO}}` in `guide.html` with the contents of `logo.txt`, save as `guide-built.html`, then run `node render.mjs "$PWD"` (needs Playwright and Chromium) and move the PDF to `standalone/`. The render keeps each sub-section (a heading and what follows it) on one page. Fonts: Schibsted Grotesk, SIL Open Font License (`fonts/OFL.txt`).

## E.ON edition

`make-eon.mjs` builds `guide-eon-built.html` from `guide.html`: E.ON name, logo and red accents, E.ON file names, screenshots from `img-eon/` (taken from `EON-Data-Analyser-Advanced.html`), and without the Standard-version and change-history boxes. It stops with an error if any "Ameresco" is left. Then render it with:

`node render.mjs "$PWD" guide-eon-built.html EON-Data-Analyser-User-Guide.pdf "E.ON &middot; Data Analyser Advanced &middot; User guide"`

and move the PDF to `standalone/`. Edit `guide.html` only; both editions follow it.
