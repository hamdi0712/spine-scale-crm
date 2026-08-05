// A small RFC 4180 reader, used by the lead import.
//
// Hand-written rather than pulled in as a dependency: the app parses CSV in
// exactly one place, and the export formats it has to swallow (Apify actors,
// spreadsheet exports) only need quoted fields, embedded commas/newlines, and
// whichever of comma / semicolon / tab the exporter happened to use.
//
// Nothing here knows anything about leads — column meaning is decided by the
// user in the import wizard, not guessed from the header text.

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

const DELIMITERS = [",", ";", "\t"] as const;

export function parseCsv(text: string): CsvTable {
  const clean = text.replace(/^\uFEFF/, ""); // Excel writes a BOM
  const delimiter = sniffDelimiter(clean);
  // Blank records — a trailing newline, or a gap between blocks of rows — are
  // dropped so they never turn into leads with no fields.
  const records = readRecords(clean, delimiter).filter((r) =>
    r.some((cell) => cell.trim() !== ""),
  );
  if (records.length === 0) return { headers: [], rows: [] };

  const [head, ...body] = records;
  const headers = head.map((h, i) =>
    h.trim() === "" ? `Column ${i + 1}` : h.trim(),
  );
  return {
    headers,
    // Ragged exports are squared off against the header row, so a row that
    // ends early still lines up with the columns the user mapped.
    rows: body.map((row) =>
      Array.from({ length: headers.length }, (_, i) => (row[i] ?? "").trim()),
    ),
  };
}

// Counts each candidate across the first record only — the header line, which
// is the one place a stray delimiter inside data can't skew the count.
function sniffDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++;
        else quoted = false;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === "\n" || ch === "\r") break;
    if (counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const n = counts.get(d)!;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

function readRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') {
        field += ch;
      } else if (text[i + 1] === '"') {
        field += '"'; // "" is an escaped quote
        i++;
      } else {
        quoted = false;
      }
      continue;
    }
    // A quote only opens a quoted field at the start of one; anywhere else it
    // is data, which is how a stray quote mid-field survives intact.
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n") {
      endRecord();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRecord();
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) endRecord();
  return records;
}
