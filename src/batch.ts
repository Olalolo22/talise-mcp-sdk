import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TaliseMcpClient } from "./client.js";
import { escapeCsvCell, type CsvSendRow } from "./csv.js";
import { TaliseValidationError } from "./errors.js";

export type BatchRowStatus =
  | "pending"
  | "in_flight"
  | "sent"
  | "approval_required"
  | "failed";

export type BatchSendRowState = {
  index: number;
  line: number;
  name: string;
  to: string;
  resolvedName?: string;
  resolvedAddress?: string;
  amountUsd: number;
  note?: string;
  status: BatchRowStatus;
  digest?: string;
  suiscanUrl?: string;
  approvalUrl?: string;
  error?: string;
  updatedAt?: string;
};

export type BatchSendRunFile = {
  version: 1;
  runId: string;
  kind: "send_usdsui";
  createdAt: string;
  updatedAt: string;
  sourceFile: string;
  totalUsd: number;
  rows: BatchSendRowState[];
};

export type SendBatchPlan = {
  rowCount: number;
  totalUsd: number;
  balanceUsd: number;
  balanceCovers: boolean;
  allowanceActive: boolean;
  spendableNowUsd: number | null;
  allowanceCovers: boolean;
  issuePassUrl: string | null;
  unresolvedRows: { line: number; to: string; reason: string }[];
  selfRows: { line: number; to: string }[];
  rows: BatchSendRowState[];
};

/**
 * Atomic 0600 write (write to sibling temp file, chmod 0600, rename) so a crash
 * mid-write never corrupts a payout run journal.
 */
export function saveRunFile(path: string, run: BatchSendRunFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(run, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function loadRunFile(path: string): BatchSendRunFile {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as BatchSendRunFile;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.rows)) {
    throw new TaliseValidationError(`Invalid run journal format in ${path}`);
  }
  return parsed;
}

/**
 * Resolve every recipient via `find_recipient` and pre-check balance + Agent
 * Pass spending allowance without moving any money.
 */
export async function planSendBatch(
  client: TaliseMcpClient,
  csvRows: CsvSendRow[],
  opts?: { maxTotalUsd?: number; skipResolve?: boolean },
): Promise<SendBatchPlan> {
  const totalUsd = round2(csvRows.reduce((acc, r) => acc + r.amountUsd, 0));
  if (opts?.maxTotalUsd !== undefined && totalUsd > opts.maxTotalUsd) {
    throw new TaliseValidationError(
      `Batch total $${totalUsd.toFixed(2)} exceeds --max-total $${opts.maxTotalUsd.toFixed(2)}`,
    );
  }

  const [balRes, allowRes] = await Promise.all([
    client.getBalance(),
    client.getSpendingAllowance(),
  ]);

  const balanceUsd = Number(balRes.structured.balance_usd ?? 0);
  const allow = allowRes.structured;
  const allowanceActive = allow.active === true && allow.expired !== true;
  const spendableNowUsd =
    typeof allow.spendable_now_usd === "number"
      ? allow.spendable_now_usd
      : typeof allow.remaining_today_usd === "number"
        ? allow.remaining_today_usd
        : null;

  const unresolvedRows: SendBatchPlan["unresolvedRows"] = [];
  const selfRows: SendBatchPlan["selfRows"] = [];
  const rows: BatchSendRowState[] = [];

  for (let i = 0; i < csvRows.length; i++) {
    const r = csvRows[i]!;
    let resolvedName: string | undefined;
    let resolvedAddress: string | undefined;

    if (!opts?.skipResolve) {
      try {
        const res = await client.findRecipient({ to: r.to });
        if (!res.structured.found || !res.structured.address) {
          unresolvedRows.push({
            line: r.line,
            to: r.to,
            reason: res.text || "Recipient not found",
          });
        } else {
          resolvedName = res.structured.name ?? undefined;
          resolvedAddress = res.structured.address ?? undefined;
          if (res.structured.is_you) {
            selfRows.push({ line: r.line, to: r.to });
          }
        }
      } catch (err) {
        unresolvedRows.push({
          line: r.line,
          to: r.to,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    rows.push({
      index: i,
      line: r.line,
      name: r.name,
      to: r.to,
      resolvedName,
      resolvedAddress,
      amountUsd: r.amountUsd,
      note: r.note,
      status: "pending",
    });
  }

  return {
    rowCount: rows.length,
    totalUsd,
    balanceUsd,
    balanceCovers: balanceUsd + 1e-9 >= totalUsd,
    allowanceActive,
    spendableNowUsd,
    allowanceCovers:
      allowanceActive && spendableNowUsd !== null && spendableNowUsd + 1e-9 >= totalUsd,
    issuePassUrl: allow.issue_pass_url ?? null,
    unresolvedRows,
    selfRows,
    rows,
  };
}

export function createRunFile(
  sourceFile: string,
  plan: SendBatchPlan,
): BatchSendRunFile {
  const now = new Date().toISOString();
  return {
    version: 1,
    runId: randomUUID(),
    kind: "send_usdsui",
    createdAt: now,
    updatedAt: now,
    sourceFile,
    totalUsd: plan.totalUsd,
    rows: plan.rows.map((r) => ({ ...r })),
  };
}

export type ExecuteBatchOptions = {
  runPath: string;
  /** Delay between sequential sends in ms (default 250ms). */
  delayMs?: number;
  /** Retry rows previously marked `failed`. */
  retryFailed?: boolean;
  /**
   * Explicitly retry rows stuck in `in_flight`. Off by default so an interrupted
   * network call is NEVER blindly double-paid without checking activity first.
   */
  retryInFlight?: boolean;
  onRowUpdate?: (row: BatchSendRowState) => void;
};

/**
 * Execute or resume a persisted USDsui batch payout run.
 * Marks each row `in_flight` on disk BEFORE calling `send_money` so any crash
 * leaves an exact audit trail and prevents blind double-sends on resume.
 */
export async function executeSendBatch(
  client: TaliseMcpClient,
  run: BatchSendRunFile,
  opts: ExecuteBatchOptions,
): Promise<BatchSendRunFile> {
  const delayMs = opts.delayMs ?? 250;

  saveRunFile(opts.runPath, run);

  for (const row of run.rows) {
    if (row.status === "sent") continue;
    if (row.status === "failed" && !opts.retryFailed) continue;
    if (row.status === "in_flight" && !opts.retryInFlight) continue;
    if (row.status === "approval_required" && !opts.retryFailed) continue;

    row.status = "in_flight";
    row.error = undefined;
    row.updatedAt = new Date().toISOString();
    run.updatedAt = row.updatedAt;
    saveRunFile(opts.runPath, run);
    opts.onRowUpdate?.(row);

    try {
      const target = row.resolvedAddress ?? row.to;
      const res = await client.sendMoney({ to: target, amount_usd: row.amountUsd });
      const s = res.structured;
      const sent =
        s.sent === true ||
        s.paid === true ||
        (typeof s.digest === "string" && s.digest.length > 0);

      if (sent) {
        row.status = "sent";
        row.digest = s.digest;
        row.suiscanUrl =
          s.suiscan_url ??
          (s.digest ? `https://suiscan.xyz/mainnet/tx/${s.digest}` : undefined);
      } else if (s.issue_pass_url || s.move_into_reach_url) {
        row.status = "approval_required";
        row.approvalUrl = s.issue_pass_url ?? s.move_into_reach_url;
        row.error = s.reason ?? res.text;
      } else {
        row.status = "failed";
        row.error = s.reason ?? (res.text || "send_money did not confirm settlement");
      }
    } catch (err) {
      row.status = "failed";
      row.error = err instanceof Error ? err.message : String(err);
    }

    row.updatedAt = new Date().toISOString();
    run.updatedAt = row.updatedAt;
    saveRunFile(opts.runPath, run);
    opts.onRowUpdate?.(row);

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return run;
}

export function summarizeRun(run: BatchSendRunFile): {
  total: number;
  sent: number;
  pending: number;
  inFlight: number;
  approvalRequired: number;
  failed: number;
  sentUsd: number;
  remainingUsd: number;
} {
  let sent = 0;
  let pending = 0;
  let inFlight = 0;
  let approvalRequired = 0;
  let failed = 0;
  let sentUsd = 0;
  for (const r of run.rows) {
    if (r.status === "sent") {
      sent++;
      sentUsd += r.amountUsd;
    } else if (r.status === "pending") pending++;
    else if (r.status === "in_flight") inFlight++;
    else if (r.status === "approval_required") approvalRequired++;
    else failed++;
  }
  sentUsd = round2(sentUsd);
  return {
    total: run.rows.length,
    sent,
    pending,
    inFlight,
    approvalRequired,
    failed,
    sentUsd,
    remainingUsd: round2(run.totalUsd - sentUsd),
  };
}

/** Export a run journal to formula-safe CSV for accounting / spreadsheets. */
export function exportRunToCsv(run: BatchSendRunFile): string {
  const header = [
    "line",
    "name",
    "to",
    "resolved_address",
    "amount_usd",
    "status",
    "digest",
    "suiscan_url",
    "note",
    "error",
    "updated_at",
  ].join(",");

  const lines = run.rows.map((r) =>
    [
      r.line,
      r.name,
      r.to,
      r.resolvedAddress ?? "",
      r.amountUsd.toFixed(2),
      r.status,
      r.digest ?? "",
      r.suiscanUrl ?? "",
      r.note ?? "",
      r.error ?? "",
      r.updatedAt ?? "",
    ]
      .map(escapeCsvCell)
      .join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
