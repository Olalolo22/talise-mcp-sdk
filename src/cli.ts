#!/usr/bin/env node
/**
 * talise-mcp — Clean-room headless CLI & CSV batch runner for Talise MCP + Agent Pass.
 *
 * Unofficial community tool built by Olu (Olalolo22), not affiliated with or
 * endorsed by Talise Technologies Limited.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  createRunFile,
  executeSendBatch,
  exportRunToCsv,
  loadRunFile,
  planSendBatch,
  summarizeRun,
} from "./batch.js";
import { TaliseMcpClient } from "./client.js";
import { parseSendCsv } from "./csv.js";
import { TaliseValidationError } from "./errors.js";
import { TALISE_MCP_URL } from "./types.js";

type Flags = {
  json: boolean;
  yes: boolean;
  help: boolean;
  token?: string;
  endpoint?: string;
  limit?: number;
  dailyLimit?: number;
  days?: number;
  bankAccountId?: string;
  bankCode?: string;
  accountNumber?: string;
  maxTotal?: number;
  delayMs?: number;
  out?: string;
  retryFailed: boolean;
  retryInFlight: boolean;
  skipResolve: boolean;
  _: string[];
};

function pkgVersion(): string {
  try {
    const pkgPath = resolve(fileURLToPath(new URL("../package.json", import.meta.url)));
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return parsed.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function parseArgs(argv: string[]): Flags {
  const f: Flags = {
    json: false,
    yes: false,
    help: false,
    retryFailed: false,
    retryInFlight: false,
    skipResolve: false,
    _: [],
  };
  const takeStr = (flag: string, i: number): [string, number] => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      throw new TaliseValidationError(`${flag} requires a value`);
    }
    return [v, i + 1];
  };
  const takeNum = (flag: string, i: number): [number, number] => {
    const [raw, next] = takeStr(flag, i);
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new TaliseValidationError(`${flag} requires a finite number (got "${raw}")`);
    }
    return [n, next];
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      f._.push(...argv.slice(i + 1));
      break;
    }
    switch (a) {
      case "--json":
        f.json = true;
        break;
      case "--yes":
      case "-y":
        f.yes = true;
        break;
      case "--help":
      case "-h":
        f.help = true;
        break;
      case "--retry-failed":
        f.retryFailed = true;
        break;
      case "--retry-in-flight":
        f.retryInFlight = true;
        break;
      case "--skip-resolve":
        f.skipResolve = true;
        break;
      case "--token":
        [f.token, i] = takeStr(a, i);
        break;
      case "--endpoint":
        [f.endpoint, i] = takeStr(a, i);
        break;
      case "--limit":
        [f.limit, i] = takeNum(a, i);
        break;
      case "--daily-limit":
        [f.dailyLimit, i] = takeNum(a, i);
        break;
      case "--days":
        [f.days, i] = takeNum(a, i);
        break;
      case "--bank-account-id":
        [f.bankAccountId, i] = takeStr(a, i);
        break;
      case "--bank-code":
        [f.bankCode, i] = takeStr(a, i);
        break;
      case "--account-number":
        [f.accountNumber, i] = takeStr(a, i);
        break;
      case "--max-total":
        [f.maxTotal, i] = takeNum(a, i);
        break;
      case "--delay-ms":
        [f.delayMs, i] = takeNum(a, i);
        break;
      case "--out":
        [f.out, i] = takeStr(a, i);
        break;
      default:
        if (a.startsWith("-")) {
          throw new TaliseValidationError(`Unknown flag: ${a} (run \`talise-mcp help\`)`);
        }
        f._.push(a);
    }
  }
  return f;
}

function makeClient(flags: Flags): TaliseMcpClient {
  const token = flags.token ?? process.env.TALISE_PAT ?? process.env.TALISE_MCP_TOKEN ?? "";
  if (!token.trim()) {
    throw new TaliseValidationError(
      "Missing Talise PAT: set TALISE_PAT=tls_pat_... (or pass --token)",
    );
  }
  return new TaliseMcpClient({
    token,
    endpoint: flags.endpoint ?? process.env.TALISE_MCP_URL ?? TALISE_MCP_URL,
    allowInsecureLocalhost: process.env.TALISE_ALLOW_INSECURE === "1",
  });
}

async function confirmAction(flags: Flags, prompt: string): Promise<boolean> {
  if (flags.yes) return true;
  if (!process.stdin.isTTY) {
    throw new TaliseValidationError(
      "Refusing to move money non-interactively without --yes (no TTY to confirm)",
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolvePrompt) =>
      rl.question(`${prompt} [y/N] `, resolvePrompt),
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function emit(flags: Flags, data: unknown, human: () => void): void {
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else {
    human();
  }
}

function topHelp(): string {
  return [
    "talise-mcp — Clean-room CLI & CSV batch runner for Talise MCP + Agent Pass",
    "",
    "Usage:",
    "  talise-mcp <command> [args] [flags]",
    "",
    "Read & Discovery:",
    "  tools                                  List live tools advertised by app.talise.io/mcp",
    "  overview                               Account overview (balance, pass, saved banks, country)",
    "  balance                                USDsui balance",
    "  allowance                              Active Agent Pass daily limit & spendable-now amount",
    "  request-pass [--daily-limit N] [--days 7|30|90]",
    "                                         Generate a one-tap Agent Pass link",
    "  resolve <handle|.sui|0x...>            Verify who a recipient pays (find_recipient)",
    "  recent [--limit N]                     Recently paid recipients",
    "  activity [--limit N]                   Recent wallet & Agent Pass transactions",
    "",
    "Nigeria Bank & Naira Rails:",
    "  banks [query]                          List saved banks (no arg) or search Nigerian banks",
    "  check-bank <bank_code> <account_10>    Resolve Nigerian bank account holder name",
    "  quote <amount_ngn>                     Live NGN cash-out quote & Agent Pass check",
    "  cashout <amount_ngn> (--bank-account-id ID | --bank-code CODE --account-number NUM)",
    "                                         Cash out NGN via Agent Pass (or get approval link)",
    "  cashout-status <approval_id>           Check cash-out execution status",
    "  add-naira <amount_ngn>                 Create one-time NGN deposit account (1,000-50,000)",
    "  add-naira-status <order_id>            Check NGN deposit status",
    "",
    "Payments & Crash-Safe CSV Batch:",
    "  send <to> <amount_usd>                 Send USDsui instantly within Agent Pass",
    "  batch plan <file.csv> [--max-total N]  Dry-run CSV: resolve recipients + check balance/pass",
    "  batch run <file.csv> [--max-total N] [--out run.json] [--yes]",
    "                                         Execute CSV batch with 0600 crash-safe journal",
    "  batch resume <run.json> [--retry-failed] [--retry-in-flight] [--yes]",
    "                                         Resume interrupted run safely",
    "  batch status <run.json>                Inspect run journal summary",
    "  batch export <run.json> [--out out.csv] Export formula-safe CSV payout receipt",
    "",
    "Global Flags:",
    "  --json                 Machine-readable JSON on stdout",
    "  --yes, -y              Skip confirmation (required for non-interactive money moves)",
    "  --token <tls_pat_...>  Personal Access Token (default: TALISE_PAT env var)",
    "  --endpoint <url>       Override MCP URL (must be https://*.talise.io)",
    "  --version, -v          Print version",
    "  --help, -h             Show help",
  ].join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (
    argv.length === 0 ||
    argv[0] === "help" ||
    argv[0] === "--help" ||
    argv[0] === "-h"
  ) {
    process.stdout.write(topHelp() + "\n");
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
    process.stdout.write(`talise-mcp ${pkgVersion()}\n`);
    return;
  }

  const cmd = argv[0]!;
  const flags = parseArgs(argv.slice(1));
  if (flags.help) {
    process.stdout.write(topHelp() + "\n");
    return;
  }

  // Offline run-file commands need no PAT.
  if (cmd === "batch" && flags._[0] === "status") {
    const runPath = flags._[1];
    if (!runPath) throw new TaliseValidationError("Usage: talise-mcp batch status <run.json>");
    const run = loadRunFile(runPath);
    const summary = summarizeRun(run);
    emit(flags, { runId: run.runId, sourceFile: run.sourceFile, summary, rows: run.rows }, () => {
      process.stdout.write(
        `Run ${run.runId} (${run.sourceFile})\n` +
          `  sent: ${summary.sent}/${summary.total} ($${summary.sentUsd.toFixed(2)} / $${run.totalUsd.toFixed(2)})\n` +
          `  pending: ${summary.pending}  in_flight: ${summary.inFlight}  approval_required: ${summary.approvalRequired}  failed: ${summary.failed}\n`,
      );
    });
    return;
  }

  if (cmd === "batch" && flags._[0] === "export") {
    const runPath = flags._[1];
    if (!runPath) {
      throw new TaliseValidationError("Usage: talise-mcp batch export <run.json> [--out out.csv]");
    }
    const run = loadRunFile(runPath);
    const csv = exportRunToCsv(run);
    if (flags.out) {
      writeFileSync(flags.out, csv, { mode: 0o600 });
      emit(flags, { ok: true, out: flags.out, rows: run.rows.length }, () => {
        process.stdout.write(`Exported ${run.rows.length} rows to ${flags.out}\n`);
      });
    } else {
      process.stdout.write(csv);
    }
    return;
  }

  const client = makeClient(flags);

  switch (cmd) {
    case "tools": {
      const tools = await client.listTools();
      emit(flags, { count: tools.length, tools }, () => {
        for (const t of tools) {
          process.stdout.write(`${t.name.padEnd(26)} ${t.title ?? ""}\n`);
        }
      });
      return;
    }
    case "overview": {
      const r = await client.getAccountOverview();
      emit(flags, r.structured, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "balance": {
      const r = await client.getBalance();
      emit(flags, r.structured, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "allowance": {
      const r = await client.getSpendingAllowance();
      emit(flags, r.structured, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "request-pass": {
      const days =
        flags.days === 7 || flags.days === 30 || flags.days === 90
          ? flags.days
          : flags.days === undefined
            ? undefined
            : (() => {
                throw new TaliseValidationError("--days must be 7, 30, or 90");
              })();
      const r = await client.requestAgentPass({
        ...(flags.dailyLimit !== undefined ? { daily_limit_usd: flags.dailyLimit } : {}),
        ...(days !== undefined ? { expires_in_days: days } : {}),
      });
      emit(flags, { text: r.text, ...r.structured }, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "resolve": {
      const to = flags._[0];
      if (!to) throw new TaliseValidationError("Usage: talise-mcp resolve <handle|.sui|0x...>");
      const r = await client.findRecipient({ to });
      emit(flags, r.structured, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "recent": {
      const r = await client.listRecentRecipients(
        flags.limit !== undefined ? { limit: flags.limit } : {},
      );
      emit(flags, r.structured, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "activity": {
      const r = await client.recentActivity(
        flags.limit !== undefined ? { limit: flags.limit } : {},
      );
      emit(flags, r.structured, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "banks": {
      const query = flags._[0];
      if (!query) {
        const r = await client.listBankAccounts();
        emit(flags, r.structured, () => process.stdout.write(r.text + "\n"));
      } else {
        const r = await client.findBank({ query });
        emit(flags, r.structured, () => process.stdout.write(r.text + "\n"));
      }
      return;
    }
    case "check-bank": {
      const [bankCode, accountNumber] = flags._;
      if (!bankCode || !accountNumber) {
        throw new TaliseValidationError("Usage: talise-mcp check-bank <bank_code> <10_digit_acct>");
      }
      const r = await client.checkBankAccount({
        bank_code: bankCode,
        account_number: accountNumber,
      });
      emit(flags, r.structured, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "quote": {
      const raw = flags._[0];
      const amountNgn = Number(raw);
      if (!raw || !Number.isFinite(amountNgn) || amountNgn <= 0) {
        throw new TaliseValidationError("Usage: talise-mcp quote <amount_ngn>");
      }
      const r = await client.quoteCashOut({ amount_ngn: amountNgn });
      emit(flags, r.structured, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "send": {
      const [to, rawAmt] = flags._;
      const amountUsd = Number(rawAmt);
      if (!to || !rawAmt || !Number.isFinite(amountUsd) || amountUsd <= 0) {
        throw new TaliseValidationError("Usage: talise-mcp send <to> <amount_usd>");
      }
      const resolved = await client.findRecipient({ to });
      if (!resolved.structured.found) {
        throw new TaliseValidationError(`Recipient "${to}" not found: ${resolved.text}`);
      }
      const label = resolved.structured.name ?? to;
      const ok = await confirmAction(
        flags,
        `Send $${amountUsd.toFixed(2)} USDsui to ${label} (${resolved.structured.address})?`,
      );
      if (!ok) {
        process.stderr.write("Cancelled.\n");
        return;
      }
      const r = await client.sendMoney({ to, amount_usd: amountUsd });
      emit(flags, { text: r.text, ...r.structured }, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "cashout": {
      const raw = flags._[0];
      const amountNgn = Number(raw);
      if (!raw || !Number.isFinite(amountNgn) || amountNgn <= 0) {
        throw new TaliseValidationError(
          "Usage: talise-mcp cashout <amount_ngn> (--bank-account-id ID | --bank-code CODE --account-number NUM)",
        );
      }
      const quote = await client.quoteCashOut({ amount_ngn: amountNgn });
      const targetDesc = flags.bankAccountId
        ? `saved account ${flags.bankAccountId}`
        : `${flags.bankCode}:${flags.accountNumber}`;
      const ok = await confirmAction(
        flags,
        `Cash out ₦${amountNgn.toLocaleString()} (~$${quote.structured.total_usd.toFixed(2)} USDsui incl. fee) to ${targetDesc}?`,
      );
      if (!ok) {
        process.stderr.write("Cancelled.\n");
        return;
      }
      const r = flags.bankAccountId
        ? await client.prepareCashOut({
            bank_account_id: flags.bankAccountId,
            amount_ngn: amountNgn,
          })
        : await client.prepareCashOut({
            bank_code: flags.bankCode ?? "",
            account_number: flags.accountNumber ?? "",
            amount_ngn: amountNgn,
          });
      emit(flags, { text: r.text, ...r.structured }, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "cashout-status": {
      const id = flags._[0];
      if (!id) throw new TaliseValidationError("Usage: talise-mcp cashout-status <approval_id>");
      const r = await client.getCashOutStatus({ approval_id: id });
      emit(flags, r.structured, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "add-naira": {
      const raw = flags._[0];
      const amountNgn = Number(raw);
      if (!raw || !Number.isFinite(amountNgn)) {
        throw new TaliseValidationError("Usage: talise-mcp add-naira <amount_ngn>");
      }
      const r = await client.addMoneyNaira({ amount_ngn: amountNgn });
      emit(flags, { text: r.text, ...r.structured }, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "add-naira-status": {
      const id = flags._[0];
      if (!id) throw new TaliseValidationError("Usage: talise-mcp add-naira-status <order_id>");
      const r = await client.getAddMoneyStatus({ order_id: id });
      emit(flags, r.structured, () => process.stdout.write(r.text + "\n"));
      return;
    }
    case "batch": {
      const sub = flags._[0];
      if (sub === "plan") {
        const csvPath = flags._[1];
        if (!csvPath) throw new TaliseValidationError("Usage: talise-mcp batch plan <file.csv>");
        const csvRows = parseSendCsv(readFileSync(csvPath, "utf8"));
        const plan = await planSendBatch(client, csvRows, {
          maxTotalUsd: flags.maxTotal,
          skipResolve: flags.skipResolve,
        });
        emit(flags, plan, () => {
          process.stdout.write(
            `Batch plan: ${plan.rowCount} rows, total $${plan.totalUsd.toFixed(2)} USDsui\n` +
              `  Balance:    $${plan.balanceUsd.toFixed(2)} (${plan.balanceCovers ? "OK" : "INSUFFICIENT"})\n` +
              `  Agent Pass: ${plan.allowanceActive ? `active (spendable now $${(plan.spendableNowUsd ?? 0).toFixed(2)})` : "inactive"}${plan.allowanceCovers ? " [OK]" : " [INSUFFICIENT]"}\n` +
              `  Unresolved: ${plan.unresolvedRows.length}  Self-sends: ${plan.selfRows.length}\n`,
          );
          if (plan.issuePassUrl && !plan.allowanceCovers) {
            process.stdout.write(`  Issue/raise Agent Pass: ${plan.issuePassUrl}\n`);
          }
        });
        return;
      }
      if (sub === "run") {
        const csvPath = flags._[1];
        if (!csvPath) {
          throw new TaliseValidationError("Usage: talise-mcp batch run <file.csv> [--yes]");
        }
        const csvRows = parseSendCsv(readFileSync(csvPath, "utf8"));
        const plan = await planSendBatch(client, csvRows, {
          maxTotalUsd: flags.maxTotal,
          skipResolve: flags.skipResolve,
        });
        if (plan.unresolvedRows.length > 0) {
          throw new TaliseValidationError(
            `${plan.unresolvedRows.length} recipient(s) failed to resolve (first: line ${plan.unresolvedRows[0]!.line} "${plan.unresolvedRows[0]!.to}")`,
          );
        }
        if (plan.selfRows.length > 0) {
          throw new TaliseValidationError(
            `Refusing self-send on CSV line ${plan.selfRows[0]!.line} ("${plan.selfRows[0]!.to}")`,
          );
        }
        if (!plan.balanceCovers) {
          throw new TaliseValidationError(
            `Insufficient balance ($${plan.balanceUsd.toFixed(2)} < $${plan.totalUsd.toFixed(2)})`,
          );
        }
        if (!plan.allowanceCovers) {
          throw new TaliseValidationError(
            `Agent Pass does not cover $${plan.totalUsd.toFixed(2)}` +
              (plan.issuePassUrl ? ` — issue/raise pass at ${plan.issuePassUrl}` : ""),
          );
        }
        const ok = await confirmAction(
          flags,
          `Send $${plan.totalUsd.toFixed(2)} USDsui across ${plan.rowCount} recipients via Agent Pass?`,
        );
        if (!ok) {
          process.stderr.write("Cancelled.\n");
          return;
        }
        const run = createRunFile(csvPath, plan);
        const runPath = flags.out ?? join("runs", `talise-batch-${run.runId.slice(0, 8)}.run.json`);
        const finished = await executeSendBatch(client, run, {
          runPath,
          delayMs: flags.delayMs,
          onRowUpdate: (row) => {
            if (!flags.json && row.status !== "in_flight") {
              process.stderr.write(
                `[${row.index + 1}/${run.rows.length}] ${row.to} $${row.amountUsd.toFixed(2)} -> ${row.status}${row.digest ? ` (${row.digest})` : row.error ? ` (${row.error})` : ""}\n`,
              );
            }
          },
        });
        const summary = summarizeRun(finished);
        emit(flags, { runPath, runId: finished.runId, summary, rows: finished.rows }, () => {
          process.stdout.write(
            `Done: ${summary.sent}/${summary.total} sent ($${summary.sentUsd.toFixed(2)}). Journal: ${runPath}\n`,
          );
        });
        if (summary.failed > 0 || summary.approvalRequired > 0) {
          process.exitCode = 1;
        }
        return;
      }
      if (sub === "resume") {
        const runPath = flags._[1];
        if (!runPath) {
          throw new TaliseValidationError("Usage: talise-mcp batch resume <run.json> [--yes]");
        }
        const run = loadRunFile(runPath);
        const before = summarizeRun(run);
        if (before.inFlight > 0 && !flags.retryInFlight) {
          process.stderr.write(
            `Note: ${before.inFlight} row(s) are in_flight and will be skipped unless --retry-in-flight is passed (check \`talise-mcp activity\` first to avoid double-pay).\n`,
          );
        }
        const ok = await confirmAction(
          flags,
          `Resume run ${run.runId} (remaining $${before.remainingUsd.toFixed(2)})?`,
        );
        if (!ok) {
          process.stderr.write("Cancelled.\n");
          return;
        }
        const finished = await executeSendBatch(client, run, {
          runPath,
          delayMs: flags.delayMs,
          retryFailed: flags.retryFailed,
          retryInFlight: flags.retryInFlight,
        });
        const summary = summarizeRun(finished);
        emit(flags, { runPath, runId: finished.runId, summary, rows: finished.rows }, () => {
          process.stdout.write(
            `Resumed: ${summary.sent}/${summary.total} sent ($${summary.sentUsd.toFixed(2)}). Journal: ${runPath}\n`,
          );
        });
        if (summary.failed > 0 || summary.approvalRequired > 0) {
          process.exitCode = 1;
        }
        return;
      }
      throw new TaliseValidationError("Usage: talise-mcp batch <plan|run|resume|status|export>");
    }
    default:
      throw new TaliseValidationError(`Unknown command: ${cmd} (run \`talise-mcp help\`)`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code;
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ ok: false, error: msg, code }) + "\n");
  } else {
    process.stderr.write(`Error: ${msg}\n`);
  }
  process.exit(1);
});
