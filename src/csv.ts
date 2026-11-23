import { TaliseValidationError } from "./errors.js";

export type CsvSendRow = {
  line: number;
  name: string;
  to: string;
  amountUsd: number;
  note?: string;
};

export type CsvCashOutRow = {
  line: number;
  name: string;
  bankAccountId?: string;
  bankCode?: string;
  accountNumber?: string;
  amountNgn: number;
  note?: string;
};

const MAX_BATCH_ROWS = 200;

/** Auto-detect delimiter (comma, semicolon, or tab) from the first non-empty line. */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  const first = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .find((l) => l.trim().length > 0 && !l.trim().startsWith("#"));
  if (!first) return ",";
  const counts: Record<"," | ";" | "\t", number> = {
    ",": countUnquoted(first, ","),
    ";": countUnquoted(first, ";"),
    "\t": countUnquoted(first, "\t"),
  };
  if (counts["\t"] > counts[","] && counts["\t"] >= counts[";"]) return "\t";
  if (counts[";"] > counts[","]) return ";";
  return ",";
}

function countUnquoted(line: string, delim: string): number {
  let inQuotes = false;
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delim && !inQuotes) n++;
  }
  return n;
}

/** RFC-4180-compatible single-line CSV splitter. */
export function splitCsvLine(line: string, delim: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (inQuotes) {
    throw new TaliseValidationError(`Unterminated quoted field in CSV line: ${line.slice(0, 60)}`);
  }
  fields.push(cur.trim());
  return fields;
}

/**
 * Parse a USDsui payout CSV.
 * Supported column layouts (header row optional):
 *   - 3+ columns: `name,to,amount_usd[,note]` (or `to,amount_usd,note` if header says `to`)
 *   - 2 columns:  `to,amount_usd`
 */
export function parseSendCsv(content: string): CsvSendRow[] {
  const cleaned = content.replace(/^\uFEFF/, "");
  const delim = detectDelimiter(cleaned);
  const rawLines = cleaned.split(/\r?\n/);

  const nonEmpty: { line: number; cells: string[] }[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    nonEmpty.push({ line: i + 1, cells: splitCsvLine(line, delim) });
  }
  if (nonEmpty.length === 0) {
    throw new TaliseValidationError("CSV is empty");
  }

  let startIdx = 0;
  let colMap = { name: 0, to: 1, amount: 2, note: 3 };
  const firstLower = nonEmpty[0]!.cells.map((c) => c.toLowerCase());
  const looksHeader = firstLower.some((h) =>
    ["to", "recipient", "handle", "address", "amount", "amount_usd", "usd"].includes(h),
  );

  if (looksHeader) {
    startIdx = 1;
    const toIdx = firstLower.findIndex((h) =>
      ["to", "recipient", "handle", "talise_handle", "address"].includes(h),
    );
    const amtIdx = firstLower.findIndex((h) =>
      ["amount", "amount_usd", "usd"].includes(h),
    );
    if (toIdx < 0 || amtIdx < 0) {
      throw new TaliseValidationError(
        'CSV header must include recipient ("to"/"recipient") and amount ("amount"/"amount_usd") columns',
      );
    }
    const nameIdx = firstLower.findIndex((h) => ["name", "label", "payee"].includes(h));
    const noteIdx = firstLower.findIndex((h) => ["note", "memo", "reference"].includes(h));
    colMap = { name: nameIdx, to: toIdx, amount: amtIdx, note: noteIdx };
  } else if (nonEmpty[0]!.cells.length === 2) {
    colMap = { name: -1, to: 0, amount: 1, note: -1 };
  }

  const rows: CsvSendRow[] = [];
  for (let i = startIdx; i < nonEmpty.length; i++) {
    const entry = nonEmpty[i]!;
    const to = (colMap.to >= 0 ? entry.cells[colMap.to] : "")?.trim() ?? "";
    const rawAmt = (colMap.amount >= 0 ? entry.cells[colMap.amount] : "")?.replace(/[$,\s]/g, "") ?? "";
    const name = (colMap.name >= 0 ? entry.cells[colMap.name] : "")?.trim() || to;
    const note = (colMap.note >= 0 ? entry.cells[colMap.note] : undefined)?.trim() || undefined;

    if (!to) {
      throw new TaliseValidationError(`CSV line ${entry.line}: missing recipient`);
    }
    const amountUsd = Number(rawAmt);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > 1000) {
      throw new TaliseValidationError(
        `CSV line ${entry.line}: invalid amount_usd "${rawAmt}" (must be in (0, 1000])`,
      );
    }
    const rounded = Math.round(amountUsd * 100) / 100;
    if (Math.abs(rounded - amountUsd) > 1e-9) {
      throw new TaliseValidationError(
        `CSV line ${entry.line}: amount_usd "${rawAmt}" has more than 2 decimal places`,
      );
    }
    rows.push({ line: entry.line, name, to, amountUsd: rounded, note });
  }

  if (rows.length === 0) {
    throw new TaliseValidationError("CSV contains no data rows");
  }
  if (rows.length > MAX_BATCH_ROWS) {
    throw new TaliseValidationError(`CSV exceeds maximum of ${MAX_BATCH_ROWS} rows`);
  }
  return rows;
}

/**
 * Parse a Nigerian bank cash-out CSV.
 * Required header columns:
 *   - `amount_ngn` (or `ngn`)
 *   - either `bank_account_id` OR (`bank_code` + `account_number`)
 *   - optional `name`, `note`
 */
export function parseCashOutCsv(content: string): CsvCashOutRow[] {
  const cleaned = content.replace(/^\uFEFF/, "");
  const delim = detectDelimiter(cleaned);
  const rawLines = cleaned.split(/\r?\n/);

  const nonEmpty: { line: number; cells: string[] }[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    nonEmpty.push({ line: i + 1, cells: splitCsvLine(line, delim) });
  }
  if (nonEmpty.length < 2) {
    throw new TaliseValidationError("Cash-out CSV must include a header row and at least one data row");
  }

  const hdr = nonEmpty[0]!.cells.map((c) => c.toLowerCase());
  const amtIdx = hdr.findIndex((h) => ["amount_ngn", "ngn", "amount"].includes(h));
  const idIdx = hdr.findIndex((h) => h === "bank_account_id");
  const codeIdx = hdr.findIndex((h) => h === "bank_code");
  const acctIdx = hdr.findIndex((h) => h === "account_number");
  const nameIdx = hdr.findIndex((h) => ["name", "label", "recipient"].includes(h));
  const noteIdx = hdr.findIndex((h) => ["note", "memo", "reference"].includes(h));

  if (amtIdx < 0 || (idIdx < 0 && (codeIdx < 0 || acctIdx < 0))) {
    throw new TaliseValidationError(
      "Cash-out CSV header must include amount_ngn and either bank_account_id or (bank_code + account_number)",
    );
  }

  const rows: CsvCashOutRow[] = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const entry = nonEmpty[i]!;
    const rawAmt = (entry.cells[amtIdx] ?? "").replace(/[₦,\s]/g, "");
    const amountNgn = Number(rawAmt);
    if (!Number.isFinite(amountNgn) || amountNgn < 1000 || amountNgn > 10_000_000) {
      throw new TaliseValidationError(
        `CSV line ${entry.line}: invalid amount_ngn "${rawAmt}" (must be 1,000..10,000,000)`,
      );
    }
    const bankAccountId = idIdx >= 0 ? entry.cells[idIdx]?.trim() || undefined : undefined;
    const bankCode = codeIdx >= 0 ? entry.cells[codeIdx]?.trim() || undefined : undefined;
    const accountNumber = acctIdx >= 0 ? entry.cells[acctIdx]?.trim() || undefined : undefined;
    if (!bankAccountId && (!bankCode || !accountNumber)) {
      throw new TaliseValidationError(
        `CSV line ${entry.line}: provide bank_account_id or both bank_code and account_number`,
      );
    }
    if (accountNumber && !/^\d{10}$/.test(accountNumber)) {
      throw new TaliseValidationError(
        `CSV line ${entry.line}: account_number must be exactly 10 digits`,
      );
    }
    const name =
      (nameIdx >= 0 ? entry.cells[nameIdx]?.trim() : undefined) ||
      bankAccountId ||
      `${bankCode}:${accountNumber}`;
    const note = noteIdx >= 0 ? entry.cells[noteIdx]?.trim() || undefined : undefined;
    rows.push({
      line: entry.line,
      name,
      bankAccountId,
      bankCode,
      accountNumber,
      amountNgn,
      note,
    });
  }

  if (rows.length > MAX_BATCH_ROWS) {
    throw new TaliseValidationError(`CSV exceeds maximum of ${MAX_BATCH_ROWS} rows`);
  }
  return rows;
}

/**
 * Neutralize CSV formula injection (`=`, `+`, `-`, `@`, tab, CR) so exported
 * payout logs cannot trigger Excel/Sheets formula execution.
 */
export function escapeCsvCell(raw: string | number | null | undefined): string {
  const s = raw === null || raw === undefined ? "" : String(raw);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
