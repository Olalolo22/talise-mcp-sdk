/**
 * Example: Build a framework-agnostic executable tool map (Vercel AI SDK / LangGraph / custom loop).
 *
 * Run:
 *   TALISE_PAT=tls_pat_... npx tsx examples/vercel-ai.ts
 */
import { TaliseMcpClient } from "../src/index.js";
import { createAgentToolMap } from "../src/adapters/index.js";

const token = process.env.TALISE_PAT ?? "tls_pat_placeholder";
const client = new TaliseMcpClient({ token });

// Expose read-only + NGN quoting tools to an agent loop:
const tools = createAgentToolMap(client, {
  include: ["get_account_overview", "get_balance", "get_spending_allowance", "quote_cash_out"],
});

console.log("Registered tools:", Object.keys(tools));

if (process.env.TALISE_PAT) {
  const quote = await tools.quote_cash_out!.execute({ amount_ngn: 10_000 });
  console.log("Quote:", quote.data);
}
