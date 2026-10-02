/**
 * Customer editions: the password rule and the encryption round trip.
 * Run with: npm run test:local
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPassword, seal, unseal, type EditionData } from '../src/local/customerEdition';
import { defaultSettings } from '../src/local/findings';

test('standard password is the name in lower case, letters and digits only, plus the year', () => {
  assert.equal(defaultPassword('Compleat Foods', 2026), 'compleatfoods2026');
  assert.equal(defaultPassword("St Mary's NHS Trust", 2027), 'stmarysnhstrust2027');
});

const data: EditionData = {
  customer: 'Example Foods', createdAt: '2026-10-02', defaultRateP: 25, customerLogo: null,
  sites: [{
    filename: 'site.csv', warnings: [], format: 'A', settings: defaultSettings('Bakery'),
    dates: ['2026-01-01', '2026-01-02'], rows: [new Array(48).fill(1.25), new Array(48).fill(0.5)],
  }],
};

test('sealed data opens with the right password and nothing else', async () => {
  const sealed = await seal(data, 'examplefoods2026');
  assert.ok(!JSON.stringify(sealed).includes('Bakery'), 'site names are not readable in the sealed block');
  assert.deepEqual(await unseal(sealed, 'examplefoods2026'), data);
  await assert.rejects(unseal(sealed, 'examplefoods2025'), /password is not right/);
});

test('every seal uses fresh randomness, so two files never match', async () => {
  const a = await seal(data, 'examplefoods2026');
  const b = await seal(data, 'examplefoods2026');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.data, b.data);
});
