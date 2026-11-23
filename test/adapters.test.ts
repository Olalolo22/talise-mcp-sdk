import { describe, expect, it } from "vitest";
import {
  createAgentToolMap,
  executeAnthropicToolUse,
  executeOpenAIToolCall,
  TALISE_TOOL_SPECS,
  toAnthropicTools,
  toOpenAIResponsesMcpTool,
  toOpenAITools,
} from "../src/adapters/index.js";
import { TaliseMcpClient } from "../src/client.js";

describe("AI framework adapters", () => {
  it("exposes all 16 tools and filters mutating tools in readOnlyOnly mode", () => {
    expect(TALISE_TOOL_SPECS).toHaveLength(16);
    const ro = toOpenAITools({ readOnlyOnly: true });
    expect(ro.length).toBe(13);
    expect(ro.some((t) => t.function.name === "send_money")).toBe(false);
    expect(ro.some((t) => t.function.name === "prepare_cash_out")).toBe(false);
    expect(ro.some((t) => t.function.name === "add_money_naira")).toBe(false);

    const claude = toAnthropicTools({ include: ["get_balance", "find_recipient"] });
    expect(claude.map((t) => t.name)).toEqual(["get_balance", "find_recipient"]);

    const responsesTool = toOpenAIResponsesMcpTool({
      token: "tls_pat_x",
      filter: { readOnlyOnly: true },
    });
    expect(responsesTool.type).toBe("mcp");
    expect(responsesTool.allowed_tools).not.toContain("send_money");
  });

  it("blocks disallowed tools at dispatch time and executes allowed tools", async () => {
    const client = new TaliseMcpClient({
      token: "tls_pat_mock",
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        return new Response(
          `event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: "Balance $12.00" }],
              structuredContent: { balance_usd: 12, currency: "USD" },
            },
          })}\n\n`,
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    const blocked = JSON.parse(
      await executeOpenAIToolCall(
        client,
        { name: "send_money", arguments: '{"to":"ada@talise","amount_usd":5}' },
        { readOnlyOnly: true },
      ),
    );
    expect(blocked.ok).toBe(false);

    const allowed = await executeAnthropicToolUse(
      client,
      { type: "tool_use", id: "tu_1", name: "get_balance", input: {} },
      { readOnlyOnly: true },
    );
    expect(allowed.is_error).toBeUndefined();
    expect(JSON.parse(allowed.content).data.balance_usd).toBe(12);

    const map = createAgentToolMap(client, { include: ["get_balance"] });
    const res = await map.get_balance!.execute({});
    expect(res.data.balance_usd).toBe(12);
  });
});
