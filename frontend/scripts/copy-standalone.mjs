// Copy the single-file build to /standalone at the repo root, under a name
// a colleague will recognise when it lands in their downloads.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const standard = process.argv[2] === 'standard';
const target = resolve(here, `../../standalone/Ameresco-Data-Analyser-${standard ? 'Standard' : 'Advanced'}.html`);
mkdirSync(dirname(target), { recursive: true });
copyFileSync(resolve(here, `../${standard ? 'dist-standard' : 'dist-standalone'}/index.html`), target);
console.log(`Standalone app written to ${target}`);
