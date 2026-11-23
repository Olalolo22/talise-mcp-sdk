import { execFile, execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bin = resolve(root, "dist", "cli.js");

let server: Server;
let baseUrl: string;

function run(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    execFile(
      "node",
      [bin, ...args],
      { encoding: "utf8", env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === "number"
          ? ((err as { code: number }).code)
          : err
            ? 1
            : 0;
        resolveRun({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

beforeAll(async () => {
  execSync("npm run build", { cwd: root, stdio: "ignore" });
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const rpc = JSON.parse(raw || "{}");
      const name = rpc.params?.name;
      const result =
        name === "get_balance"
          ? {
              content: [{ type: "text", text: "$15.00" }],
              structuredContent: { balance_usd: 15, currency: "USD" },
            }
          : name === "find_recipient"
            ? {
                content: [{ type: "text", text: "ada@talise.sui" }],
                structuredContent: {
                  found: true,
                  name: "ada@talise.sui",
                  address: "0x" + "1".repeat(64),
                  is_you: false,
                },
              }
            : { content: [{ type: "text", text: "ok" }], structuredContent: {} };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n`);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}/mcp`;
}, 60_000);

afterAll(() => {
  server?.close();
});

describe("talise-mcp CLI binary", () => {
  it("prints version and help cleanly", async () => {
    expect((await run(["--version"])).stdout).toMatch(/^talise-mcp \d+\.\d+\.\d+/);
    expect((await run(["help"])).stdout).toContain("batch plan");
  });

  it("blocks non-talise endpoints and non-interactive sends without --yes", async () => {
    const badHost = await run(["balance", "--endpoint", "https://evil.com/mcp", "--token", "tls_pat_x"]);
    expect(badHost.code).not.toBe(0);
    expect(badHost.stderr).toMatch(/Refusing MCP endpoint host/i);

    const noYes = await run(["send", "ada@talise", "5"], {
      TALISE_PAT: "tls_pat_x",
      TALISE_MCP_URL: baseUrl,
      TALISE_ALLOW_INSECURE: "1",
    });
    expect(noYes.code).not.toBe(0);
    expect(noYes.stderr).toMatch(/without --yes/i);
  });

  it("queries mock SSE MCP endpoint and returns clean --json", async () => {
    const res = await run(["balance", "--json"], {
      TALISE_PAT: "tls_pat_x",
      TALISE_MCP_URL: baseUrl,
      TALISE_ALLOW_INSECURE: "1",
    });
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ balance_usd: 15, currency: "USD" });
  });
});
