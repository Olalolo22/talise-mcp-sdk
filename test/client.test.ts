import { describe, expect, it } from "vitest";
import {
  TaliseMcpClient,
  assertAllowedMcpUrl,
  parseStreamableMcpBody,
} from "../src/client.js";
import { TaliseAuthError, TaliseToolError, TaliseValidationError } from "../src/errors.js";

function sseResponse(payload: unknown, headers: Record<string, string> = {}): Response {
  const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  });
}

describe("assertAllowedMcpUrl", () => {
  it("allows https://app.talise.io/mcp and subdomains", () => {
    expect(assertAllowedMcpUrl("https://app.talise.io/mcp")).toBe("https://app.talise.io/mcp");
    expect(assertAllowedMcpUrl("https://talise.io/mcp")).toBe("https://talise.io/mcp");
  });

  it("blocks attacker hosts and plain http on talise.io", () => {
    expect(() => assertAllowedMcpUrl("https://evil.com/mcp")).toThrow(TaliseValidationError);
    expect(() => assertAllowedMcpUrl("https://talise.io.evil.com/mcp")).toThrow(
      TaliseValidationError,
    );
    expect(() => assertAllowedMcpUrl("http://app.talise.io/mcp")).toThrow(TaliseValidationError);
  });

  it("blocks localhost unless allowInsecureLocalhost is enabled", () => {
    expect(() => assertAllowedMcpUrl("http://127.0.0.1:4000/mcp")).toThrow(TaliseValidationError);
    expect(assertAllowedMcpUrl("http://127.0.0.1:4000/mcp", true)).toBe(
      "http://127.0.0.1:4000/mcp",
    );
  });
});

describe("parseStreamableMcpBody", () => {
  it("parses SSE frames and plain JSON", () => {
    const sse = parseStreamableMcpBody(
      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n',
      "text/event-stream",
    );
    expect(sse.result).toEqual({ ok: true });

    const json = parseStreamableMcpBody(
      '{"jsonrpc":"2.0","id":2,"result":{"balance_usd":12.5}}',
      "application/json",
    );
    expect(json.result).toEqual({ balance_usd: 12.5 });
  });
});

describe("TaliseMcpClient", () => {
  it("parses SSE tool responses, preserves session id, and sends Bearer header", async () => {
    const calls: { headers: Record<string, string>; body: unknown }[] = [];
    const client = new TaliseMcpClient({
      token: "tls_pat_test_secret",
      fetch: async (_url, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const body = JSON.parse(String(init?.body ?? "{}"));
        calls.push({ headers, body });
        if (body.method === "initialize") {
          return sseResponse(
            {
              jsonrpc: "2.0",
              id: body.id,
              result: {
                protocolVersion: "2025-03-26",
                capabilities: { tools: {} },
                serverInfo: { name: "Talise", version: "1.0.0" },
              },
            },
            { "mcp-session-id": "sess_123" },
          );
        }
        return sseResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: "Your balance is $42.50" }],
            structuredContent: { balance_usd: 42.5, currency: "USD" },
          },
        });
      },
    });

    const init = await client.initialize();
    expect(init.serverInfo.name).toBe("Talise");

    const bal = await client.getBalance();
    expect(bal.structured.balance_usd).toBe(42.5);
    expect(calls[0]!.headers.Authorization).toBe("Bearer tls_pat_test_secret");
    expect(calls[1]!.headers["Mcp-Session-Id"]).toBe("sess_123");
  });

  it("maps 401 to TaliseAuthError and isError tool payloads to TaliseToolError", async () => {
    const unauth = new TaliseMcpClient({
      token: "tls_pat_bad",
      fetch: async () =>
        new Response(
          JSON.stringify({ error: "unauthorized", error_description: "Token revoked" }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    });
    await expect(unauth.getBalance()).rejects.toThrow(TaliseAuthError);

    const toolErr = new TaliseMcpClient({
      token: "tls_pat_ok",
      fetch: async () =>
        sseResponse({
          jsonrpc: "2.0",
          id: 1,
          result: {
            isError: true,
            content: [{ type: "text", text: "Invalid recipient" }],
          },
        }),
    });
    await expect(toolErr.findRecipient({ to: "bad" })).rejects.toThrow(TaliseToolError);
  });

  it("validates inputs locally before calling network", async () => {
    let networkCalled = false;
    const client = new TaliseMcpClient({
      token: "tls_pat_ok",
      fetch: async () => {
        networkCalled = true;
        return sseResponse({ jsonrpc: "2.0", id: 1, result: {} });
      },
    });

    await expect(client.sendMoney({ to: "ada@talise", amount_usd: 1001 })).rejects.toThrow(
      TaliseValidationError,
    );
    await expect(client.sendMoney({ to: "ada@talise", amount_usd: 1.234 })).rejects.toThrow(
      TaliseValidationError,
    );
    await expect(
      client.checkBankAccount({ bank_code: "000013", account_number: "12345" }),
    ).rejects.toThrow(TaliseValidationError);
    await expect(client.addMoneyNaira({ amount_ngn: 500 })).rejects.toThrow(TaliseValidationError);
    expect(networkCalled).toBe(false);
  });
});
