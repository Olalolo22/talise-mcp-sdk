import type { TaliseToolName } from "../types.js";

export type CanonicalToolSpec = {
  name: TaliseToolName;
  description: string;
  readOnly: boolean;
  inputSchema: Record<string, unknown>;
};

/**
 * Canonical JSON Schemas for all 16 live tools on `https://app.talise.io/mcp`.
 * Used by the OpenAI, Anthropic, and Vercel AI SDK adapters when running
 * without an extra `tools/list` round-trip.
 */
export const TALISE_TOOL_SPECS: readonly CanonicalToolSpec[] = [
  {
    name: "get_account_overview",
    description:
      "Get the user's Talise account overview: balance, Agent Pass status, saved bank accounts, recent payees, and country.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_spending_allowance",
    description:
      "Check the active on-chain Agent Pass daily limit, spent today, remaining allowance, and spendable-now amount.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "request_agent_pass",
    description:
      "Generate a one-tap Talise link for the user to issue or raise an on-chain Agent Pass (daily limit $1-$1,000, optional 7/30/90 day expiry).",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        daily_limit_usd: {
          type: "number",
          minimum: 1,
          maximum: 1000,
          description: "Suggested daily spending limit in USD (1 to 1000).",
        },
        expires_in_days: {
          type: "number",
          enum: [7, 30, 90],
          description: "Suggested pass duration in days (7, 30, or 90).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_balance",
    description: "Get the user's USDsui balance in US dollars.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_bank_accounts",
    description: "Nigeria only. List the user's saved Nigerian bank accounts (last 4 digits and id).",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "find_bank",
    description: "Nigeria only. Search Nigerian banks by name to get bank_code.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 60,
          description: "Part of the Nigerian bank's name.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "check_bank_account",
    description: "Nigeria only. Verify a 10-digit Nigerian account number and return the account holder's name.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        bank_code: { type: "string", minLength: 1, maxLength: 20 },
        account_number: { type: "string", pattern: "^\\d{10}$" },
      },
      required: ["bank_code", "account_number"],
      additionalProperties: false,
    },
  },
  {
    name: "quote_cash_out",
    description: "Nigeria only. Quote a cash-out to a Nigerian bank in naira (live FX rate, total USD including fee, allowance check).",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        amount_ngn: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: 10000000,
          description: "Naira the bank account should receive.",
        },
      },
      required: ["amount_ngn"],
      additionalProperties: false,
    },
  },
  {
    name: "prepare_cash_out",
    description:
      "Nigeria only. Execute a naira bank cash-out instantly within Agent Pass limits, or return a 10-minute approval link.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        bank_account_id: { type: "string", minLength: 1, maxLength: 64 },
        bank_code: { type: "string", minLength: 1, maxLength: 20 },
        account_number: { type: "string", pattern: "^\\d{10}$" },
        amount_ngn: { type: "number", exclusiveMinimum: 0, maximum: 10000000 },
      },
      required: ["amount_ngn"],
      additionalProperties: false,
    },
  },
  {
    name: "get_cash_out_status",
    description: "Check the status of a prepared or executing bank cash-out by approval_id.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        approval_id: { type: "string", minLength: 1, maxLength: 100 },
      },
      required: ["approval_id"],
      additionalProperties: false,
    },
  },
  {
    name: "send_money",
    description:
      "Send USDsui instantly within the Agent Pass to a Talise name (e.g. ada@talise), .sui name, or 0x Sui address.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", minLength: 1, maxLength: 120 },
        amount_usd: { type: "number", exclusiveMinimum: 0, maximum: 1000 },
      },
      required: ["to", "amount_usd"],
      additionalProperties: false,
    },
  },
  {
    name: "add_money_naira",
    description: "Nigeria only. Create a one-time naira bank deposit order (1,000 to 50,000 NGN).",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        amount_ngn: { type: "number", minimum: 1000, maximum: 50000 },
      },
      required: ["amount_ngn"],
      additionalProperties: false,
    },
  },
  {
    name: "get_add_money_status",
    description: "Check the status of a naira deposit order by order_id.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        order_id: { type: "string", minLength: 8, maxLength: 64 },
      },
      required: ["order_id"],
      additionalProperties: false,
    },
  },
  {
    name: "find_recipient",
    description: "Resolve a Talise handle, .sui name, or 0x Sui address before sending.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", minLength: 1, maxLength: 120 },
      },
      required: ["to"],
      additionalProperties: false,
    },
  },
  {
    name: "list_recent_recipients",
    description: "List people the user has paid recently on Talise.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "recent_activity",
    description: "List recent Talise wallet transactions including Agent Pass payments.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
      additionalProperties: false,
    },
  },
];

export type ToolFilterOptions = {
  /** Only include read-only tools (blocks `send_money`, `prepare_cash_out`, `add_money_naira`). */
  readOnlyOnly?: boolean;
  /** Restrict to a specific subset of tools. */
  include?: readonly TaliseToolName[];
  /** Exclude specific tools. */
  exclude?: readonly TaliseToolName[];
};

export function selectToolSpecs(opts?: ToolFilterOptions): CanonicalToolSpec[] {
  let list = [...TALISE_TOOL_SPECS];
  if (opts?.readOnlyOnly) {
    list = list.filter((t) => t.readOnly);
  }
  if (opts?.include && opts.include.length > 0) {
    const allow = new Set(opts.include);
    list = list.filter((t) => allow.has(t.name));
  }
  if (opts?.exclude && opts.exclude.length > 0) {
    const deny = new Set(opts.exclude);
    list = list.filter((t) => !deny.has(t.name));
  }
  return list;
}
