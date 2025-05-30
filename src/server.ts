import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import type { CallToolResult, ToolInfo } from "./types.js";
import { McpToolsLintError } from "./types.js";

const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
const MCP_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0];

interface RpcResponse { id: number; result?: unknown; error?: { code: number; message: string; data?: unknown }; }

export class StdioSession {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = "";
  private pending = new Map<number, { resolve: (value: RpcResponse) => void; reject: (error: Error) => void }>();
  private stderr = "";
  private closed = false;

  constructor(private readonly options: { command: string; args: string[]; cwd: string; env: Record<string, string> }) {}

  async start(startupTimeout: number): Promise<ToolInfo[]> {
    this.child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk: string) => { this.stderr += chunk; });
    this.child.on("error", (error) => this.failPending(error));
    this.child.on("close", () => this.failPending(new Error("MCP server exited")));
    const deadline = Date.now() + startupTimeout;
    try {
      const initialized = await this.withTimeout(this.request("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mcp-tools-lint", version: "0.1.0" }
      }), this.remaining(deadline));
      const initializeResult = this.requireResult(initialized, "initialize");
      if (!initializeResult || typeof initializeResult !== "object" || Array.isArray(initializeResult)) {
        throw new McpToolsLintError("MCP initialize returned an invalid result");
      }
      const protocolVersion = (initializeResult as Record<string, unknown>).protocolVersion;
      if (!MCP_PROTOCOL_VERSIONS.includes(protocolVersion as typeof MCP_PROTOCOL_VERSIONS[number])) {
        throw new McpToolsLintError(`Unsupported MCP protocol version: ${String(protocolVersion ?? "missing")}`);
      }
      this.notify("notifications/initialized");
      return await this.listTools(deadline);
    } catch (error) {
      await this.close();
      if (error instanceof McpToolsLintError) throw error;
      throw new McpToolsLintError(`MCP startup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listTools(deadline?: number): Promise<ToolInfo[]> {
    const tools: ToolInfo[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 100; page += 1) {
      const response = deadline === undefined
        ? await this.request("tools/list", cursor ? { cursor } : {})
        : await this.withTimeout(this.request("tools/list", cursor ? { cursor } : {}), this.remaining(deadline));
      const result = this.requireResult(response, "tools/list");
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new McpToolsLintError("MCP tools/list returned an invalid result");
      const pageTools = (result as Record<string, unknown>).tools;
      if (!Array.isArray(pageTools)) throw new McpToolsLintError("MCP tools/list result is missing tools");
      tools.push(...pageTools);
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
      throw new McpToolsLintError(`MCP tools/call communication failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = this.requireResult(response, "tools/call");
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new McpToolsLintError("MCP tools/call returned an invalid result");
    return result as CallToolResult;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.child) return;
    this.child.stdin.end();
    const child = this.child;
    const timer = setTimeout(() => child.kill(), 500);
    await Promise.race([once(child, "close"), new Promise<void>(resolve => setTimeout(resolve, 700))]);
    clearTimeout(timer);
    if (!child.killed) child.kill();
  }

  getStderr(): string { return this.stderr; }

  private notify(method: string): void {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  private request(method: string, params: Record<string, unknown>): Promise<RpcResponse> {
    if (!this.child || this.closed) return Promise.reject(new Error("MCP session is closed"));
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) return;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message: RpcResponse;
      try { message = JSON.parse(line) as RpcResponse; } catch { this.failPending(new Error("MCP server wrote invalid JSON-RPC")); return; }
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (pending) { this.pending.delete(message.id); pending.resolve(message); }
      }
    }
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private requireResult(response: RpcResponse, method: string): unknown {
    if (response.error) throw new McpToolsLintError(`MCP ${method} failed: ${response.error.message}`);
    if (response.result === undefined) throw new McpToolsLintError(`MCP ${method} response is missing result`);
    return response.result;
  }

  private remaining(deadline: number): number {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new McpToolsLintError(`MCP startup timed out after deadline`);
    return timeout;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([promise, new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new McpToolsLintError(`MCP request timed out after ${timeoutMs}ms`)), timeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
}