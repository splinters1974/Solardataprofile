/**
 * Saving and reopening work: project files and the data inside customer
 * editions share one serialised form of a site.
 *
 * A project file holds the raw readings exactly as read (not the adjusted
 * frame), every setting and review decision, action statuses and scenarios,
 * so reopening it gives the same answers. It is compressed JSON with a
 * schema name and version; files from a newer version are refused rather
 * than half-read.
 */
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { Frame, RawData } from './frame';
import type { LongSeries, ParseInfo } from './parser';
import { normaliseSettings, type SiteSettings } from './site';
import type { ActionStore } from './actions';
import type { Scenario } from './scenarios';
import type { CarbonFactor } from './findings';
import type { CustomerLogo } from './pdf/common';

export const PROJECT_SCHEMA = 'ameresco-data-analyser-project';
export const PROJECT_VERSION = 1;

export interface SerialSite {
  filename: string;
  warnings: string[];
  format: 'A' | 'B';
  info?: ParseInfo;
  settings: SiteSettings;
  unit?: 'kWh' | 'kW';
  dates: string[];
  rows: number[][];
  flags?: (number[] | null)[];
  dstExtraKwh?: number[];
  conflicts?: RawData['conflicts'];
  long?: LongSeries;
  actions?: ActionStore;
  scenarios?: Scenario[];
  /** Earlier editions: blank half hours by date. */
  blanks?: [string, number[]][];
}

export interface ProjectFile {
  schema: typeof PROJECT_SCHEMA;
  version: number;
  savedAt: string;
  title: string;
  defaultRateP: number;
  carbon: CarbonFactor | null;
  customerLogo: CustomerLogo | null;
  sites: SerialSite[];
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function serialiseFrame(f: Frame) {
  return {
    dates: f.dates,
    rows: f.rows.map((r) => r.map(r4)),
    flags: f.flags ? f.flags.map((fl) => (fl ? Array.from(fl) : null)) : undefined,
    dstExtraKwh: f.dstExtraKwh,
  };
}

/** Rebuild raw data from a serialised site, including the older "blanks" form. */
export function rawFromSerial(s: SerialSite): RawData {
  let flags: (Uint8Array | null)[] | undefined;
  if (s.flags) flags = s.flags.map((fl) => (fl ? Uint8Array.from(fl) : null));
  else if (s.blanks?.length) {
    const byDate = new Map(s.blanks);
    flags = s.dates.map((d) => {
      const slots = byDate.get(d);
      if (!slots?.length) return null;
      const fl = new Uint8Array(48);
      for (const k of slots) fl[k] = 1;
      return fl;
    });
  }
  return {
    frame: { dates: s.dates, rows: s.rows, flags, dstExtraKwh: s.dstExtraKwh },
    unit: s.unit ?? 'kWh',
    conflicts: s.conflicts ?? [],
  };
}

export const settingsFromSerial = (s: SerialSite) =>
  normaliseSettings(s.settings as Parameters<typeof normaliseSettings>[0]);

export function encodeProject(p: Omit<ProjectFile, 'schema' | 'version' | 'savedAt'>): Uint8Array {
  const file: ProjectFile = { schema: PROJECT_SCHEMA, version: PROJECT_VERSION, savedAt: new Date().toISOString(), ...p };
  return gzipSync(strToU8(JSON.stringify(file)), { level: 6 });
}

export function decodeProject(bytes: Uint8Array): ProjectFile {
  let text: string;
  try {
    text = strFromU8(gunzipSync(bytes));
  } catch {
    throw new Error('That file is not a Data Analyser project.');
  }
  const p = JSON.parse(text) as ProjectFile;
  if (p.schema !== PROJECT_SCHEMA) throw new Error('That file is not a Data Analyser project.');
  if (p.version > PROJECT_VERSION) {
    throw new Error(`This project was saved by a newer version of the Data Analyser (format ${p.version}). Open it in that version.`);
  }
  return p;
}
