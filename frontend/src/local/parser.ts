/**
 * Read an HH data file into a (days x 48) frame, in the browser.
 *
 * Two layouts are read: one row per day with 48 (or 50) readings, either way
 * round, or one row per reading with a timestamp. Readings that cannot be
 * used are kept as flagged gaps, never as zero use. Clock-change days are
 * mapped to clock time where the layout makes that safe, and suppressed with
 * a note where it does not.
 *
 * Port of backend/app/services/excel_parser.py for the day-per-row layout,
 * with these deliberate differences: blanks and text are missing readings,
 * not zeros; conflicting duplicate days are kept visible and suppressed;
 * clock-change days are handled; a transposed file keeps its dates.
 */
import * as XLSX from 'xlsx';
import {
  addDays, dayNum, fromNaiveMinutes, isFallBack, isSpringForward, iso, isValidDate, MONTHS_SHORT,
  naiveMinutes, utcToLondon,
} from './dates';
import { FLAG, SLOTS, type Frame, type RawData } from './frame';

export type { Frame } from './frame';

// The browser (ES module) build exports SSF by name; Node's CommonJS build,
// used by the tests, only has it on the default export.
const SSF: typeof XLSX.SSF = (XLSX as { SSF?: typeof XLSX.SSF }).SSF
  ?? (XLSX as unknown as { default: { SSF: typeof XLSX.SSF } }).default.SSF;

export type TimeConvention = 'start' | 'end';

/** One row per reading, kept so the timestamps can be re-read another way. */
export interface LongSeries {
  /** Timestamp as written, in minutes since 1970 ignoring time zones. */
  t: number[];
  /** Reading, or null when blank; NaN when the cell held text. */
  v: (number | null)[];
  /** Timestamps carried a UTC marker (Z or +00:00). */
  utc: boolean;
}

export interface ParseInfo {
  layout: 'day-rows' | 'day-columns' | 'timestamped';
  /** Meter or MPAN reference found in the file, if any. */
  meterId: string;
  /** Unit the readings appear to be in. kW readings are converted to kWh per half hour. */
  unit: 'kWh' | 'kW';
  unitEvidence: string;
  /** Whether times mark the start or the end of each half hour. */
  convention: TimeConvention;
  conventionEvidence: string;
  /** How the file's clock times were treated. */
  clockNote: string;
}

export interface Parsed {
  raw: RawData;
  /** The raw frame, in the file's unit. */
  frame: Frame;
  format: 'A' | 'B';
  info: ParseInfo;
  warnings: string[];
  long?: LongSeries;
}

/** A cell that Excel stored as a date, with the time of day when it had one. */
interface DateCell { date: string; minute?: number }
type Cell = number | string | DateCell | null;

const isDateCell = (v: Cell): v is DateCell =>
  typeof v === 'object' && v !== null && 'date' in v;

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function toNumber(v: Cell): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string') {
    const s = v.trim();
    return NUMERIC.test(s) ? Number(s) : NaN;
  }
  return NaN;
}

const isNumeric = (v: Cell) => !Number.isNaN(toNumber(v));
const isBlank = (c: Cell) => c === null || (typeof c === 'string' && !c.trim());

// --- Dates ----------------------------------------------------------------

const DATE_LIKE = [
  /^\d{4}-\d{2}-\d{2}([ T]\d{1,2}:\d{2}(:\d{2})?.*)?$/,
  /^\d{2}\/\d{2}\/\d{4}( \d{1,2}:\d{2}(:\d{2})?)?$/,
  /^\d{2}-\d{2}-\d{4}( \d{1,2}:\d{2}(:\d{2})?)?$/,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}( \d{1,2}:\d{2}(:\d{2})?)?$/,
  /^\d{1,2}[ -][A-Za-z]{3,9}[ -]\d{2,4}( \d{1,2}:\d{2}(:\d{2})?)?$/,
];

function isDateLike(v: Cell): boolean {
  if (isDateCell(v)) return true;
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return DATE_LIKE.some((p) => p.test(s));
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

/** Day-first (UK) date parsing. Returns null where there is no usable date. */
export function parseDate(v: Cell): string | null {
  if (isDateCell(v)) return v.date;
  if (typeof v !== 'string') return null;
  const s = v.trim();

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidDate(y, mo, d) ? iso(y, mo, d) : null;
  }

  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\s.*)?$/);
  if (m) {
    let d = Number(m[1]);
    let mo = Number(m[2]);
    const y = fullYear(Number(m[3]));
    // Day first, but a US-style date with a day above 12 can only be read
    // one way, which is what pandas does too.
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    return isValidDate(y, mo, d) ? iso(y, mo, d) : null;
  }

  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})[ -,]*(\d{2,4})(?:\s.*)?$/);
  if (m) {
    const mo = MONTHS_SHORT.findIndex(
      (name) => name.toLowerCase() === m![2].slice(0, 3).toLowerCase(),
    ) + 1;
    const y = fullYear(Number(m[3]));
    const d = Number(m[1]);
    return mo && isValidDate(y, mo, d) ? iso(y, mo, d) : null;
  }
  return null;
}

/** Minute of the day from "hh:mm", "hh:mm:ss" or the time part of a date-time. 24:00 reads as 1440. */
function parseTime(v: Cell): number | null {
  if (isDateCell(v)) return v.minute ?? null;
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/(?:^|[ T])(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC))?$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min)) return null;
  return h * 60 + min;
}

const hasUtcMarker = (v: Cell) => typeof v === 'string' && /(Z|[+-]00:?00|\bUTC|\bGMT)\s*$/i.test(v.trim());

// --- Reading --------------------------------------------------------------

function rectangular(rows: Cell[][]): Cell[][] {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map((r) => {
    const out = r.slice();
    while (out.length < width) out.push(null);
    return out;
  });
}

/** Pick the delimiter that splits the opening lines most consistently. */
function sniffDelimiter(text: string): string {
  const lines = text.slice(0, 8192).split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  let best = ',';
  let bestScore = -1;
  for (const delim of [',', '\t', ';', '|']) {
    const counts = lines.map((l) => l.split(delim).length - 1).filter((c) => c > 0);
    if (!counts.length) continue;
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    const [mode, hits] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    const score = hits * mode;
    if (score > bestScore) { best = delim; bestScore = score; }
  }
  return best;
}

function readCsv(text: string): Cell[][] {
  const delim = sniffDelimiter(text);
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;

  const pushField = () => {
    const s = wasQuoted ? field : field.trim();
    row.push(s === '' ? null : s);
    field = '';
    wasQuoted = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (ch === delim) {
      pushField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushField();
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { pushField(); rows.push(row); }

  // pandas drops wholly blank lines from a CSV.
  return rectangular(rows.filter((r) => r.some((c) => c !== null)));
}

function sheetToCells(ws: XLSX.WorkSheet): Cell[][] {
  if (!ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows: Cell[][] = [];
  for (let r = 0; r <= range.e.r; r++) {
    const row: Cell[] = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (!cell || cell.v === undefined || cell.v === null) { row.push(null); continue; }
      if (cell.t === 'n') {
        const v = cell.v as number;
        if (cell.z && SSF.is_date(cell.z as string)) {
          const p = SSF.parse_date_code(v);
          if (p && v < 1) {
            // A time on its own.
            row.push(`${String(p.H).padStart(2, '0')}:${String(p.M).padStart(2, '0')}`);
          } else if (p && isValidDate(p.y, p.m, p.d)) {
            const minute = v % 1 ? p.H * 60 + p.M + (p.S >= 30 ? 1 : 0) : undefined;
            row.push({ date: iso(p.y, p.m, p.d), minute });
          } else row.push(null);
        } else row.push(v);
      } else if (cell.t === 'd') {
        const d = cell.v as Date;
        const minute = d.getHours() * 60 + d.getMinutes();
        row.push({ date: iso(d.getFullYear(), d.getMonth() + 1, d.getDate()), minute: minute || undefined });
      } else if (cell.t === 's') {
        row.push(String(cell.v));
      } else row.push(null);
    }
    rows.push(row);
  }
  // Trailing blank rows carry nothing and only skew the shape checks.
  while (rows.length && rows[rows.length - 1].every((c) => c === null)) rows.pop();
  return rows;
}

/** How much a sheet looks like a block of HH readings. */
function sheetScore(rows: Cell[][]): number {
  if (!rows.length) return 0;
  const width = rows[0].length;
  const wideRows = rows.filter((r) => r.filter(isNumeric).length >= 40).length;
  if (wideRows) return wideRows;
  let wideCols = 0;
  for (let c = 0; c < width; c++) {
    let n = 0;
    for (const r of rows) if (isNumeric(r[c])) n++;
    if (n >= 40) wideCols++;
  }
  // A timestamped sheet scores below any day-per-row block.
  return wideCols >= 40 ? wideCols : (longShape(rows) ? 0.5 : wideCols);
}

function readWorkbook(bytes: ArrayBuffer): Cell[][] {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(new Uint8Array(bytes), { type: 'array', cellNF: true, cellDates: false });
  } catch (e) {
    throw new Error(
      `Could not read file. Please save as .xlsx or .csv and try again. (${(e as Error).message})`,
      { cause: e },
    );
  }
  const sheets = book.SheetNames.map((name) => rectangular(sheetToCells(book.Sheets[name])));
  const scored = sheets
    .map((rows, i) => ({ rows, score: sheetScore(rows), i }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  if (scored.length && scored[0].score > 0) return scored[0].rows;
  return sheets.find((s) => s.length) ?? [];
}

// --- Shaping --------------------------------------------------------------

/** Drop up to 8 leading title rows: rows where under 10% of cells are numbers. */
function stripTitleRows(rows: Cell[][]): { body: Cell[][]; titles: Cell[][] } {
  let out = rows;
  const titles: Cell[][] = [];
  for (let i = 0; i < 8 && out.length; i++) {
    const row = out[0];
    const frac = row.length ? row.filter(isNumeric).length / row.length : 0;
    if (frac < 0.1) { titles.push(row); out = out.slice(1); } else break;
  }
  return { body: out, titles };
}

function transpose(rows: Cell[][]): Cell[][] {
  if (!rows.length) return [];
  return rows[0].map((_, c) => rows.map((r) => r[c]));
}

const TIME_LABEL = /^\d{1,2}:\d{2}$|^HH\s*\d{1,2}$|^Period\s*\d+$|^SP\s*\d+$/i;
const countTimeLabels = (cells: Cell[]) =>
  cells.filter((v) => v !== null && TIME_LABEL.test(String(v).trim())).length;

/**
 * Days down the side (A) or days across the top (B)?
 *
 * Time-of-day labels settle it when present. Otherwise compare the block of
 * readings: in A it is 48 numbers wide, in B it is 48 numbers tall.
 */
function detectFormat(raw: Cell[][]): 'A' | 'B' {
  const firstCol = raw.map((r) => r[0]);
  const firstRow = raw[0] ?? [];
  const colTimes = countTimeLabels(firstCol);
  const rowTimes = countTimeLabels(firstRow);
  if (colTimes >= 24 && colTimes > rowTimes) return 'B';
  if (rowTimes >= 24) return 'A';

  const { body } = stripTitleRows(raw);
  const width = body[0]?.length ?? 0;
  const numericRows = body.filter((r) => r.filter(isNumeric).length >= 24).length;
  let numericCols = 0;
  for (let c = 0; c < width; c++) {
    let n = 0;
    for (const r of body) if (isNumeric(r[c])) n++;
    if (n >= 24) numericCols++;
  }
  return Math.abs(numericRows - 48) < Math.abs(numericCols - 48) ? 'B' : 'A';
}

/**
 * Strip identifier columns down to the readings, keeping any date column and
 * the identifiers (for the meter reference). Readings start straight after
 * the date; up to 50 are kept for the clock-change periods.
 */
function stripLeadingColumns(rows: Cell[][]): { body: Cell[][]; dates: Cell[]; lead: Cell[][]; leadCount: number } {
  let body = rows;
  let dates: Cell[] = [];
  const lead: Cell[][] = [];
  let leadCount = 0;
  for (let i = 0; i < 10; i++) {
    const width = body[0]?.length ?? 0;
    if (width <= 48) break;
    const col0 = body.map((r) => r[0]);
    const isDate = col0.filter(isDateLike).length > col0.length * 0.3;
    if (isDate) dates = col0; else lead.push(col0);
    body = body.map((r) => r.slice(1));
    leadCount++;
    // Anything still over 48 after the date is at the end of the row (the two
    // clock-change periods in a 50-period export), so stop here: stripping more
    // from the front would lose 00:00 to 01:00 and shift every reading.
    if (isDate) break;
  }
  if ((body[0]?.length ?? 0) > 50) body = body.map((r) => r.slice(0, 50));
  return { body, dates, lead, leadCount };
}

/**
 * Dates that appear more than once with different readings.
 *
 * Many repeats mean the file holds several meters stacked one after another,
 * common in supplier portal exports. Splicing them into one profile would be
 * wrong without anyone noticing, so the file is refused and the reason given.
 */
function checkRepeats(repeats: number, unique: number) {
  if (repeats >= 10 && repeats >= unique * 0.2) {
    throw new Error(
      `This file looks like it holds more than one meter: ${repeats} rows repeat a date `
      + 'already in the file. Split it into one file per meter (one MPAN each) and '
      + 'load them as separate sites.',
    );
  }
}

// --- Meter reference and unit ----------------------------------------------------

const METER_HEADER = /\b(mpan|mprn|meter|serial|msn|supply\s*number)\b/i;
const METER_VALUE = /^\s*(\d{2}\s?\d{4}\s?\d{4}\s?\d{3}|\d{13}|\d{21}|[A-Z]{1,4}\d{5,12}[A-Z]?)\s*$/i;

function findMeterId(titles: Cell[][], lead: Cell[][], header: Cell[] | null): string {
  // A label cell followed by its value in the title block.
  for (const row of titles) {
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (typeof v === 'string' && METER_HEADER.test(v)) {
        const next = row.slice(c + 1).find((x) => x !== null);
        if (next !== undefined && next !== null && METER_VALUE.test(String(next))) return String(next).trim();
        const inline = v.match(/(?:MPAN|MPRN|Meter)[^0-9A-Z]*([0-9][0-9 ]{9,24})/i);
        if (inline && METER_VALUE.test(inline[1])) return inline[1].trim();
      }
    }
  }
  // An identifier column ahead of the readings.
  for (let k = 0; k < lead.length; k++) {
    const col = lead[k];
    const name = header?.[k];
    const values = col.filter((v) => v !== null).map(String);
    const looks = values.length > 0 && values.filter((v) => METER_VALUE.test(v)).length > values.length * 0.8;
    if (looks || (typeof name === 'string' && METER_HEADER.test(name) && values.length)) {
      return values[0].trim();
    }
  }
  return '';
}

function findUnit(texts: string[]): { unit: 'kWh' | 'kW'; evidence: string } {
  const all = texts.join(' ');
  const kwh = /\bkwh\b/i.test(all);
  const kw = /\bkw\b(?!h)/i.test(all);
  if (kw && !kwh) {
    return { unit: 'kW', evidence: 'Headings name kW (average demand), not kWh, so readings are converted to kWh per half hour (kW x 0.5).' };
  }
  return {
    unit: 'kWh',
    evidence: kwh ? 'Headings name kWh.' : 'No unit in the headings; read as kWh per half hour, the usual export.',
  };
}

// --- Day-per-row layout -----------------------------------------------------------

/** What each reading column means, from its heading. */
function columnConvention(header: Cell[] | null): { convention: TimeConvention; evidence: string } {
  const none = { convention: 'start' as const, evidence: 'No time headings; readings taken to run from 00:00 in order.' };
  if (!header) return none;
  const first = header.find((c) => c !== null && TIME_LABEL.test(String(c).trim()));
  if (first === undefined || first === null) return none;
  const t = parseTime(String(first).trim());
  if (t === 30) return { convention: 'end', evidence: 'Columns are labelled by the end of each half hour (00:30 first). Column 1 is 00:00 to 00:30.' };
  if (t === 0) return { convention: 'start', evidence: 'Columns are labelled by the start of each half hour (00:00 first).' };
  return { convention: 'start', evidence: 'Columns are numbered periods; period 1 is 00:00 to 00:30.' };
}

interface DayRow { date: string; values: number[]; flags: Uint8Array; extra: number }

/**
 * Put one day's cells into 48 clock-time slots. Spring and autumn clock-change
 * days hold 46 and 50 half hours; where the layout shows which periods are
 * which they are mapped, and where it does not the day is flagged unsafe.
 */
function mapDay(cells: Cell[], date: string | null, notes: Set<string>): DayRow {
  const values = new Array(SLOTS).fill(0);
  const flags = new Uint8Array(SLOTS);
  let extra = 0;
  const read = (c: Cell): [number, number] => {
    if (isBlank(c)) return [0, FLAG.BLANK];
    const n = toNumber(c);
    return Number.isNaN(n) ? [0, FLAG.TEXT] : [n, 0];
  };
  const put = (slot: number, c: Cell) => { const [v, f] = read(c); values[slot] = v; flags[slot] = f; };
  const width = cells.length;
  const blank = (k: number) => k >= width || isBlank(cells[k]);
  // On a clock-change day, a period that did not happen is often written as 0.
  const empty = (k: number) => blank(k) || toNumber(cells[k]) === 0;

  if (date && isSpringForward(date)) {
    // 46 periods. Settlement layout: 46 readings then blanks. Clock layout: 01:00 and 01:30 blank.
    const spLayout = empty(46) && empty(47) && !(empty(2) && empty(3));
    const clockLayout = empty(2) && empty(3) && !empty(46) && !empty(47);
    if (spLayout) {
      for (let k = 0; k < 46; k++) put(k < 2 ? k : k + 2, cells[k]);
      flags[2] = FLAG.DST_GAP; flags[3] = FLAG.DST_GAP;
      notes.add('Spring clock-change days hold 46 periods, so readings after 01:00 were moved to clock time from 02:00.');
    } else if (clockLayout) {
      for (let k = 0; k < SLOTS; k++) if (k !== 2 && k !== 3) put(k, cells[k]);
      flags[2] = FLAG.DST_GAP; flags[3] = FLAG.DST_GAP;
      notes.add('Spring clock-change days are already in clock time (01:00 to 02:00 blank).');
    } else {
      for (let k = 0; k < SLOTS; k++) put(k, cells[k]);
      for (let k = 0; k < SLOTS; k++) if (!flags[k]) flags[k] = FLAG.DST_UNSAFE;
      notes.add(`The spring clock-change day (${date}) has 48 readings, so it is not clear which hour is missing. `
        + 'It is left out of the analysis. Keep it on the Data review tab if you have checked the file.');
    }
    return { date, values, flags, extra };
  }

  if (date && isFallBack(date)) {
    if (width >= 50 && !blank(48) && !blank(49)) {
      // 50 periods: 00:00-02:00 BST, the repeated 01:00-02:00 GMT, then 02:00 onwards.
      for (let k = 0; k < 50; k++) {
        if (k === 4 || k === 5) { const [v, f] = read(cells[k]); if (!f) extra += v; continue; }
        put(k < 4 ? k : k - 2, cells[k]);
      }
      notes.add('Autumn clock-change days hold 50 periods. The repeated hour is counted in totals but kept out of '
        + 'time-of-day profiles.');
    } else {
      for (let k = 0; k < SLOTS; k++) put(k, cells[k]);
      for (let k = 0; k < SLOTS; k++) if (!flags[k]) flags[k] = FLAG.DST_UNSAFE;
      notes.add(`The autumn clock-change day (${date}) has 48 readings, so the repeated hour was dropped or merged. `
        + 'It is left out of the analysis. Keep it on the Data review tab if you have checked the file.');
    }
    return { date, values, flags, extra };
  }

  for (let k = 0; k < SLOTS; k++) put(k, cells[k]);
  if (width > SLOTS && (!empty(48) || !empty(49))) {
    notes.add('Some ordinary days have readings in columns 49 and 50. Only the first 48 were used.');
  }
  return { date: date ?? '', values, flags, extra };
}

// --- Timestamped layout (one reading per row) ----------------------------------------

/** Columns of a timestamped file: a date-time (or date and time) and a reading. */
function longShape(rows: Cell[][]): { dt: number; time: number | null; value: number; start: number } | null {
  const { body } = stripTitleRows(rows);
  if (body.length < 96) return null;
  const width = body[0]?.length ?? 0;
  if (width > 12) return null;
  const sample = body.slice(0, 400);
  let dt = -1;
  let time: number | null = null;
  for (let c = 0; c < width && dt < 0; c++) {
    const withTime = sample.filter((r) => isDateLike(r[c]) && parseTime(r[c]) !== null).length;
    if (withTime > sample.length * 0.8) dt = c;
  }
  if (dt < 0) {
    for (let c = 0; c < width - 1 && dt < 0; c++) {
      const dates = sample.filter((r) => parseDate(r[c]) !== null).length;
      if (dates < sample.length * 0.8) continue;
      for (let c2 = 0; c2 < width; c2++) {
        if (c2 === c) continue;
        const times = sample.filter((r) => typeof r[c2] === 'string' && parseTime(` ${r[c2]}`) !== null).length;
        if (times > sample.length * 0.8) { dt = c; time = c2; break; }
      }
    }
  }
  if (dt < 0) return null;
  let value = -1;
  for (let c = width - 1; c >= 0; c--) {
    if (c === dt || c === time) continue;
    const n = sample.filter((r) => isNumeric(r[c]) || isBlank(r[c])).length;
    const real = sample.filter((r) => isNumeric(r[c])).length;
    if (n > sample.length * 0.9 && real > sample.length * 0.5) { value = c; break; }
  }
  if (value < 0) return null;
  return { dt, time, value, start: rows.length - body.length };
}

function readLong(rows: Cell[][], shape: NonNullable<ReturnType<typeof longShape>>): LongSeries {
  const t: number[] = [];
  const v: (number | null)[] = [];
  let utc = 0;
  for (const r of rows.slice(shape.start)) {
    const d = parseDate(r[shape.dt]);
    const minute = shape.time === null ? parseTime(r[shape.dt]) : parseTime(` ${r[shape.time]}`);
    if (!d || minute === null) continue;
    if (hasUtcMarker(r[shape.dt])) utc++;
    t.push(naiveMinutes(d, minute));
    const c = r[shape.value];
    v.push(isBlank(c) ? null : toNumber(c));
  }
  return { t, v, utc: utc > t.length * 0.5 };
}

/** Which way a timestamped file marks its half hours. */
export function detectLongConvention(long: LongSeries): { convention: TimeConvention; evidence: string } {
  if (!long.t.length) return { convention: 'start', evidence: '' };
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of long.t) { if (x < lo) lo = x; if (x > hi) hi = x; }
  const first = fromNaiveMinutes(lo).minute;
  const last = fromNaiveMinutes(hi).minute;
  if (first === 30 && last === 0) {
    return { convention: 'end', evidence: 'Timestamps run from 00:30 to 00:00, so each marks the end of its half hour.' };
  }
  if (first === 0 && last === 1410) {
    return { convention: 'start', evidence: 'Timestamps run from 00:00 to 23:30, so each marks the start of its half hour.' };
  }
  return first % 60 === 30
    ? { convention: 'end', evidence: 'The first timestamp is on the half hour, so read as the end of each half hour. Check this on the Data review tab.' }
    : { convention: 'start', evidence: 'Read as the start of each half hour. Check this on the Data review tab.' };
}

/**
 * Put timestamped readings into clock-time days. 15-minute readings are
 * summed into half hours; hourly data is refused. Times are UK local unless
 * marked UTC, or unless the clock-change days show they are GMT all year.
 */
export function gridLong(long: LongSeries, convention: TimeConvention): {
  rows: DayRow[]; conflicts: { date: string; second: number[] }[]; notes: string[];
} {
  const notes: string[] = [];
  const order = long.t.map((_, i) => i).sort((a, b) => long.t[a] - long.t[b]);
  const diffs: number[] = [];
  for (let k = 1; k < Math.min(order.length, 2000); k++) {
    const d = long.t[order[k]] - long.t[order[k - 1]];
    if (d > 0) diffs.push(d);
  }
  diffs.sort((a, b) => a - b);
  const step = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 30;
  if (step > 30) {
    throw new Error(`These readings are ${step} minutes apart. The analyser needs half-hourly (or 15-minute) data.`);
  }
  if (step < 30) notes.push(`Readings are ${step} minutes apart and were summed into half hours. A half hour with any part missing is treated as missing.`);

  // Interval start, in source time.
  const shift = convention === 'end' ? -step : 0;
  let starts = order.map((i) => long.t[i] + shift);

  // Time zone: explicit UTC, or GMT all year (no spring gap, no autumn repeat).
  let gmtAllYear = long.utc;
  if (!gmtAllYear) {
    const seen = new Map<number, number>();
    for (const t of starts) seen.set(t, (seen.get(t) ?? 0) + 1);
    const days = new Set(starts.map((t) => fromNaiveMinutes(t).date));
    const springs = [...days].filter(isSpringForward);
    const falls = [...days].filter(isFallBack);
    const springHasGapTimes = springs.some((d) => seen.has(naiveMinutes(d, 60)) || seen.has(naiveMinutes(d, 90)));
    const fallRepeats = falls.some((d) => (seen.get(naiveMinutes(d, 60)) ?? 0) > 1);
    if (springs.length && springHasGapTimes && !fallRepeats) gmtAllYear = true;
  }
  if (gmtAllYear) {
    starts = starts.map(utcToLondon);
    notes.push(long.utc
      ? 'Timestamps are marked UTC and were converted to UK clock time (BST in summer).'
      : 'Timestamps look like GMT all year (no clock changes) and were converted to UK clock time (BST in summer).');
  }

  // Accumulate into days and slots.
  interface Acc { values: number[]; flags: Uint8Array; parts: number[]; text: boolean[]; extra: number; second: number[] | null }
  const days = new Map<string, Acc>();
  const perSlot = Math.max(1, Math.round(30 / step));
  const get = (date: string) => {
    let a = days.get(date);
    if (!a) {
      a = {
        values: new Array(SLOTS).fill(0), flags: new Uint8Array(SLOTS).fill(FLAG.BLANK),
        parts: new Array(SLOTS).fill(0), text: new Array(SLOTS).fill(false), extra: 0, second: null,
      };
      days.set(date, a);
    }
    return a;
  };
  const seenKey = new Map<number, number>();
  order.forEach((idx, k) => {
    const start = starts[k];
    const { date, minute } = fromNaiveMinutes(start);
    const slot = Math.floor(minute / 30);
    const a = get(date);
    const value = long.v[idx];
    const count = (seenKey.get(start) ?? 0) + 1;
    seenKey.set(start, count);
    if (count > 1) {
      // A second reading for the same time: the autumn repeated hour, or a duplicate.
      if (isFallBack(date) && (slot === 2 || slot === 3) && !gmtAllYear && count === 2) {
        if (value !== null && !Number.isNaN(value)) a.extra += value;
        return;
      }
      if (value !== null && !Number.isNaN(value) && value !== a.values[slot]) {
        if (!a.second) a.second = a.values.slice();
        a.second[slot] = value;
      }
      return;
    }
    if (value === null) return; // stays blank
    if (Number.isNaN(value)) { a.text[slot] = true; return; }
    a.values[slot] += value;
    a.parts[slot] += 1;
  });

  const rows: DayRow[] = [];
  const conflicts: { date: string; second: number[] }[] = [];
  for (const [date, a] of [...days.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    for (let s = 0; s < SLOTS; s++) {
      if (a.parts[s] >= perSlot) a.flags[s] = 0;
      else {
        a.flags[s] = a.text[s] ? FLAG.TEXT : FLAG.BLANK;
        a.values[s] = 0;
      }
    }
    if (isSpringForward(date)) {
      a.flags[2] = FLAG.DST_GAP; a.flags[3] = FLAG.DST_GAP;
      a.values[2] = 0; a.values[3] = 0;
    }
    if (a.second) {
      conflicts.push({ date, second: a.second });
      for (let s = 0; s < SLOTS; s++) if (!a.flags[s]) a.flags[s] = FLAG.DUPLICATE;
    }
    rows.push({ date, values: a.values, flags: a.flags, extra: a.extra });
  }
  if (rows.some((r) => r.extra)) {
    notes.push('The repeated hour on autumn clock-change days is counted in totals but kept out of time-of-day profiles.');
  }
  return { rows, conflicts, notes };
}

// --- Assembly ---------------------------------------------------------------------

function toFrame(days: DayRow[]): Frame {
  const flags = days.map((d) => (d.flags.some((f) => f) ? d.flags : null));
  const extra = days.map((d) => d.extra);
  return {
    dates: days.map((d) => d.date),
    rows: days.map((d) => d.values),
    flags: flags.some(Boolean) ? flags : undefined,
    dstExtraKwh: extra.some((x) => x) ? extra : undefined,
  };
}

function countFlags(days: DayRow[], code: number) {
  let n = 0;
  for (const d of days) for (let s = 0; s < SLOTS; s++) if (d.flags[s] === code) n++;
  return n;
}

/** Notes common to every layout: missing readings, coverage, gaps. */
function commonNotes(days: DayRow[], warnings: string[]) {
  const blanks = countFlags(days, FLAG.BLANK);
  const text = countFlags(days, FLAG.TEXT);
  if (text) warnings.push(`${text} reading cell(s) held text instead of a number. Treated as missing, not zero.`);
  if (blanks) {
    const affected = days.filter((d) => d.flags.some((f) => f === FLAG.BLANK)).length;
    warnings.push(`${blanks} blank half-hour reading(s) across ${affected} day(s), for example a part-recorded `
      + 'last day. Treated as missing, not zero: left out of totals, averages, base load and the load duration curve.');
  }
  const n = days.length;
  if (n < 300) {
    warnings.push(`Only ${n} days of data found (expected ~365). Results are based on a partial year.`);
  }
  let gaps = 0;
  for (let i = 1; i < n; i++) if (dayNum(days[i].date) - dayNum(days[i - 1].date) > 1) gaps++;
  if (gaps) warnings.push(`${gaps} gap(s) in the date sequence. Missing days show as gaps, not zero.`);
}

export interface ParseOptions {
  /** Override how a timestamped file's times are read. */
  convention?: TimeConvention;
}

function readCells(bytes: ArrayBuffer, filename: string): Cell[][] {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    try {
      return readCsv(new TextDecoder('utf-8').decode(bytes));
    } catch (e) {
      throw new Error(`Could not parse CSV: ${(e as Error).message}`, { cause: e });
    }
  }
  return readWorkbook(bytes);
}

export function parseHHFile(bytes: ArrayBuffer, filename: string, opts: ParseOptions = {}): Parsed {
  const warnings: string[] = [];
  const raw = readCells(bytes, filename);
  if (!raw.length || raw.every((r) => r.every((c) => c === null))) {
    throw new Error('The file appears to be empty.');
  }

  const notes = new Set<string>();
  const wideRows = raw.some((r) => r.filter(isNumeric).length >= 40);
  let wideCols = 0;
  if (!wideRows) {
    const cols = raw[0]?.length ?? 0;
    for (let c = 0; c < cols; c++) if (raw.filter((r) => isNumeric(r[c])).length >= 40) wideCols++;
  }
  const shape = wideRows || wideCols >= 40 ? null : longShape(raw);

  // --- Timestamped file -------------------------------------------------------
  if (shape) {
    const titles = raw.slice(0, shape.start);
    const header = titles[titles.length - 1] ?? null;
    const long = readLong(raw, shape);
    if (!long.t.length) throw new Error('No readings found in the file.');
    const detected = detectLongConvention(long);
    const convention = opts.convention ?? detected.convention;
    const grid = gridLong(long, convention);
    const days = grid.rows.filter((d) => d.flags.some((f) => f !== FLAG.BLANK));
    const emptyDays = grid.rows.length - days.length;
    checkRepeats(grid.conflicts.length, days.length);
    const unitInfo = findUnit(titles.flat().filter((c): c is string => typeof c === 'string'));
    const meterId = findMeterId(titles, [], header);
    for (const n of grid.notes) warnings.push(n);
    if (emptyDays) warnings.push(`Skipped ${emptyDays} day(s) with no readings in them; treated as missing days.`);
    const kept = new Set(days.map((d) => d.date));
    const conflicts = grid.conflicts.filter((c) => kept.has(c.date));
    if (conflicts.length) {
      warnings.push(`${conflicts.length} day(s) have two different readings for the same time. They are left out `
        + 'until you choose which to use on the Data review tab.');
    }
    commonNotes(days, warnings);
    const frame = toFrame(days);
    return {
      raw: { frame, unit: unitInfo.unit, conflicts },
      frame, format: 'A', warnings, long,
      info: {
        layout: 'timestamped', meterId, unit: unitInfo.unit, unitEvidence: unitInfo.evidence,
        convention,
        conventionEvidence: opts.convention
          ? `Set on the Data review tab: times mark the ${convention} of each half hour.`
          : detected.evidence,
        clockNote: grid.notes.join(' ') || 'Times read as UK clock time.',
      },
    };
  }

  // --- One row per day ----------------------------------------------------------
  const format = detectFormat(raw);
  const oriented = format === 'B' ? transpose(raw) : raw;
  const { body: afterTitles, titles } = stripTitleRows(oriented);
  const header = titles.length ? titles[titles.length - 1] : null;
  const { body, dates, lead, leadCount } = stripLeadingColumns(afterTitles);
  const readingHeader = header ? header.slice(leadCount) : null;

  const width = body[0]?.length ?? 0;
  if (width < SLOTS) {
    throw new Error(`Expected 48 half-hour columns but found ${width}. Please check the file format.`);
  }

  const unitInfo = findUnit(titles.flat().filter((c): c is string => typeof c === 'string'));
  const meterId = findMeterId(titles, lead, header);
  const conv = columnConvention(readingHeader);

  // Put the data on its own calendar.
  let parsed: (string | null)[] | null = null;
  if (dates.length === body.length) {
    const p = dates.map(parseDate);
    if (p.filter(Boolean).length >= 30) parsed = p;
  }

  let days: DayRow[];
  const conflicts: { date: string; second: number[] }[] = [];
  if (parsed) {
    const dropped = parsed.filter((d) => d === null).length;
    if (dropped) {
      warnings.push(
        `Ignored ${dropped} row(s) with no date. These look like template `
        + 'padding or data pasted below the dated block.',
      );
    }
    const byDate = new Map<string, DayRow>();
    let identical = 0;
    let conflicting = 0;
    let empty = 0;
    body.forEach((cells, i) => {
      const d = parsed![i];
      if (!d) return;
      // A dated row with no readings at all is a missing day, not a day of zero use.
      if (cells.slice(0, SLOTS).every(isBlank)) { empty++; return; }
      const row = mapDay(cells, d, notes);
      const first = byDate.get(d);
      if (!first) { byDate.set(d, row); return; }
      const same = first.values.every((v, s) => v === row.values[s]);
      if (same) { identical++; return; }
      conflicting++;
      if (!conflicts.some((c) => c.date === d)) conflicts.push({ date: d, second: row.values });
      for (let s = 0; s < SLOTS; s++) if (!first.flags[s]) first.flags[s] = FLAG.DUPLICATE;
    });
    checkRepeats(conflicting, byDate.size);
    if (identical) warnings.push(`${identical} row(s) repeat a day already in the file with the same readings. Counted once.`);
    if (conflicting) {
      warnings.push(`${conflicts.length} date(s) appear twice with different readings. Both versions are kept on the `
        + 'Data review tab and the day is left out until you choose which to use.');
    }
    if (empty) warnings.push(`Skipped ${empty} dated row(s) with no readings in them; treated as missing days.`);
    days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  } else {
    // No dates: trim trailing empty rows and assume a 1 January start.
    let last = -1;
    body.forEach((cells, i) => { if (cells.slice(0, SLOTS).some((c) => !isBlank(c))) last = i; });
    days = body.slice(0, last + 1).map((cells, i) => ({ ...mapDay(cells, null, notes), date: addDays('2024-01-01', i) }));
    warnings.push(
      'No usable date column found: assumed the data starts on 1 January 2024. Weekdays, bank holidays and '
      + 'clock changes are therefore guesses. Add dates to the file if you can.',
    );
  }
  if (!days.length) throw new Error('No readings found in the file.');
  for (const n of notes) warnings.push(n);
  commonNotes(days, warnings);

  const frame = toFrame(days);
  return {
    raw: { frame, unit: unitInfo.unit, conflicts },
    frame, format, warnings,
    info: {
      layout: format === 'A' ? 'day-rows' : 'day-columns',
      meterId, unit: unitInfo.unit, unitEvidence: unitInfo.evidence,
      convention: conv.convention, conventionEvidence: conv.evidence,
      clockNote: clockSummary(days, notes),
    },
  };
}

/** One line on how clock-change days were treated, for the review screen. */
function clockSummary(days: DayRow[], notes: Set<string>): string {
  const unsafe = days.filter((d) => d.flags.some((f) => f === FLAG.DST_UNSAFE)).map((d) => d.date);
  const mapped = [...notes].filter((n) => /clock-change days (hold|are already)/i.test(n));
  const parts = [...mapped];
  if (unsafe.length) {
    parts.push(`${unsafe.length} clock-change day${unsafe.length > 1 ? 's' : ''} (${unsafe.join(', ')}) had 48 readings, so the missing or `
      + 'repeated hour cannot be placed. Held back until reviewed below.');
  }
  return parts.join(' ') || 'No clock-change days needed mapping.';
}

/** Re-read a timestamped file's readings with a different start/end convention. */
export function regridLong(long: LongSeries, convention: TimeConvention): RawData['frame'] & { conflicts: RawData['conflicts'] } {
  const grid = gridLong(long, convention);
  const days = grid.rows.filter((d) => d.flags.some((f) => f !== FLAG.BLANK));
  const frame = toFrame(days);
  const kept = new Set(frame.dates);
  return { ...frame, conflicts: grid.conflicts.filter((c) => kept.has(c.date)) };
}
