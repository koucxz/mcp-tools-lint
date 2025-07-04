import type { CallToolResult, ToolInfo, ToolSession } from "./types.js";
import { McpToolsLintError } from "./types.js";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
const REQUEST_PROTOCOL_VERSION = PROTOCOL_VERSIONS[0];

interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class StreamableHttpSession implements ToolSession {
  private nextId = 1;
  private sessionId?: string;
  private closed = false;

  constructor(private readonly options: { url: string; headers: Record<string, string> }) {}

  async start(startupTimeout: number): Promise<ToolInfo[]> {
    const deadline = Date.now() + startupTimeout;
    try {
      const initialized = await this.withTimeout(this.request("initialize", {
        protocolVersion: REQUEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mcp-tools-lint", version: "0.3.0" }
      }), this.remaining(deadline));
      const initializeResult = this.requireResult(initialized, "initialize");
      if (!initializeResult || typeof initializeResult !== "object" || Array.isArray(initializeResult)) throw new McpToolsLintError("MCP initialize returned an invalid result");
      const protocolVersion = (initializeResult as Record<string, unknown>).protocolVersion;
      if (!PROTOCOL_VERSIONS.includes(protocolVersion as typeof PROTOCOL_VERSIONS[number])) throw new McpToolsLintError(`Unsupported MCP protocol version: ${String(protocolVersion ?? "missing")}`);
      await this.withTimeout(this.requestNotification("notifications/initialized"), this.remaining(deadline));
      return await this.listTools(deadline);
    } catch (error) {
      await this.close();
      if (error instanceof McpToolsLintError) throw error;
      throw new McpToolsLintError(`MCP HTTP startup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listTools(deadline?: number): Promise<ToolInfo[]> {
    const tools: ToolInfo[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 100; page += 1) {
      const request = this.request("tools/list", cursor ? { cursor } : {});
      const response = deadline === undefined ? await request : await this.withTimeout(request, this.remaining(deadline));
      const result = this.requireResult(response, "tools/list");
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new McpToolsLintError("MCP tools/list returned an invalid result");
      const pageTools = (result as Record<string, unknown>).tools;
      if (!Array.isArray(pageTools)) throw new McpToolsLintError("MCP tools/list result is missing tools");
      tools.push(...pageTools as ToolInfo[]);
      const next = (result as Record<string, unknown>).nextCursor;
      if (next !== undefined && typeof next !== "string") throw new McpToolsLintError("MCP tools/list returned an invalid nextCursor");
      if (!next) return tools;
      if (seen.has(next)) throw new McpToolsLintError("MCP tools/list repeated cursor");
      seen.add(next);
      cursor = next;
    }
    throw new McpToolsLintError("MCP tools/list exceeded 100 pages");
  }

  async callTool(name: string, args: Record<string, unknown>, timeout: number): Promise<CallToolResult> {
    let response: RpcResponse;
    try {
      response = await this.withTimeout(this.request("tools/call", { name, arguments: args }), timeout);
    } catch (error) {
      if (error instanceof McpToolsLintError && error.message.includes("timed out")) throw new McpToolsLintError(error.message, 1);
      if (error instanceof McpToolsLintError) throw error;
      throw new McpToolsLintError(`MCP HTTP tools/call communication failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = this.requireResult(response, "tools/call");
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new McpToolsLintError("MCP tools/call returned an invalid result");
    return result as CallToolResult;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.sessionId) return;
    try {
      await fetch(this.options.url, { method: "DELETE", headers: this.requestHeaders() });
    } catch {
      // Closing is best effort; the original protocol error remains the useful diagnostic.
    }
  }

  private async requestNotification(method: string): Promise<void> {
    await this.request(method, {});
  }

  private async request(method: string, params: Record<string, unknown>): Promise<RpcResponse> {
    if (this.closed) throw new McpToolsLintError("MCP HTTP session is closed");
    const id = this.nextId++;
    const response = await fetch(this.options.url, {
      method: "POST",
      headers: { ...this.requestHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
    });
    const nextSession = response.headers.get("mcp-session-id");
    if (nextSession) this.sessionId = nextSession;
    if (!response.ok) throw new McpToolsLintError(`MCP HTTP request failed with status ${response.status}`);
    const body = await response.text();
    if (!body.trim()) return { id };
    const parsed = this.parseBody(body);
    if (parsed.id !== id) throw new McpToolsLintError(`MCP HTTP response id mismatch: expected ${id}, got ${String(parsed.id)}`);
    return parsed;
  }

  private parseBody(body: string): RpcResponse {
    if (!body.includes("data:")) {
      try { return JSON.parse(body) as RpcResponse; } catch { throw new McpToolsLintError("MCP HTTP server returned invalid JSON-RPC"); }
    }
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { return JSON.parse(data) as RpcResponse; } catch { throw new McpToolsLintError("MCP HTTP server returned invalid SSE JSON-RPC"); }
    }
    throw new McpToolsLintError("MCP HTTP SSE response did not contain JSON-RPC data");
  }

  private requireResult(response: RpcResponse, method: string): unknown {
    if (response.error) throw new McpToolsLintError(`MCP ${method} failed: ${response.error.message}`);
    if (response.result === undefined) throw new McpToolsLintError(`MCP ${method} response is missing result`);
    return response.result;
  }

  private requestHeaders(): Record<string, string> {
    return { Accept: "application/json, text/event-stream", "Mcp-Protocol-Version": REQUEST_PROTOCOL_VERSION, ...this.options.headers, ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}) };
  }

  private remaining(deadline: number): number {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new McpToolsLintError("MCP HTTP startup timed out after deadline");
    return timeout;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new McpToolsLintError(`MCP HTTP request timed out after ${timeoutMs}ms`)), timeoutMs); })]);
    } finally { if (timer) clearTimeout(timer); }
  }
}