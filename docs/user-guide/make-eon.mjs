// Builds the E.ON edition of the guide from guide.html: E.ON name, logo and
// red accent, E.ON file names and screenshots (img-eon/), and without the
// parts that only apply to Ameresco (the Standard version, the change history).
// Usage: node make-eon.mjs  →  writes guide-eon-built.html beside this file.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let html = readFileSync(resolve(here, 'guide.html'), 'utf8');
const logo = readFileSync(resolve(here, '../../frontend/src/local/eonLogo.ts'), 'utf8').match(/EON_LOGO = '([^']+)'/)[1];

const swaps = [
  // Parts that do not apply to the E.ON edition.
  [/\s*<div class="box">\s*<span class="label">Standard and Advanced<\/span>[\s\S]*?<\/div>/, ''],
  [/\s*<div class="box">\s*<span class="label">What changed in the Advanced version<\/span>[\s\S]*?<\/div>/, ''],
  [' The Standard and Advanced versions are separate files and can sit side by side.', ''],
  ['User guide · Standard and Advanced', 'User guide · Advanced'],
  // Name, files, colour words.
  ['Ameresco-Data-Analyser-Advanced.html', 'EON-Data-Analyser-Advanced.html'],
  ['Ameresco Data Analyser Advanced', 'E.ON Data Analyser Advanced'],
  ['Ameresco-branded', 'E.ON-branded'],
  ['<strong>Ameresco UK</strong>', '<strong>E.ON</strong>'],
  ['alt="Ameresco"', 'alt="E.ON"'],
  ['Use the blue <em>Set', 'Use the red <em>Set'],
  ['Internal use. Version 2.5, October 2026', 'Internal use. Version 2.7, November 2026'],
  ['download button (green arrow)', 'download button (arrow)'],
  [/src="img\//g, 'src="img-eon/'],
  ['{{LOGO}}', logo],
  // E.ON red for accents; information boxes stay neutral so they don't read as warnings.
  ['</style>', `/* E.ON edition */
:root { --blue: #ea1c0a; --green: #ea1c0a; --gtint: #eff0f1; --lime: #ff8a7a; }
.box.green .label { color: var(--ink); }
.cover .top img { height: 13mm; }
</style>`],
];
for (const [from, to] of swaps) {
  const before = html;
  html = typeof from === 'string' ? html.split(from).join(to) : html.replace(from, to);
  if (html === before) throw new Error(`make-eon: nothing matched ${from}`);
}
const left = html.match(/Ameresco/g);
if (left) throw new Error(`make-eon: ${left.length} mention(s) of Ameresco left`);
writeFileSync(resolve(here, 'guide-eon-built.html'), html);
console.log('wrote guide-eon-built.html');
