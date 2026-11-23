/**
 * Example: Wire Talise MCP + Agent Pass into OpenAI Chat Completions or Responses API.
 *
 * Run (read-only demo):
 *   TALISE_PAT=tls_pat_... npx tsx examples/openai-agent.ts
 */
import { TaliseMcpClient } from "../src/index.js";
import {
  executeOpenAIToolCall,
  toOpenAIResponsesMcpTool,
  toOpenAITools,
} from "../src/adapters/index.js";

const token = process.env.TALISE_PAT ?? "tls_pat_placeholder";
const client = new TaliseMcpClient({ token });

// 1. OpenAI Chat Completions function tools (read-only policy blocks send_money / prepare_cash_out):
const chatTools = toOpenAITools({ readOnlyOnly: true });
console.log("Loaded OpenAI function tools:", chatTools.map((t) => t.function.name));

// 2. OpenAI Responses API hosted MCP tool block:
const responsesMcp = toOpenAIResponsesMcpTool({
  token,
  filter: { readOnlyOnly: true },
  requireApproval: "never",
});
console.log("Responses API MCP tool config:", { ...responsesMcp, authorization: "<redacted>" });

// 3. Example tool-call dispatcher:
if (process.env.TALISE_PAT) {
  const resultJson = await executeOpenAIToolCall(
    client,
    { name: "get_balance", arguments: "{}" },
    { readOnlyOnly: true },
  );
  console.log("Tool result:", resultJson);
}
