import type { TaliseMcpClient } from "../client.js";
import type { TaliseToolName } from "../types.js";
import { selectToolSpecs, type ToolFilterOptions } from "./schemas.js";

export type AnthropicTool = {
  name: TaliseToolName;
  description: string;
  input_schema: Record<string, unknown>;
};

export type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

/** Build Anthropic Claude Messages API `tools` definitions. */
export function toAnthropicTools(opts?: ToolFilterOptions): AnthropicTool[] {
  return selectToolSpecs(opts).map((spec) => ({
    name: spec.name,
    description: spec.description,
    input_schema: spec.inputSchema,
  }));
}

/** Execute an Anthropic `tool_use` block against `TaliseMcpClient`. */
export async function executeAnthropicToolUse(
  client: TaliseMcpClient,
  block: AnthropicToolUseBlock,
  opts?: ToolFilterOptions,
): Promise<AnthropicToolResultBlock> {
  const allowed = new Set<string>(selectToolSpecs(opts).map((s) => s.name));
  if (!allowed.has(block.name)) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify({
        ok: false,
        error: `Tool "${block.name}" is not enabled in this policy`,
      }),
      is_error: true,
    };
  }
  try {
    const res = await client.callTool(block.name, block.input ?? {});
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify({ ok: true, text: res.text, data: res.structured }),
    };
  } catch (err) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      is_error: true,
    };
  }
}
