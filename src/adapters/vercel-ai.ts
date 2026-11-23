import type { TaliseMcpClient } from "../client.js";
import type { TaliseToolName } from "../types.js";
import { selectToolSpecs, type ToolFilterOptions } from "./schemas.js";

export type ExecutableJsonSchemaTool = {
  description: string;
  inputSchema: Record<string, unknown>;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<{
    text: string;
    data: Record<string, unknown>;
  }>;
};

/**
 * Create a map of named executable tools compatible with Vercel AI SDK
 * (`jsonSchema(t.inputSchema)`), Mastra, LangGraph, or custom agent loops.
 *
 * Keeps zero hard dependency on `ai` / `zod` so you can drop it into any
 * TypeScript stack and optionally pass `readOnlyOnly: true` for safe agents.
 */
export function createAgentToolMap(
  client: TaliseMcpClient,
  opts?: ToolFilterOptions,
): Partial<Record<TaliseToolName, ExecutableJsonSchemaTool>> {
  const out: Partial<Record<TaliseToolName, ExecutableJsonSchemaTool>> = {};
  for (const spec of selectToolSpecs(opts)) {
    out[spec.name] = {
      description: spec.description,
      inputSchema: spec.inputSchema,
      parameters: spec.inputSchema,
      execute: async (args: Record<string, unknown>) => {
        const res = await client.callTool(spec.name, args ?? {});
        return { text: res.text, data: res.structured as Record<string, unknown> };
      },
    };
  }
  return out;
}
