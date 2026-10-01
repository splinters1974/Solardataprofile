/**
 * Read an HH data file into a (days x 48) frame, in the browser.
 *
 * Port of backend/app/services/excel_parser.py. Same rules: score every
 * sheet and take the one that looks like readings, strip title rows and
 * identifier columns, find the date column, put the data on its own calendar.
 *
 * One deliberate difference: a transposed file (48 rows of half hours, one
 * column per day) is turned the right way round before the headers are
 * stripped, so its dates are kept. The server version trimmed such a file to
 * its first 48 days and assumed a 1 January start.
 */
import * as XLSX from 'xlsx';
import { addDays, dayNum, iso, isValidDate, MONTHS_SHORT } from './dates';

// The browser (ES module) build exports SSF by name; Node's CommonJS build,
// used by the tests, only has it on the default export.
const SSF: typeof XLSX.SSF = (XLSX as { SSF?: typeof XLSX.SSF }).SSF
  ?? (XLSX as unknown as { default: { SSF: typeof XLSX.SSF } }).default.SSF;

export interface Frame {
  dates: string[];       // "YYYY-MM-DD", ascending, unique
  rows: number[][];      // kWh per half hour, 48 per day
}

export interface Parsed {
  frame: Frame;
  format: 'A' | 'B';
  warnings: string[];
}

/** A cell that Excel stored as a date. */
interface DateCell { date: string }
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

// --- Dates ----------------------------------------------------------------

const DATE_LIKE = [
  /^\d{4}-\d{2}-\d{2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/,
  /^\d{2}\/\d{2}\/\d{4}( \d{1,2}:\d{2}(:\d{2})?)?$/,
  /^\d{2}-\d{2}-\d{4}( \d{1,2}:\d{2}(:\d{2})?)?$/,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}( \d{1,2}:\d{2}(:\d{2})?)?$/,
  /^\d{1,2}[ -][A-Za-z]{3,9}[ -]\d{2,4}$/,
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

  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})[ -,]*(\d{2,4})$/);
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
          row.push(p && isValidDate(p.y, p.m, p.d) ? { date: iso(p.y, p.m, p.d) } : null);
        } else row.push(v);
      } else if (cell.t === 'd') {
        const d = cell.v as Date;
        row.push({ date: iso(d.getFullYear(), d.getMonth() + 1, d.getDate()) });
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
  return wideCols;
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
function stripTitleRows(rows: Cell[][]): Cell[][] {
  let out = rows;
  for (let i = 0; i < 8 && out.length; i++) {
    const row = out[0];
    const frac = row.length ? row.filter(isNumeric).length / row.length : 0;
    if (frac < 0.1) out = out.slice(1);
    else break;
  }
  return out;
}

function transpose(rows: Cell[][]): Cell[][] {
  if (!rows.length) return [];
  return rows[0].map((_, c) => rows.map((r) => r[c]));
}

const TIME_LABEL = /^\d{1,2}:\d{2}$|^HH\s*\d{1,2}$|^Period\s*\d+$/i;
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

  const body = stripTitleRows(raw);
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

/** Strip identifier columns down to 48, keeping any date column found. */
function stripLeadingColumns(rows: Cell[][]): { body: Cell[][]; dates: Cell[] } {
  let body = rows;
  let dates: Cell[] = [];
  for (let i = 0; i < 10; i++) {
    const width = body[0]?.length ?? 0;
    if (width <= 48) break;
    const col0 = body.map((r) => r[0]);
    if (col0.filter(isDateLike).length > col0.length * 0.3) dates = col0;
    body = body.map((r) => r.slice(1));
  }
  if ((body[0]?.length ?? 0) > 48) body = body.map((r) => r.slice(0, 48));
  return { body, dates };
}

export function parseHHFile(bytes: ArrayBuffer, filename: string): Parsed {
  const warnings: string[] = [];
  const lower = filename.toLowerCase();

  let raw: Cell[][];
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    try {
      raw = readCsv(new TextDecoder('utf-8').decode(bytes));
    } catch (e) {
      throw new Error(`Could not parse CSV: ${(e as Error).message}`, { cause: e });
    }
  } else {
    raw = readWorkbook(bytes);
  }
  if (!raw.length || raw.every((r) => r.every((c) => c === null))) {
    throw new Error('The file appears to be empty.');
  }

  const format = detectFormat(raw);
  const oriented = format === 'B' ? transpose(raw) : raw;
  const { body, dates } = stripLeadingColumns(stripTitleRows(oriented));

  let bad = 0;
  let rows = body.map((r) => r.map((c) => {
    const n = toNumber(c);
    if (Number.isNaN(n)) { bad++; return 0; }
    return n;
  }));
  if (bad > 0) warnings.push(`${bad} non-numeric cells replaced with 0.`);

  const width = rows[0]?.length ?? 0;
  if (width < 48) {
    throw new Error(
      `Expected 48 half-hour columns but found ${width}. Please check the file format.`,
    );
  }

  // Put the data on its own calendar. Solar generation is seasonal, so if
  // consumption sits on the wrong dates, summer load meets winter sun.
  let parsed: (string | null)[] | null = null;
  if (dates.length === rows.length) {
    const p = dates.map(parseDate);
    if (p.filter(Boolean).length >= 30) parsed = p;
  }

  let frame: Frame;
  if (parsed) {
    const keep = parsed.map((d) => d !== null);
    const dropped = keep.filter((k) => !k).length;
    if (dropped) {
      warnings.push(
        `Ignored ${dropped} row(s) with no date — these look like template `
        + 'padding or data pasted below the dated block.',
      );
    }
    const seen = new Set<string>();
    const pairs: [string, number[]][] = [];
    rows.forEach((r, i) => {
      const d = parsed![i];
      if (d && !seen.has(d)) { seen.add(d); pairs.push([d, r]); }
    });
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    frame = { dates: pairs.map((p) => p[0]), rows: pairs.map((p) => p[1]) };
  } else {
    // Trim trailing blank rows and assume a 1 January start.
    let last = -1;
    rows.forEach((r, i) => { if (r.reduce((s, v) => s + v, 0) > 0) last = i; });
    if (last >= 0) rows = rows.slice(0, last + 1);
    frame = {
      dates: rows.map((_, i) => addDays('2024-01-01', i)),
      rows,
    };
    warnings.push(
      'No usable date column found — assumed the data starts on 1 January. '
      + 'Seasonal solar matching may be shifted if that is wrong.',
    );
  }

  const n = frame.dates.length;
  if (n === 0) throw new Error('No readings found in the file.');
  if (n < 300) {
    warnings.push(
      `Only ${n} days of data found (expected ~365). Results are based on a partial year.`,
    );
  }

  let gaps = 0;
  for (let i = 1; i < n; i++) {
    if (dayNum(frame.dates[i]) - dayNum(frame.dates[i - 1]) > 1) gaps++;
  }
  if (gaps) {
    warnings.push(`${gaps} gap(s) in the date sequence — some days are missing from the file.`);
  }

  return { frame, format, warnings };
}
