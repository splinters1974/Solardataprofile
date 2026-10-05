/**
 * Customer editions: a copy of this app with one customer's sites sealed
 * inside, locked down, and encrypted with a password.
 *
 * The data is compressed, then encrypted with AES-256-GCM using a key
 * derived from the password (PBKDF2, SHA-256, 310,000 rounds). Without the
 * password the file holds nothing readable. Everything happens in the
 * browser; the customer's data never goes anywhere else.
 *
 * The new file is this page's own HTML, captured before the app starts,
 * with the sealed data added as one extra block. So a customer edition is
 * always the same version of the app that made it.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { SiteSettings } from './findings';
import type { CustomerLogo } from './pdf/common';

export const EDITION_ELEMENT_ID = 'customer-edition';
const ITERATIONS = 310_000;

export interface EditionSite {
  filename: string;
  warnings: string[];
  format: 'A' | 'B';
  settings: SiteSettings;
  dates: string[];
  rows: number[][];
  /** Blank half hours by date, as [date, slots] pairs. */
  blanks?: [string, number[]][];
}

export interface EditionData {
  customer: string;
  createdAt: string;
  defaultRateP: number;
  customerLogo: CustomerLogo | null;
  sites: EditionSite[];
}

interface SealedEdition {
  v: 1;
  customer: string;
  createdAt: string;
  salt: string;
  iv: string;
  data: string;
}

/** House convention: customer name in lower case, letters and digits only, then the year made. */
export function defaultPassword(customer: string, year = new Date().getFullYear()): string {
  return `${customer.toLowerCase().replace(/[^a-z0-9]/g, '')}${year}`;
}

// --- Template capture ---------------------------------------------------------

let template: string | null = null;

/** Call once at start-up, before React changes the page. */
export function captureTemplate() {
  if (typeof document === 'undefined' || template) return;
  template = `<!doctype html>\n${document.documentElement.outerHTML}`;
}

/** The sealed block in this page, if it is a customer edition. */
export function readSealedEdition(): SealedEdition | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(EDITION_ELEMENT_ID);
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as SealedEdition;
  } catch {
    return null;
  }
}

// --- Crypto -----------------------------------------------------------------

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFor(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', strToU8(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function seal(data: EditionData, password: string): Promise<SealedEdition> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt);
  const packed = deflateSync(strToU8(JSON.stringify(data)), { level: 9 });
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed as BufferSource));
  return { v: 1, customer: data.customer, createdAt: data.createdAt, salt: b64(salt), iv: b64(iv), data: b64(cipher) };
}

/** Throws if the password is wrong: AES-GCM refuses to decrypt with the wrong key. */
export async function unseal(sealed: SealedEdition, password: string): Promise<EditionData> {
  const key = await keyFor(password, unb64(sealed.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) as BufferSource }, key, unb64(sealed.data) as BufferSource);
  } catch {
    throw new Error('That password is not right. Check it and try again.');
  }
  return JSON.parse(strFromU8(inflateSync(new Uint8Array(plain)))) as EditionData;
}

/** The finished customer file: this app's HTML plus the sealed data. */
export function editionHtml(sealed: SealedEdition): string {
  if (!template) throw new Error('This copy of the app cannot make customer editions. Reopen it and try again.');
  // Drop any sealed block already in the template, then add this one.
  const marker = `<script id="${EDITION_ELEMENT_ID}"`;
  const at = template.lastIndexOf(marker);
  const clean = at < 0 ? template : template.slice(0, at) + template.slice(template.indexOf('</script>', at) + 9);
  const block = `<script id="${EDITION_ELEMENT_ID}" type="application/json">${JSON.stringify(sealed)}</script>`;
  const title = `${sealed.customer} energy dashboard`.replace(/[<>&"]/g, '');
  // The app's own code contains strings like "</body>" and "<title>" (the
  // spreadsheet library builds HTML), so only touch the real ones: the title
  // in the head before any script, and the last </body> in the page.
  const firstScript = clean.indexOf('<script');
  const head = clean.slice(0, firstScript).replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  const rest = clean.slice(firstScript);
  const end = rest.lastIndexOf('</body>');
  if (firstScript < 0 || end < 0) throw new Error('Could not build the customer file from this copy of the app.');
  return `${head}${rest.slice(0, end)}${block}\n${rest.slice(end)}`;
}
