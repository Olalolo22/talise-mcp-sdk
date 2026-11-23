import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRunFile,
  executeSendBatch,
  exportRunToCsv,
  loadRunFile,
  planSendBatch,
  saveRunFile,
  summarizeRun,
} from "../src/batch.js";
import { TaliseMcpClient } from "../src/client.js";
import { parseSendCsv } from "../src/csv.js";

function makeMockClient(opts?: {
  balanceUsd?: number;
  spendableNowUsd?: number;
  failOnRecipient?: string;
}) {
  const sentCalls: { to: string; amount_usd: number }[] = [];
  const client = new TaliseMcpClient({
    token: "tls_pat_mock",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const { name, arguments: args } = body.params ?? {};
      let structured: Record<string, unknown> = {};
      let text = "ok";

      if (name === "get_balance") {
        structured = { balance_usd: opts?.balanceUsd ?? 100, currency: "USD" };
      } else if (name === "get_spending_allowance") {
        structured = {
          available: true,
          active: true,
          expired: false,
          daily_limit_usd: 100,
          spendable_now_usd: opts?.spendableNowUsd ?? 100,
        };
      } else if (name === "find_recipient") {
        structured = {
          found: args.to !== "ghost@talise",
          name: args.to,
          address: args.to === "ghost@talise" ? null : `0x${"a".repeat(64)}`,
          is_you: args.to === "self@talise",
          paid_before: false,
        };
      } else if (name === "send_money") {
        sentCalls.push({ to: args.to, amount_usd: args.amount_usd });
        if (opts?.failOnRecipient && args.to === opts.failOnRecipient) {
          structured = { sent: false, reason: "Temporary RPC failure" };
          text = "Temporary RPC failure";
        } else {
          structured = {
            sent: true,
            digest: `DIGEST_${sentCalls.length}`,
            to: args.to,
            amount_usd: args.amount_usd,
          };
        }
      }

      return new Response(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text }], structuredContent: structured },
        })}\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  return { client, sentCalls };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("crash-safe batch runner", () => {
  it("plans, checks balance + allowance, executes with 0600 journal, and skips in_flight on resume", async () => {
    const dir = mkdtempSync(join(tmpdir(), "talise-mcp-batch-"));
    dirs.push(dir);
    const runPath = join(dir, "batch.run.json");

    const rows = parseSendCsv("name,to,amount_usd,note\n=Ada,ada@talise,10,Pay\nBob,bob@talise,15,Pay\n");
    const { client, sentCalls } = makeMockClient({ balanceUsd: 50, spendableNowUsd: 50 });

    const plan = await planSendBatch(client, rows);
    expect(plan.balanceCovers).toBe(true);
    expect(plan.allowanceCovers).toBe(true);
    expect(plan.unresolvedRows).toHaveLength(0);

    const run = createRunFile("sample.csv", plan);
    await executeSendBatch(client, run, { runPath, delayMs: 0 });
    expect(sentCalls).toHaveLength(2);

    const mode = statSync(runPath).mode & 0o777;
    expect(mode).toBe(0o600);

    const reloaded = loadRunFile(runPath);
    expect(summarizeRun(reloaded)).toMatchObject({ sent: 2, failed: 0, sentUsd: 25 });

    // Simulate a crashed in_flight row and verify default resume does NOT double-pay it.
    reloaded.rows[1]!.status = "in_flight";
    saveRunFile(runPath, reloaded);

    const beforeCount = sentCalls.length;
    await executeSendBatch(client, loadRunFile(runPath), { runPath, delayMs: 0 });
    expect(sentCalls.length).toBe(beforeCount);

    // Explicit --retry-in-flight retries it.
    await executeSendBatch(client, loadRunFile(runPath), {
      runPath,
      delayMs: 0,
      retryInFlight: true,
    });
    expect(sentCalls.length).toBe(beforeCount + 1);

    // Export neutralizes formula-prefixed name "=Ada".
    const csv = exportRunToCsv(loadRunFile(runPath));
    expect(csv).toContain("'=Ada");
  });
});
