// Copy the single-file build to /standalone at the repo root, under a name
// a colleague will recognise when it lands in their downloads.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const build = process.argv[2] ?? 'advanced';
const { file, dist } = {
  advanced: { file: 'Ameresco-Data-Analyser-Advanced.html', dist: 'dist-standalone' },
  standard: { file: 'Ameresco-Data-Analyser-Standard.html', dist: 'dist-standard' },
  eon: { file: 'EON-Data-Analyser-Advanced.html', dist: 'dist-eon' },
  // The public website's analyser page.
  hhi: { file: '../website/site/analyser/index.html', dist: 'dist-hhi' },
}[build];
const target = resolve(here, `../../standalone/${file}`);
mkdirSync(dirname(target), { recursive: true });
copyFileSync(resolve(here, `../${dist}/index.html`), target);
console.log(`Standalone app written to ${target}`);
