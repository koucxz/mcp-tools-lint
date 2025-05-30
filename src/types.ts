export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
  [key: string]: unknown;
}

export interface ContentItem {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface CallToolResult {
  content?: ContentItem[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface TestCase {
  name: string;
  tool: string;
  arguments?: Record<string, unknown>;
  timeout?: number;
  expect: {
    isError?: boolean;
    text?: { equals?: string; contains?: string; matches?: string };
    structuredContent?: Record<string, unknown>;
  };
}

export interface TestSuite {
  suite: string;
  tests: TestCase[];
  file: string;
}

export interface Config {
  configPath: string;
  server: {
    transport: "stdio" | "streamable-http";
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    envFrom: Record<string, string>;
    url?: string;
    headers: Record<string, string>;
  };
  testDir: string;
  startupTimeout: number;
  testTimeout: number;
}

export interface ToolSession {
  start(startupTimeout: number): Promise<ToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>, timeout: number): Promise<CallToolResult>;
  close(): Promise<void>;
}

export interface CaseResult {
  suite: string;
  file: string;
  name: string;
  tool: string;
  status: "passed" | "failed";
  durationMs: number;
  error?: string;
}

export interface TestReport {
  schemaVersion: 1;
  command: "test";
  status: "passed" | "failed";
  cases: CaseResult[];
  summary: { passed: number; failed: number; total: number; durationMs: number };
}

export class McpToolsLintError extends Error {
  constructor(message: string, public readonly exitCode: 2 | 1 = 2) {
    super(message);
    this.name = "McpToolsLintError";
  }
}