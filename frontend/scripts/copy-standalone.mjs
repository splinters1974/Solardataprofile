// Copy the single-file build to /standalone at the repo root, under a name
// a colleague will recognise when it lands in their downloads.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../../standalone/Energy-Usage-Analyser.html');
mkdirSync(dirname(target), { recursive: true });
copyFileSync(resolve(here, '../dist-standalone/index.html'), target);
console.log(`Standalone app written to ${target}`);
