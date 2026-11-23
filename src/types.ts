/**
 * Typed MCP protocol, tool argument, and structured output definitions
 * matching Talise's live Streamable HTTP MCP server (`https://app.talise.io/mcp`).
 */

export const TALISE_MCP_URL = "https://app.talise.io/mcp";
export const MCP_PROTOCOL_VERSION = "2025-03-26";

export type TaliseToolName =
  | "get_account_overview"
  | "get_spending_allowance"
  | "request_agent_pass"
  | "get_balance"
  | "list_bank_accounts"
  | "find_bank"
  | "check_bank_account"
  | "quote_cash_out"
  | "prepare_cash_out"
  | "get_cash_out_status"
  | "send_money"
  | "add_money_naira"
  | "get_add_money_status"
  | "find_recipient"
  | "list_recent_recipients"
  | "recent_activity";

export type McpTextContent = {
  type: "text";
  text: string;
};

export type McpToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type McpToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: McpToolAnnotations;
};

export type McpInitializeResult = {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: {
    name: string;
    title?: string;
    version: string;
    websiteUrl?: string;
  };
  instructions?: string;
};

export type McpToolCallResult<T = Record<string, unknown>> = {
  text: string;
  structured: T;
  isError: boolean;
  rawContent: McpTextContent[];
};

// ── Tool Inputs ──────────────────────────────────────────────────────────────

export type RequestAgentPassInput = {
  daily_limit_usd?: number;
  expires_in_days?: 7 | 30 | 90;
};

export type FindBankInput = {
  query: string;
};

export type CheckBankAccountInput = {
  bank_code: string;
  account_number: string;
};

export type QuoteCashOutInput = {
  amount_ngn: number;
};

export type PrepareCashOutInput =
  | {
      bank_account_id: string;
      amount_ngn: number;
      bank_code?: never;
      account_number?: never;
    }
  | {
      bank_code: string;
      account_number: string;
      amount_ngn: number;
      bank_account_id?: never;
    };

export type GetCashOutStatusInput = {
  approval_id: string;
};

export type SendMoneyInput = {
  to: string;
  amount_usd: number;
};

export type AddMoneyNairaInput = {
  amount_ngn: number;
};

export type GetAddMoneyStatusInput = {
  order_id: string;
};

export type FindRecipientInput = {
  to: string;
};

export type ListRecentRecipientsInput = {
  limit?: number;
};

export type RecentActivityInput = {
  limit?: number;
};

// ── Tool Structured Outputs ──────────────────────────────────────────────────

export type AccountOverviewResult = {
  email?: string;
  connected_as?: string;
  balance_usd: number;
  agent_pass: {
    active?: boolean;
    daily_limit_usd?: number;
    spent_today_usd?: number;
    remaining_today_usd?: number;
    spendable_now_usd?: number;
    expires_at?: string | null;
    [k: string]: unknown;
  } | null;
  move_into_reach_url?: string | null;
  saved_bank_accounts?: number;
  recent_payees?: unknown[];
  country?: string;
  naira_tools_available?: boolean;
  [k: string]: unknown;
};

export type SpendingAllowanceResult = {
  available: boolean;
  active: boolean;
  expired: boolean;
  daily_limit_usd?: number;
  spent_today_usd?: number;
  remaining_today_usd?: number;
  spendable_now_usd?: number;
  resets_at?: string | null;
  expires_at?: string | null;
  issue_pass_url?: string | null;
  move_into_reach_url?: string | null;
  [k: string]: unknown;
};

export type RequestAgentPassResult = {
  url?: string;
  issue_pass_url?: string;
  daily_limit_usd?: number;
  expires_in_days?: number;
  [k: string]: unknown;
};

export type BalanceResult = {
  balance_usd: number;
  currency: string;
  [k: string]: unknown;
};

export type SavedBankAccount = {
  id: string;
  bank_name?: string;
  bank_code?: string;
  account_name?: string;
  last4?: string;
  is_own?: boolean;
  [k: string]: unknown;
};

export type ListBankAccountsResult = {
  accounts: SavedBankAccount[];
  [k: string]: unknown;
};

export type BankMatch = {
  code: string;
  name: string;
};

export type FindBankResult = {
  banks: BankMatch[];
};

export type CheckBankAccountResult = {
  verified?: boolean;
  account_name?: string;
  bank_name?: string;
  bank_code?: string;
  account_number?: string;
  [k: string]: unknown;
};

export type QuoteCashOutResult = {
  amount_ngn: number;
  rate_ngn_per_usd: number;
  amount_usd: number;
  talise_fee_usd: number;
  talise_fee_percent: number;
  total_usd: number;
  balance_usd: number;
  balance_covers: boolean;
  daily_limit_usd: number;
  left_today_usd: number;
  within_daily_limit: boolean;
  min_ngn: number;
  allowance_active: boolean;
  allowance_covers: boolean;
  allowance_left_usd: number | null;
  [k: string]: unknown;
};

export type PrepareCashOutResult = {
  paid_via_pass?: boolean;
  paid?: boolean;
  status?: string;
  approval_id?: string;
  approval_url?: string;
  digest?: string;
  amount_ngn?: number;
  total_usd?: number;
  reason?: string;
  fix_url?: string;
  [k: string]: unknown;
};

export type CashOutStatusResult = {
  approval_id?: string;
  status?: string;
  amount_ngn?: number;
  total_usd?: number;
  digest?: string;
  [k: string]: unknown;
};

export type SendMoneyResult = {
  sent?: boolean;
  paid?: boolean;
  digest?: string;
  suiscan_url?: string;
  to?: string;
  address?: string;
  amount_usd?: number;
  reason?: string;
  issue_pass_url?: string;
  move_into_reach_url?: string;
  [k: string]: unknown;
};

export type AddMoneyNairaResult = {
  order_id?: string;
  account_number?: string;
  bank_name?: string;
  account_name?: string;
  amount_ngn?: number;
  expected_usd?: number;
  expires_at?: string;
  [k: string]: unknown;
};

export type AddMoneyStatusResult = {
  order_id?: string;
  status?: string;
  amount_ngn?: number;
  received_usd?: number;
  [k: string]: unknown;
};

export type FindRecipientResult = {
  found: boolean;
  name?: string | null;
  address?: string | null;
  is_you?: boolean;
  paid_before?: boolean | null;
  [k: string]: unknown;
};

export type RecentRecipient = {
  name?: string | null;
  address?: string;
  count?: number;
  last_amount_usd?: number;
  last_at?: string;
  [k: string]: unknown;
};

export type ListRecentRecipientsResult = {
  recipients: RecentRecipient[];
};

export type ActivityEntry = {
  id?: string;
  digest?: string;
  type?: string;
  direction?: string;
  amount_usd?: number;
  counterparty?: string;
  via_agent_pass?: boolean;
  created_at?: string;
  [k: string]: unknown;
};

export type RecentActivityResult = {
  activity: ActivityEntry[];
};

export type TaliseToolInputMap = {
  get_account_overview: Record<string, never>;
  get_spending_allowance: Record<string, never>;
  request_agent_pass: RequestAgentPassInput;
  get_balance: Record<string, never>;
  list_bank_accounts: Record<string, never>;
  find_bank: FindBankInput;
  check_bank_account: CheckBankAccountInput;
  quote_cash_out: QuoteCashOutInput;
  prepare_cash_out: PrepareCashOutInput;
  get_cash_out_status: GetCashOutStatusInput;
  send_money: SendMoneyInput;
  add_money_naira: AddMoneyNairaInput;
  get_add_money_status: GetAddMoneyStatusInput;
  find_recipient: FindRecipientInput;
  list_recent_recipients: ListRecentRecipientsInput;
  recent_activity: RecentActivityInput;
};

export type TaliseToolOutputMap = {
  get_account_overview: AccountOverviewResult;
  get_spending_allowance: SpendingAllowanceResult;
  request_agent_pass: RequestAgentPassResult;
  get_balance: BalanceResult;
  list_bank_accounts: ListBankAccountsResult;
  find_bank: FindBankResult;
  check_bank_account: CheckBankAccountResult;
  quote_cash_out: QuoteCashOutResult;
  prepare_cash_out: PrepareCashOutResult;
  get_cash_out_status: CashOutStatusResult;
  send_money: SendMoneyResult;
  add_money_naira: AddMoneyNairaResult;
  get_add_money_status: AddMoneyStatusResult;
  find_recipient: FindRecipientResult;
  list_recent_recipients: ListRecentRecipientsResult;
  recent_activity: RecentActivityResult;
};
