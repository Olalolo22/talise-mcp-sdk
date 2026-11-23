import type { TaliseMcpClient } from "../client.js";
import { TALISE_MCP_URL, type TaliseToolName } from "../types.js";
import { selectToolSpecs, type ToolFilterOptions } from "./schemas.js";

export type OpenAIFunctionTool = {
  type: "function";
  function: {
    name: TaliseToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type OpenAIResponsesMcpTool = {
  type: "mcp";
  server_url: string;
  server_label: string;
  authorization: string;
  allowed_tools?: TaliseToolName[];
  require_approval?: "never" | "always";
};

/**
 * Build OpenAI Chat Completions / Agents SDK function tool definitions
 * backed by `TaliseMcpClient`. Pass `readOnlyOnly: true` to block money moves.
 */
export function toOpenAITools(opts?: ToolFilterOptions): OpenAIFunctionTool[] {
  return selectToolSpecs(opts).map((spec) => ({
    type: "function",
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.inputSchema,
    },
  }));
}

/**
 * Build an OpenAI Responses API / xAI hosted MCP tool object pointing directly
 * at `https://app.talise.io/mcp`.
 */
export function toOpenAIResponsesMcpTool(opts: {
  token: string;
  endpoint?: string;
  serverLabel?: string;
  filter?: ToolFilterOptions;
  requireApproval?: "never" | "always";
}): OpenAIResponsesMcpTool {
  const tool: OpenAIResponsesMcpTool = {
    type: "mcp",
    server_url: opts.endpoint ?? TALISE_MCP_URL,
    server_label: opts.serverLabel ?? "talise",
    authorization: opts.token,
  };
  if (opts.filter) {
    tool.allowed_tools = selectToolSpecs(opts.filter).map((s) => s.name);
  }
  if (opts.requireApproval) {
    tool.require_approval = opts.requireApproval;
  }
  return tool;
}

/**
 * Execute an OpenAI `tool_call` (`{ name, arguments }`) against `TaliseMcpClient`
 * and return a JSON string suitable for a `role: "tool"` message.
 */
export async function executeOpenAIToolCall(
  client: TaliseMcpClient,
  call: { name: string; arguments: string | Record<string, unknown> },
  opts?: ToolFilterOptions,
): Promise<string> {
  const allowed = new Set<string>(selectToolSpecs(opts).map((s) => s.name));
  if (!allowed.has(call.name)) {
    return JSON.stringify({ ok: false, error: `Tool "${call.name}" is not enabled in this policy` });
  }
  let args: Record<string, unknown>;
  try {
    args =
      typeof call.arguments === "string"
        ? (JSON.parse(call.arguments || "{}") as Record<string, unknown>)
        : call.arguments ?? {};
  } catch {
    return JSON.stringify({ ok: false, error: `Invalid JSON arguments for ${call.name}` });
  }
  const res = await client.callTool(call.name, args);
  return JSON.stringify({
    ok: true,
    text: res.text,
    data: res.structured,
  });
}
