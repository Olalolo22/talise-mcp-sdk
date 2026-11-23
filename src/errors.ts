export class TaliseMcpError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly rpcCode?: number;

  constructor(
    message: string,
    opts?: { code?: string; status?: number; rpcCode?: number; cause?: unknown },
  ) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "TaliseMcpError";
    this.code = opts?.code ?? "MCP_ERROR";
    this.status = opts?.status;
    this.rpcCode = opts?.rpcCode;
  }
}

export class TaliseAuthError extends TaliseMcpError {
  constructor(message = "Unauthorized: check your Talise Personal Access Token (tls_pat_...)", status = 401) {
    super(message, { code: "UNAUTHORIZED", status });
    this.name = "TaliseAuthError";
  }
}

export class TaliseValidationError extends TaliseMcpError {
  constructor(message: string) {
    super(message, { code: "VALIDATION_ERROR" });
    this.name = "TaliseValidationError";
  }
}

export class TaliseToolError extends TaliseMcpError {
  readonly toolName: string;
  readonly structured?: Record<string, unknown>;

  constructor(toolName: string, message: string, structured?: Record<string, unknown>) {
    super(message, { code: "TOOL_ERROR" });
    this.name = "TaliseToolError";
    this.toolName = toolName;
    this.structured = structured;
  }
}
