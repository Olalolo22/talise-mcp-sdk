# talise-mcp-sdk

Independent TypeScript SDK, headless CSV batch CLI (`talise-mcp`), and AI framework adapters built against [Talise's public MCP endpoint](https://www.talise.io/mcp) (`https://app.talise.io/mcp`) and on-chain **Agent Pass** on Sui.

> **Community tool notice:** Built and maintained independently by [Olu (`Olalolo22`)](https://github.com/Olalolo22), not affiliated with or endorsed by Talise Technologies Limited. Written from scratch against the public Streamable HTTP MCP endpoint. Always test with a small Agent Pass daily limit before running production payouts.

---

## Features

- **Zero-dependency Streamable HTTP MCP client (`TaliseMcpClient`)**
  - Handles both `text/event-stream` (SSE) and JSON-RPC responses from `https://app.talise.io/mcp`.
  - Typed methods & `structuredContent` return types for all **16 live Talise MCP tools**:
    - Account & Agent Pass: `getAccountOverview`, `getBalance`, `getSpendingAllowance`, `requestAgentPass`, `recentActivity`
    - Payments & Discovery: `findRecipient`, `listRecentRecipients`, `sendMoney`
    - Nigeria Naira / Bank Rails: `listBankAccounts`, `findBank`, `checkBankAccount`, `quoteCashOut`, `prepareCashOut`, `getCashOutStatus`, `addMoneyNaira`, `getAddMoneyStatus`
  - **Host-allowlisted endpoint guard:** refuses non-`https://*.talise.io` URLs by default so a poisoned env var can never exfiltrate `TALISE_PAT`.
- **Crash-safe CSV batch runner (`talise-mcp batch`)**
  - Auto-detects comma/semicolon/tab delimiters, resolves every recipient via `find_recipient`, rejects self-sends, and pre-checks both `balance_usd` and `spendable_now_usd` before moving a single cent.
  - Atomically writes a `0600` `.run.json` journal before/after each row (`pending` → `in_flight` → `sent` / `approval_required` / `failed`), never blindly double-paying `in_flight` rows on `resume`.
  - Formula-injection-safe CSV receipt export (`talise-mcp batch export`).
- **AI framework adapters (`talise-mcp-sdk/adapters`)**
  - Ready-made tool schemas + dispatchers for **OpenAI** (Chat Completions & Responses API hosted MCP), **Anthropic Claude** (`tool_use` / `tool_result`), and **Vercel AI SDK / JS agent loops** (`createAgentToolMap`), with `readOnlyOnly: true` safety filtering.

---

## Install & Build

Requires **Node.js 22+**.

```bash
git clone https://github.com/Olalolo22/talise-mcp-sdk.git
cd talise-mcp-sdk
npm install
npm run build
```

Generate a Personal Access Token (`tls_pat_...`) inside Talise (**Settings → Connected apps → Access tokens**) and export it:

```bash
export TALISE_PAT="tls_pat_..."
```

---

## SDK Quickstart

```ts
import { TaliseMcpClient } from "talise-mcp-sdk";

const talise = new TaliseMcpClient({ token: process.env.TALISE_PAT! });

const overview = await talise.getAccountOverview();
console.log("Balance:", overview.structured.balance_usd);

const allowance = await talise.getSpendingAllowance();
console.log("Spendable right now:", allowance.structured.spendable_now_usd);

const quote = await talise.quoteCashOut({ amount_ngn: 50_000 });
console.log("50,000 NGN ->", quote.structured.total_usd, "USDsui");

// Instant within Agent Pass:
const recipient = await talise.findRecipient({ to: "ada@talise" });
if (recipient.structured.found && !recipient.structured.is_you) {
  const receipt = await talise.sendMoney({ to: "ada@talise", amount_usd: 5 });
  console.log(receipt.structured.digest, receipt.text);
}
```

### AI Framework Adapters

```ts
import { TaliseMcpClient } from "talise-mcp-sdk";
import {
  toOpenAITools,
  executeOpenAIToolCall,
  toAnthropicTools,
  executeAnthropicToolUse,
  createAgentToolMap,
} from "talise-mcp-sdk/adapters";

const client = new TaliseMcpClient({ token: process.env.TALISE_PAT! });

// Read-only mode blocks send_money / prepare_cash_out / add_money_naira:
const safeOpenAiTools = toOpenAITools({ readOnlyOnly: true });
const claudeTools = toAnthropicTools({ include: ["get_balance", "find_recipient", "send_money"] });
const toolMap = createAgentToolMap(client, { readOnlyOnly: true });
```

---

## CLI Usage (`talise-mcp`)

```bash
# Inspect account, balance, and Agent Pass
node dist/cli.js overview --json
node dist/cli.js allowance --json
node dist/cli.js request-pass --daily-limit 50 --days 30

# Resolve recipients & Nigerian banks / quotes
node dist/cli.js resolve ada@talise --json
node dist/cli.js banks "guaranty" --json
node dist/cli.js quote 25000 --json

# Single send (requires --yes in non-TTY / CI)
node dist/cli.js send ada@talise 5 --yes --json

# Crash-safe CSV batch payroll via Agent Pass
node dist/cli.js batch plan examples/sample-sends.csv --max-total 500
node dist/cli.js batch run examples/sample-sends.csv --max-total 500 --yes
node dist/cli.js batch status runs/talise-batch-xxxxxxxx.run.json
node dist/cli.js batch resume runs/talise-batch-xxxxxxxx.run.json --retry-failed --yes
node dist/cli.js batch export runs/talise-batch-xxxxxxxx.run.json --out receipts.csv
```

### CSV Format (`examples/sample-sends.csv`)

```csv
name,to,amount_usd,note
Ada Obi,ada@talise,25,Design sprint
Tunde Bello,tunde.talise.sui,40.50,QA review
```

---

## Security & Safety

- `TALISE_PAT` is never written to `.run.json` journals or printed in `--json` output.
- Endpoint URLs are host-allowlisted to `https://*.talise.io` (set `TALISE_ALLOW_INSECURE=1` only for local mock servers).
- Non-interactive money moves refuse without `--yes`.
- Interrupted `in_flight` batch rows are skipped on `resume` unless `--retry-in-flight` is passed explicitly, preventing accidental double-sends.

## License

MIT — see [LICENSE](./LICENSE).
