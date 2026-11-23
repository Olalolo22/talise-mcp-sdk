import {
  TaliseAuthError,
  TaliseMcpError,
  TaliseToolError,
  TaliseValidationError,
} from "./errors.js";
import {
  MCP_PROTOCOL_VERSION,
  TALISE_MCP_URL,
  type AccountOverviewResult,
  type AddMoneyNairaInput,
  type AddMoneyNairaResult,
  type AddMoneyStatusResult,
  type BalanceResult,
  type CashOutStatusResult,
  type CheckBankAccountInput,
  type CheckBankAccountResult,
  type FindBankInput,
  type FindBankResult,
  type FindRecipientInput,
  type FindRecipientResult,
  type GetAddMoneyStatusInput,
  type GetCashOutStatusInput,
  type ListBankAccountsResult,
  type ListRecentRecipientsInput,
  type ListRecentRecipientsResult,
  type McpInitializeResult,
  type McpTextContent,
  type McpToolCallResult,
  type McpToolDescriptor,
  type PrepareCashOutInput,
  type PrepareCashOutResult,
  type QuoteCashOutInput,
  type QuoteCashOutResult,
  type RecentActivityInput,
  type RecentActivityResult,
  type RequestAgentPassInput,
  type RequestAgentPassResult,
  type SendMoneyInput,
  type SendMoneyResult,
  type SpendingAllowanceResult,
  type TaliseToolInputMap,
  type TaliseToolName,
  type TaliseToolOutputMap,
} from "./types.js";

export type TaliseMcpClientOptions = {
  /** Personal Access Token (`tls_pat_...`) or OAuth access token. */
  token: string;
  /** Override the MCP endpoint (host-allowlisted to `https://*.talise.io` unless `allowInsecureLocalhost` is true). */
  endpoint?: string;
  /** Allow `http://127.0.0.1` / `http://localhost` endpoints for local mocks/tests. */
  allowInsecureLocalhost?: boolean;
  /** Per-request timeout in milliseconds (default 30_000). */
  timeoutMs?: number;
  /** Client identifier sent in MCP `initialize`. */
  clientName?: string;
  /** Client version sent in MCP `initialize`. */
  clientVersion?: string;
  /** Optional custom `fetch` implementation (for tests or runtimes). */
  fetch?: typeof globalThis.fetch;
};

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

const ACCOUNT_NUMBER_RE = /^\d{10}$/;

/**
 * Validate and normalize the MCP endpoint so a poisoned env var cannot
 * exfiltrate a `tls_pat_...` bearer token to an attacker-controlled host.
 */
export function assertAllowedMcpUrl(raw: string, allowInsecureLocalhost = false): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new TaliseValidationError(`Invalid Talise MCP URL: ${raw}`);
  }
  const host = u.hostname.toLowerCase();
  const isTalise =
    u.protocol === "https:" && (host === "talise.io" || host.endsWith(".talise.io"));
  const isLocal =
    (u.protocol === "http:" || u.protocol === "https:") &&
    (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
  if (!isTalise && !(allowInsecureLocalhost && isLocal)) {
    throw new TaliseValidationError(
      `Refusing MCP endpoint host "${u.host}": must be an https://*.talise.io URL (or localhost with allowInsecureLocalhost/TALISE_ALLOW_INSECURE=1)`,
    );
  }
  return u.toString();
}

/**
 * Parse either a plain JSON-RPC body or an MCP Streamable HTTP SSE stream
 * (`event: message\ndata: {...}`). Returns the last JSON-RPC envelope carrying
 * a `result` or `error`.
 */
export function parseStreamableMcpBody(raw: string, contentType: string): JsonRpcResponse {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new TaliseMcpError("Empty response body from Talise MCP endpoint", {
      code: "EMPTY_RESPONSE",
    });
  }

  const looksSse =
    contentType.toLowerCase().includes("text/event-stream") ||
    trimmed.startsWith("event:") ||
    trimmed.startsWith("data:");

  if (!looksSse) {
    try {
      return JSON.parse(trimmed) as JsonRpcResponse;
    } catch (cause) {
      throw new TaliseMcpError("Non-JSON response from Talise MCP endpoint", {
        code: "INVALID_JSON",
        cause,
      });
    }
  }

  const envelopes: JsonRpcResponse[] = [];
  const blocks = trimmed.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n").trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload) as JsonRpcResponse;
      if (parsed && typeof parsed === "object" && ("result" in parsed || "error" in parsed)) {
        envelopes.push(parsed);
      }
    } catch {
      // Ignore non-JSON keepalive / comment frames inside SSE.
    }
  }

  const last = envelopes.at(-1);
  if (!last) {
    throw new TaliseMcpError("SSE stream from Talise MCP contained no JSON-RPC message", {
      code: "INVALID_SSE",
    });
  }
  return last;
}

/**
 * Clean-room Streamable HTTP MCP client for Talise (`https://app.talise.io/mcp`).
 * Covers all 16 live tools with typed inputs, validated parameters, and typed
 * `structuredContent` responses.
 */
export class TaliseMcpClient {
  readonly endpoint: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(opts: TaliseMcpClientOptions) {
    const token = opts.token?.trim();
    if (!token) {
      throw new TaliseValidationError(
        "A Talise Personal Access Token (tls_pat_...) is required",
      );
    }
    const allowLocal =
      opts.allowInsecureLocalhost === true || process.env.TALISE_ALLOW_INSECURE === "1";
    this.endpoint = assertAllowedMcpUrl(opts.endpoint ?? TALISE_MCP_URL, allowLocal);
    this.token = token;
    this.timeoutMs =
      typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
        ? opts.timeoutMs
        : 30_000;
    this.clientName = opts.clientName ?? "talise-mcp-sdk";
    this.clientVersion = opts.clientVersion ?? "0.1.0";
    // Wrap globalThis.fetch to avoid "Illegal invocation" in Workers/browsers.
    this.fetchImpl =
      opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  /** Send a raw MCP JSON-RPC request over Streamable HTTP. */
  async rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
        throw new TaliseMcpError(`Talise MCP request timed out after ${this.timeoutMs}ms`, {
          code: "TIMEOUT",
          cause,
        });
      }
      throw new TaliseMcpError(`Network error calling Talise MCP (${method})`, {
        code: "NETWORK_ERROR",
        cause,
      });
    }

    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";

    if (res.status === 401 || res.status === 403) {
      let detail = "";
      try {
        const parsed = JSON.parse(text) as { error_description?: string; error?: string };
        detail = parsed.error_description || parsed.error || "";
      } catch {
        detail = text.slice(0, 160).trim();
      }
      throw new TaliseAuthError(
        detail || `Authentication failed (HTTP ${res.status})`,
        res.status,
      );
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(text) as { error_description?: string; error?: string | { message?: string } };
        if (typeof parsed.error === "string") detail = parsed.error_description || parsed.error;
        else if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        if (text.trim()) detail = `HTTP ${res.status}: ${text.trim().slice(0, 160)}`;
      }
      throw new TaliseMcpError(detail, { code: "HTTP_ERROR", status: res.status });
    }

    const envelope = parseStreamableMcpBody(text, contentType);
    if (envelope.error) {
      throw new TaliseMcpError(
        envelope.error.message || `MCP JSON-RPC error (${envelope.error.code ?? "unknown"})`,
        { code: "RPC_ERROR", rpcCode: envelope.error.code },
      );
    }
    return envelope.result as T;
  }

  /** Perform the MCP `initialize` handshake. */
  async initialize(): Promise<McpInitializeResult> {
    return this.rpc<McpInitializeResult>("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: this.clientName, version: this.clientVersion },
    });
  }

  /** List tools advertised live by the Talise MCP server. */
  async listTools(): Promise<McpToolDescriptor[]> {
    const res = await this.rpc<{ tools?: McpToolDescriptor[] }>("tools/list", {});
    return res.tools ?? [];
  }

  /** Call any MCP tool by name and return both plain text and `structuredContent`. */
  async callTool<N extends TaliseToolName>(
    name: N,
    args: TaliseToolInputMap[N],
  ): Promise<McpToolCallResult<TaliseToolOutputMap[N]>>;
  async callTool<T = Record<string, unknown>>(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<McpToolCallResult<T>>;
  async callTool<T = Record<string, unknown>>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpToolCallResult<T>> {
    const raw = await this.rpc<{
      content?: McpTextContent[];
      structuredContent?: T;
      isError?: boolean;
    }>("tools/call", { name, arguments: args });

    const content = Array.isArray(raw.content) ? raw.content : [];
    const text = content
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n")
      .trim();
    const structured = (raw.structuredContent ?? {}) as T;
    const isError = raw.isError === true;

    if (isError) {
      throw new TaliseToolError(
        name,
        text || `Tool "${name}" returned an error`,
        structured as Record<string, unknown>,
      );
    }
    return { text, structured, isError, rawContent: content };
  }

  // ── Typed Methods for All 16 Live Talise MCP Tools ─────────────────────────

  async getAccountOverview(): Promise<McpToolCallResult<AccountOverviewResult>> {
    return this.callTool("get_account_overview", {});
  }

  async getSpendingAllowance(): Promise<McpToolCallResult<SpendingAllowanceResult>> {
    return this.callTool("get_spending_allowance", {});
  }

  async requestAgentPass(
    input: RequestAgentPassInput = {},
  ): Promise<McpToolCallResult<RequestAgentPassResult>> {
    if (input.daily_limit_usd !== undefined) {
      assertFiniteRange(input.daily_limit_usd, 1, 1000, "daily_limit_usd");
    }
    if (
      input.expires_in_days !== undefined &&
      input.expires_in_days !== 7 &&
      input.expires_in_days !== 30 &&
      input.expires_in_days !== 90
    ) {
      throw new TaliseValidationError("expires_in_days must be 7, 30, or 90");
    }
    return this.callTool("request_agent_pass", input);
  }

  async getBalance(): Promise<McpToolCallResult<BalanceResult>> {
    return this.callTool("get_balance", {});
  }

  async listBankAccounts(): Promise<McpToolCallResult<ListBankAccountsResult>> {
    return this.callTool("list_bank_accounts", {});
  }

  async findBank(input: FindBankInput): Promise<McpToolCallResult<FindBankResult>> {
    const query = assertNonEmptyString(input.query, "query", 60);
    return this.callTool("find_bank", { query });
  }

  async checkBankAccount(
    input: CheckBankAccountInput,
  ): Promise<McpToolCallResult<CheckBankAccountResult>> {
    const bank_code = assertNonEmptyString(input.bank_code, "bank_code", 20);
    const account_number = input.account_number.trim();
    if (!ACCOUNT_NUMBER_RE.test(account_number)) {
      throw new TaliseValidationError("account_number must be a 10-digit Nigerian account number");
    }
    return this.callTool("check_bank_account", { bank_code, account_number });
  }

  async quoteCashOut(input: QuoteCashOutInput): Promise<McpToolCallResult<QuoteCashOutResult>> {
    assertPositiveMax(input.amount_ngn, 10_000_000, "amount_ngn");
    return this.callTool("quote_cash_out", { amount_ngn: input.amount_ngn });
  }

  async prepareCashOut(
    input: PrepareCashOutInput,
  ): Promise<McpToolCallResult<PrepareCashOutResult>> {
    assertPositiveMax(input.amount_ngn, 10_000_000, "amount_ngn");
    if ("bank_account_id" in input && input.bank_account_id) {
      const bank_account_id = assertNonEmptyString(input.bank_account_id, "bank_account_id", 64);
      return this.callTool("prepare_cash_out", {
        bank_account_id,
        amount_ngn: input.amount_ngn,
      });
    }
    if ("bank_code" in input && input.bank_code && input.account_number) {
      const bank_code = assertNonEmptyString(input.bank_code, "bank_code", 20);
      const account_number = input.account_number.trim();
      if (!ACCOUNT_NUMBER_RE.test(account_number)) {
        throw new TaliseValidationError("account_number must be a 10-digit Nigerian account number");
      }
      return this.callTool("prepare_cash_out", {
        bank_code,
        account_number,
        amount_ngn: input.amount_ngn,
      });
    }
    throw new TaliseValidationError(
      "prepareCashOut requires either bank_account_id or (bank_code + account_number)",
    );
  }

  async getCashOutStatus(
    input: GetCashOutStatusInput,
  ): Promise<McpToolCallResult<CashOutStatusResult>> {
    const approval_id = assertNonEmptyString(input.approval_id, "approval_id", 100);
    return this.callTool("get_cash_out_status", { approval_id });
  }

  async sendMoney(input: SendMoneyInput): Promise<McpToolCallResult<SendMoneyResult>> {
    const to = assertNonEmptyString(input.to, "to", 120);
    assertPositiveMax(input.amount_usd, 1000, "amount_usd");
    const rounded = Math.round(input.amount_usd * 100) / 100;
    if (Math.abs(rounded - input.amount_usd) > 1e-9) {
      throw new TaliseValidationError("amount_usd supports at most 2 decimal places");
    }
    return this.callTool("send_money", { to, amount_usd: rounded });
  }

  async addMoneyNaira(
    input: AddMoneyNairaInput,
  ): Promise<McpToolCallResult<AddMoneyNairaResult>> {
    assertFiniteRange(input.amount_ngn, 1000, 50_000, "amount_ngn");
    return this.callTool("add_money_naira", { amount_ngn: input.amount_ngn });
  }

  async getAddMoneyStatus(
    input: GetAddMoneyStatusInput,
  ): Promise<McpToolCallResult<AddMoneyStatusResult>> {
    const order_id = assertNonEmptyString(input.order_id, "order_id", 64);
    if (order_id.length < 8) {
      throw new TaliseValidationError("order_id must be at least 8 characters");
    }
    return this.callTool("get_add_money_status", { order_id });
  }

  async findRecipient(input: FindRecipientInput): Promise<McpToolCallResult<FindRecipientResult>> {
    const to = assertNonEmptyString(input.to, "to", 120);
    return this.callTool("find_recipient", { to });
  }

  async listRecentRecipients(
    input: ListRecentRecipientsInput = {},
  ): Promise<McpToolCallResult<ListRecentRecipientsResult>> {
    if (input.limit !== undefined) {
      assertIntRange(input.limit, 1, 20, "limit");
    }
    return this.callTool("list_recent_recipients", input);
  }

  async recentActivity(
    input: RecentActivityInput = {},
  ): Promise<McpToolCallResult<RecentActivityResult>> {
    if (input.limit !== undefined) {
      assertIntRange(input.limit, 1, 25, "limit");
    }
    return this.callTool("recent_activity", input);
  }
}

function assertNonEmptyString(value: unknown, field: string, maxLen: number): string {
  if (typeof value !== "string") {
    throw new TaliseValidationError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new TaliseValidationError(`${field} is required`);
  if (trimmed.length > maxLen) {
    throw new TaliseValidationError(`${field} exceeds max length of ${maxLen}`);
  }
  return trimmed;
}

function assertPositiveMax(value: unknown, max: number, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) {
    throw new TaliseValidationError(`${field} must be a finite number in (0, ${max}]`);
  }
}

function assertFiniteRange(value: unknown, min: number, max: number, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new TaliseValidationError(`${field} must be a finite number between ${min} and ${max}`);
  }
}

function assertIntRange(value: unknown, min: number, max: number, field: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new TaliseValidationError(`${field} must be an integer between ${min} and ${max}`);
  }
}
